-- =====================================================================
-- 0015 — seller tags, real search, and ranked/rotating storefront
-- =====================================================================
--
-- Three reported bugs, one migration:
--
--   1. CATEGORY FILTER SHOWED EVERYTHING.
--      The storefront filtered with `.eq("categories.slug", …)` against an
--      embedded (left-joined) resource. PostgREST applies that predicate to
--      the *embedded* rows, not to the parent listing, so every listing came
--      back and the non-matching ones simply carried `categories: null`.
--      The fix is not a different embed — it is to stop filtering through a
--      join at all. `search_listing_ids` resolves the slug to a category id
--      and filters `listings.category_id` directly, which is both correct
--      and indexable.
--
--   2. SEARCH COULD NOT FIND LISTED ITEMS.
--      Search was `title ILIKE '%q%'` — one substring, one column. A listing
--      titled "LG 7kg Front Load Washer" was invisible to "washing machine",
--      and seller tags did not exist. This migration adds `listings.tags`
--      (max 20, normalised) and a weighted tsvector over title + tags +
--      description, with a substring fallback so partial words still hit.
--
--   3. NO RANKING, NO ROTATION.
--      Results were `order by created_at desc` — newest wins, always, so the
--      same listings owned page one forever. `search_listing_ids` scores on
--      relevance, recency (3-day window), rating and sales; `storefront_feed`
--      interleaves four buckets round-robin and re-seeds daily so tomorrow's
--      storefront is not today's.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Seller tags
-- ---------------------------------------------------------------------
alter table public.listings
  add column if not exists tags text[] not null default '{}';

-- A listing may carry at most 20 tags. Enforced in the database because the
-- form is not the only writer (a crafted insert must not bypass it).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listings_tags_max'
  ) then
    alter table public.listings
      add constraint listings_tags_max
      check (coalesce(array_length(tags, 1), 0) <= 20);
  end if;
end $$;

-- Weighted full-text vector. Maintained by trigger rather than a GENERATED
-- column: `array_to_string` is not immutable, so Postgres refuses it inside
-- a generated expression.
alter table public.listings
  add column if not exists search_vector tsvector;

create index if not exists listings_tags_gin_idx
  on public.listings using gin (tags);

create index if not exists listings_search_vector_idx
  on public.listings using gin (search_vector);

-- ---------------------------------------------------------------------
-- 2. Normalise tags + maintain search_vector
-- ---------------------------------------------------------------------
-- Lowercase, collapse inner whitespace, trim, drop empties, de-duplicate
-- (order preserved) and cap at 20. Doing this in the database means the
-- search index and the stored tags can never disagree about casing.
create or replace function public.tg_listings_tags_search()
returns trigger
language plpgsql
as $$
declare
  v_raw  text[];
  v_out  text[] := '{}';
  v_t    text;
begin
  v_raw := coalesce(new.tags, '{}');

  foreach v_t in array v_raw loop
    v_t := lower(btrim(regexp_replace(coalesce(v_t, ''), '\s+', ' ', 'g')));
    if v_t <> '' and not (v_t = any (v_out)) then
      v_out := v_out || v_t;
    end if;
  end loop;

  -- Deliberately NOT truncated to 20 here. Silently dropping a seller's
  -- 21st tag would look like a successful save while losing their data;
  -- the listings_tags_max constraint rejects the write instead, and the
  -- form stops the seller before they get that far.
  new.tags := coalesce(v_out, '{}');

  -- Title and tags are weighted A (a tag hit is as strong as a title hit —
  -- that is the whole point of seller tagging); description is B.
  new.search_vector :=
      setweight(to_tsvector('simple', coalesce(new.title, '')), 'A')
   || setweight(to_tsvector('simple', array_to_string(new.tags, ' ')), 'A')
   || setweight(to_tsvector('simple', coalesce(new.description, '')), 'B');

  return new;
end $$;

drop trigger if exists t_listings_tags_search on public.listings;
create trigger t_listings_tags_search
  before insert or update of title, description, tags on public.listings
  for each row execute function public.tg_listings_tags_search();

-- Backfill: existing rows have no search_vector yet, and the trigger only
-- fires on write. Touching `tags` re-runs it for every row.
update public.listings set tags = tags where search_vector is null;

-- ---------------------------------------------------------------------
-- 3. Sales counter (used by the ranking score)
-- ---------------------------------------------------------------------
-- A "sale" is an order that actually completed. Counting pending_payment or
-- cancelled orders would let a seller rank up by placing and abandoning
-- their own orders.
create or replace view public.listing_sales as
  select oi.listing_id,
         sum(oi.quantity)::int as units_sold
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.listing_id is not null
     and o.status in ('delivered', 'completed')
   group by oi.listing_id;

-- ---------------------------------------------------------------------
-- 4. Ranked search
-- ---------------------------------------------------------------------
-- Returns ids in ranked order. The caller fetches the full rows (with the
-- shop and category embeds the cards need) and re-sorts by this order —
-- keeping the ranking in SQL where the data is, and the shaping in TS.
--
-- p_category is a category SLUG (what the URL carries), resolved here to an
-- id so the filter lands on listings.category_id and uses the index.
create or replace function public.search_listing_ids(
  p_q          text    default null,
  p_category   text    default null,
  p_city       text    default null,
  p_type       text    default null,
  p_min        numeric default null,
  p_max        numeric default null,
  p_min_rating numeric default null,
  p_pickup     boolean default false,
  p_verified   boolean default false,
  p_sort       text    default null,
  p_limit      int     default 60,
  p_offset     int     default 0
)
returns table (id uuid, rank_score numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_tsq    tsquery;
  v_expr   text;
  v_q      text := nullif(btrim(coalesce(p_q, '')), '');
  v_cat_id uuid;
  v_seed   text := to_char(now(), 'YYYY-MM-DD');
begin
  -- Resolve the category slug once. An unknown slug must return nothing,
  -- not everything — that was the original bug.
  if p_category is not null and btrim(p_category) <> '' then
    select c.id into v_cat_id
      from public.categories c
     where c.slug = btrim(p_category);

    if v_cat_id is null then
      return;
    end if;
  end if;

  -- Prefix-AND query: "washing machine" -> washing:* & machine:*
  -- so "wash" still finds "washing" and both words must be present.
  if v_q is not null then
    select string_agg(t || ':*', ' & ' order by t)
      into v_expr
      from unnest(regexp_split_to_array(lower(v_q), '\s+')) t
     where t <> '';

    if v_expr is not null then
      begin
        v_tsq := to_tsquery('simple', v_expr);
      exception when others then
        v_tsq := null;  -- malformed input must not 500 the storefront
      end;
    end if;
  end if;

  return query
  with base as (
    select
      l.id,
      l.price,
      l.created_at,
      l.search_vector,
      coalesce(s.rating_avg, 0)   as rating_avg,
      coalesce(sales.units_sold, 0) as units_sold,
      -- Daily-seeded jitter: stable within a day, different tomorrow. This
      -- is what stops the same listings owning page one forever.
      (
        (('x' || substr(md5(l.id::text || v_seed), 1, 8))::bit(32)::int
          & 2147483647) % 1000
      ) / 1000.0 as jitter
    from public.listings l
    join public.shops s on s.id = l.shop_id
    left join public.listing_sales sales on sales.listing_id = l.id
    where l.status = 'live'
      and s.status = 'approved'
      and (v_cat_id is null or l.category_id = v_cat_id)
      and (p_city is null or btrim(p_city) = '' or s.city = btrim(p_city))
      and (p_type is null or l.type = p_type)
      and (p_min is null or l.price >= p_min)
      and (p_max is null or l.price <= p_max)
      and (p_min_rating is null or coalesce(s.rating_avg, 0) >= p_min_rating)
      and (not p_pickup or s.pickup_available)
      and (not p_verified or s.verified)
      and (
        v_q is null
        or (v_tsq is not null and l.search_vector @@ v_tsq)
        -- Fallback: full-text misses partial words and punctuation, so a
        -- plain substring over title and tags catches the rest.
        or l.title ilike '%' || v_q || '%'
        or exists (
             select 1 from unnest(l.tags) tg
              where tg ilike '%' || lower(v_q) || '%'
           )
      )
  )
  select
    b.id,
    (
      case when v_tsq is not null
           then ts_rank_cd(b.search_vector, v_tsq) * 12.0
           else 0 end
      -- Freshness: a 3-day window, then a softer 7-day one.
      + case when b.created_at > now() - interval '3 days' then 3.0
             when b.created_at > now() - interval '7 days' then 1.5
             else 0 end
      + (b.rating_avg / 5.0) * 2.0
      + least(ln(1 + b.units_sold), 3.0) * 0.8
      + b.jitter * 1.2
    )::numeric as rank_score
  from base b
  order by
    -- An explicit price sort is a user instruction; it outranks relevance.
    case when p_sort = 'price_asc'  then b.price end asc nulls last,
    case when p_sort = 'price_desc' then b.price end desc nulls last,
    case when p_sort is null or p_sort not in ('price_asc', 'price_desc')
         then (
           case when v_tsq is not null
                then ts_rank_cd(b.search_vector, v_tsq) * 12.0
                else 0 end
           + case when b.created_at > now() - interval '3 days' then 3.0
                  when b.created_at > now() - interval '7 days' then 1.5
                  else 0 end
           + (b.rating_avg / 5.0) * 2.0
           + least(ln(1 + b.units_sold), 3.0) * 0.8
           + b.jitter * 1.2
         ) end desc nulls last,
    b.created_at desc
  limit greatest(coalesce(p_limit, 60), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------------
-- 5. Storefront feed — balanced buckets, rotating daily
-- ---------------------------------------------------------------------
-- Page one is not "the newest 8". It is a round-robin over four buckets:
--
--   new      — listed in the last 3 days
--   rated    — 4.0+ with at least one review
--   selling  — most units actually sold
--   popular  — most viewed (the catch-all that keeps small shops visible)
--
-- Round-robin means one from each bucket, then the next from each, so no
-- single signal can flood the page. The daily seed re-orders within each
-- bucket, so a shop that was 4th yesterday can be 1st today.
create or replace function public.storefront_feed(
  p_city  text default null,
  p_type  text default 'product',
  p_limit int  default 8,
  p_seed  text default null
)
returns table (id uuid, bucket text, rank_score numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_seed text := coalesce(nullif(btrim(p_seed), ''), to_char(now(), 'YYYY-MM-DD'));
  v_lim  int  := greatest(coalesce(p_limit, 8), 1);
begin
  return query
  with eligible as (
    select
      l.id,
      l.created_at,
      l.views,
      coalesce(s.rating_avg, 0)     as rating_avg,
      coalesce(s.rating_count, 0)   as rating_count,
      coalesce(sales.units_sold, 0) as units_sold,
      (
        (('x' || substr(md5(l.id::text || v_seed), 1, 8))::bit(32)::int
          & 2147483647) % 1000
      ) / 1000.0 as jitter
    from public.listings l
    join public.shops s on s.id = l.shop_id
    left join public.listing_sales sales on sales.listing_id = l.id
    where l.status = 'live'
      and s.status = 'approved'
      and (p_type is null or l.type = p_type)
      and (p_city is null or btrim(p_city) = '' or s.city = btrim(p_city))
  ),
  -- Each bucket is scored on its own signal, then jittered by the day seed.
  scored as (
    select e.id, 'new'::text as bucket,
           (case when e.created_at > now() - interval '3 days' then 10.0 else 0 end
            + e.jitter)::numeric as rank_score
      from eligible e
     where e.created_at > now() - interval '3 days'

    union all
    select e.id, 'rated'::text,
           (e.rating_avg * 2.0 + least(e.rating_count, 20) * 0.1 + e.jitter)::numeric
      from eligible e
     where e.rating_avg >= 4.0 and e.rating_count >= 1

    union all
    select e.id, 'selling'::text,
           (least(ln(1 + e.units_sold), 4.0) * 2.5 + e.jitter)::numeric
      from eligible e
     where e.units_sold > 0

    union all
    select e.id, 'popular'::text,
           (least(ln(1 + e.views), 5.0) + e.jitter)::numeric
      from eligible e
  ),
  -- One row per listing even if it qualifies for several buckets: the
  -- strongest bucket wins, so the round-robin cannot show it twice.
  best as (
    select distinct on (s.id) s.id, s.bucket, s.rank_score
      from scored s
     order by s.id, s.rank_score desc
  ),
  ranked as (
    select b.id, b.bucket, b.rank_score,
           row_number() over (
             partition by b.bucket
             order by b.rank_score desc, b.id
           ) as rn
      from best b
  )
  select r.id, r.bucket, r.rank_score
    from ranked r
   where r.rn <= v_lim
   order by
     r.rn,
     -- Rotate which bucket leads, so the first card is not always "new".
     ((case r.bucket when 'new' then 0 when 'rated' then 1
                     when 'selling' then 2 else 3 end)
       + (('x' || substr(md5(v_seed), 1, 8))::bit(32)::int & 3)) % 4
   limit v_lim;
end $$;

-- ---------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------
-- Both are read-only ranking helpers over already-public rows; the RLS on
-- `listings` and `shops` still applies because they are SECURITY INVOKER.
grant execute on function public.search_listing_ids(
  text, text, text, text, numeric, numeric, numeric, boolean, boolean, text, int, int
) to anon, authenticated;

grant execute on function public.storefront_feed(text, text, int, text)
  to anon, authenticated;

grant select on public.listing_sales to anon, authenticated;
