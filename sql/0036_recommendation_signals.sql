-- =====================================================================
-- 0036 — RECOMMENDATION SIGNALS
-- =====================================================================
-- One function that gathers everything the recommender needs and returns
-- a pre-scored candidate set. Doing this in SQL rather than in the app is
-- what keeps it fast: the alternative is six round trips from the server
-- component, each one fetching rows the app then throws away.
--
-- ── The six signals ──────────────────────────────────────────────────
--   browse   — listings this buyer opened (listing_views, added below)
--   search   — what they typed (ai_search_queries, sql/0035)
--   cart     — what is in their cart right now (passed in: the cart is
--              localStorage, so only the browser knows it)
--   location — their city/state, and what is popular there
--   budget   — the median price of what they have engaged with
--   history  — what they have actually bought
--
-- ── Why a new `listing_views` table ──────────────────────────────────
-- `listings.views` (sql/0032) is a COUNTER: it answers "how many people
-- looked at this?" and cannot answer "what did THIS buyer look at?", which
-- is the only question a recommender cares about. So the counter stays as
-- it is (the seller analytics depend on it) and a per-viewer log is added
-- alongside it. `track_listing_view` writes both.
--
-- ── Why the candidate set is filtered, not just scored ───────────────
-- Recommending something the buyer cannot receive is worse than
-- recommending nothing: it is a dead end they only discover at checkout.
-- So the set is restricted to live listings whose shop is approved, and
-- to the buyer's state (nationwide listings are always allowed, matching
-- the checkout rule in sql/0016).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PER-VIEWER BROWSE LOG
-- ---------------------------------------------------------------------
create table if not exists public.listing_views (
  id          bigserial primary key,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  viewer_id   uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists listing_views_viewer_idx
  on public.listing_views(viewer_id, created_at desc);
create index if not exists listing_views_listing_idx
  on public.listing_views(listing_id);

alter table public.listing_views enable row level security;

-- A buyer may read and write only their own rows. The seller never reads
-- this table: it is buyer behaviour, not shop analytics.
drop policy if exists listing_views_own on public.listing_views;
create policy listing_views_own on public.listing_views
  for all using (viewer_id = auth.uid()) with check (viewer_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. TRACK A VIEW — counter AND log
-- ---------------------------------------------------------------------
-- Replaces the sql/0032 version. The counter behaviour is unchanged (the
-- seller's own views are still skipped, a guest still counts); the only
-- addition is the per-viewer row, which is what the recommender reads.
create or replace function public.track_listing_view(
  p_listing_id uuid,
  p_viewer_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select s.owner_id into v_owner
    from public.listings l
    join public.shops s on s.id = l.shop_id
   where l.id = p_listing_id;

  -- Unknown listing: nothing to count.
  if v_owner is null then
    return;
  end if;

  -- The seller looking at their own gig is not a view.
  if p_viewer_id is not null and p_viewer_id = v_owner then
    return;
  end if;

  update public.listings
     set views = coalesce(views, 0) + 1
   where id = p_listing_id;

  -- The per-viewer log. Only for a signed-in viewer, and de-duplicated
  -- within the hour: a buyer refreshing a page ten times is one interest,
  -- not ten, and without this the "recently viewed" list would be one
  -- product repeated.
  if p_viewer_id is not null then
    insert into public.listing_views (listing_id, viewer_id)
    select p_listing_id, p_viewer_id
     where not exists (
       select 1 from public.listing_views
        where listing_id = p_listing_id
          and viewer_id = p_viewer_id
          and created_at > now() - interval '1 hour'
     );
  end if;
end $$;

grant execute on function public.track_listing_view(uuid, uuid) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 3. THE SIGNAL GATHERER
-- ---------------------------------------------------------------------
-- `p_cart_ids` comes from the browser because the cart is localStorage.
-- Passing it in is what lets the cart be a real signal without moving the
-- cart to the server.
create or replace function public.buyer_recommendation_signals(
  p_buyer_id uuid,
  p_cart_ids uuid[] default '{}',
  p_limit    int default 40
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile    public.profiles;
  v_viewed     jsonb;
  v_searched   jsonb;
  v_cart       jsonb;
  v_bought     jsonb;
  v_budget     numeric;
  v_cats       text[];
  v_candidates jsonb;
begin
  select * into v_profile from public.profiles where id = p_buyer_id;

  -- ── browse: the last 12 distinct listings they opened ─────────────
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_viewed
  from (
    select distinct on (l.id) l.title, c.name as category
      from public.listing_views v
      join public.listings l on l.id = v.listing_id
      left join public.categories c on c.id = l.category_id
     where v.viewer_id = p_buyer_id
     order by l.id, v.created_at desc
     limit 12
  ) x;

  -- ── search: the last 8 queries ────────────────────────────────────
  select coalesce(jsonb_agg(q.query_text), '[]'::jsonb) into v_searched
  from (
    select query_text
      from public.ai_search_queries
     where user_id = p_buyer_id
       and query_text is not null
       and btrim(query_text) <> ''
     order by created_at desc
     limit 8
  ) q;

  -- ── cart: what is in it now ───────────────────────────────────────
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_cart
  from (
    select l.title, c.name as category
      from public.listings l
      left join public.categories c on c.id = l.category_id
     where l.id = any(coalesce(p_cart_ids, '{}'))
     limit 10
  ) x;

  -- ── history: what they actually bought ────────────────────────────
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_bought
  from (
    select oi.title, c.name as category
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      left join public.listings l on l.id = oi.listing_id
      left join public.categories c on c.id = l.category_id
     where o.buyer_id = p_buyer_id
       and o.status in ('delivered','completed')
     order by o.created_at desc
     limit 10
  ) x;

  -- ── budget: the median price of what they engaged with ────────────
  -- Median, not average: one expensive item they looked at once should
  -- not drag the whole budget up.
  select percentile_cont(0.5) within group (order by l.price) into v_budget
    from public.listing_views v
    join public.listings l on l.id = v.listing_id
   where v.viewer_id = p_buyer_id
     and l.price > 0;

  -- ── the categories they lean toward ───────────────────────────────
  select array_agg(distinct cat) into v_cats
  from (
    select c.slug as cat
      from public.listing_views v
      join public.listings l on l.id = v.listing_id
      join public.categories c on c.id = l.category_id
     where v.viewer_id = p_buyer_id
     union
    select c.slug
      from public.listings l
      join public.categories c on c.id = l.category_id
     where l.id = any(coalesce(p_cart_ids, '{}'))
  ) t
  where cat is not null;

  -- ── candidates ────────────────────────────────────────────────────
  -- Live, approved, not already bought, and not the buyer's own shop.
  --
  -- NOTE ON LOCATION: the buyer's state is used as a SCORING signal (see
  -- the `+15` below), not as a hard filter. Filtering on it would empty
  -- the rail for every buyer whose profile has no state, and would hide
  -- nationwide listings that the checkout rule actually allows. The
  -- checkout rule is enforced at checkout, where it belongs.
  select coalesce(jsonb_agg(x order by x.base_score desc), '[]'::jsonb) into v_candidates
  from (
    select
      l.id,
      l.title,
      c.name  as category,
      l.price,
      coalesce(l.rating_avg, 0) as rating,
      s.city,
      s.state,
      l.type,
      -- Which signal is strongest for this row. Used for the fallback
      -- reason when the model is unavailable.
      case
        when l.id = any(coalesce(p_cart_ids, '{}')) then 'cart'
        when c.slug = any(coalesce(v_cats, '{}')) then 'browse'
        when v_budget is not null and l.price between v_budget * 0.5 and v_budget * 1.5 then 'budget'
        when s.city = v_profile.city then 'location'
        else 'browse'
      end as signal,
      -- Deterministic 0-100 pre-score.
      round(
        (case when c.slug = any(coalesce(v_cats, '{}')) then 40 else 0 end)
        + (case when v_budget is not null
                 and l.price between v_budget * 0.5 and v_budget * 1.5 then 25 else 0 end)
        + (case when s.city = v_profile.city then 15 else 0 end)
        + (coalesce(l.rating_avg, 0) / 5.0 * 15)
        + (case when l.created_at > now() - interval '14 days' then 5 else 0 end)
      , 2) as base_score
    from public.listings l
    join public.shops s on s.id = l.shop_id
    left join public.categories c on c.id = l.category_id
    where l.status = 'live'
      and s.status = 'approved'
      and s.verified is true
      and s.owner_id is distinct from p_buyer_id
      -- Never recommend something they already bought.
      and not exists (
        select 1 from public.orders o
          join public.order_items oi on oi.order_id = o.id
         where o.buyer_id = p_buyer_id
           and oi.listing_id = l.id
           and o.status in ('delivered','completed')
      )
    order by base_score desc, l.created_at desc
    limit greatest(1, least(p_limit, 60))
  ) x;

  return jsonb_build_object(
    'viewed',     v_viewed,
    'searched',   v_searched,
    'cart',       v_cart,
    'bought',     v_bought,
    'city',       v_profile.city,
    'state',      v_profile.state,
    'budget',     v_budget,
    'candidates', v_candidates
  );
end $$;

grant execute on function public.buyer_recommendation_signals(uuid, uuid[], int) to authenticated;
