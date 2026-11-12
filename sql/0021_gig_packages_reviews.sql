-- =====================================================================
-- 0021 — gig packages, gig reviews, per-gig rating
-- =====================================================================
--
-- Run AFTER 0020. Idempotent: safe to run more than once.
--
-- WHY
--
-- Three things a gig needs that a product does not:
--
--   1. PACKAGES. Fiverr sells a gig at three depths — Basic, Standard,
--      Premium — each with its own price, delivery time and feature list.
--      A single `listings.price` cannot express that, so the tiers live in
--      their own table and `listings.price` stays the "from" price the card
--      shows. The chosen tier is carried on the order line, and
--      `place_order` prices it from the table — never from the client.
--
--   2. REVIEWS PER GIG. `reviews` was shop-scoped only, so a buyer could
--      rate "Fex Graphics" but not "Logo creation". A gig card that shows
--      the shop's rating is misleading: a shop with one great logo gig and
--      one bad letter-writing gig would show the same stars on both. So a
--      review can now name the listing it is about, and each listing keeps
--      its own rollup.
--
--   3. RANKING ON THAT RATING. The storefront feed ranked services by the
--      SHOP's rating. It now ranks a service by the gig's own rating when
--      it has one, falling back to the shop's — so "high/positive reviews"
--      means the reviews of the thing being sold.
--
-- Nothing here changes product behaviour: a product review still has a
-- null `listing_id`, and a product still ranks on its shop's rating.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Gig packages
-- ---------------------------------------------------------------------
create table if not exists public.gig_packages (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listings(id) on delete cascade,
  tier          text not null check (tier in ('basic', 'standard', 'premium')),
  name          text not null,
  description   text,
  price         numeric(12,2) not null check (price >= 0),
  delivery_days int check (delivery_days is null or (delivery_days >= 1 and delivery_days <= 365)),
  -- What the buyer gets at this tier, one bullet per element. jsonb rather
  -- than text[] so a future tier can carry structured extras (revisions,
  -- source files) without another migration.
  features      jsonb not null default '[]'::jsonb,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  -- One row per tier per gig: a second "basic" would make the price
  -- ambiguous, and the order line only records the tier name.
  unique (listing_id, tier)
);

create index if not exists gig_packages_listing_idx
  on public.gig_packages (listing_id, sort_order);

-- A package belongs to a gig, and only a gig. A product with packages
-- would be a second pricing model nobody asked for.
create or replace function public.tg_gig_packages_service_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_type text;
begin
  select l.type into v_type from public.listings l where l.id = new.listing_id;
  if v_type is distinct from 'service' then
    raise exception 'Packages can only be attached to a service gig.';
  end if;
  return new;
end $$;

drop trigger if exists t_gig_packages_service_only on public.gig_packages;
create trigger t_gig_packages_service_only
  before insert or update of listing_id
  on public.gig_packages
  for each row execute function public.tg_gig_packages_service_only();

-- RLS: everyone may read a package (the gig page is public); only the
-- shop that owns the gig may write one.
alter table public.gig_packages enable row level security;

drop policy if exists gig_packages_read on public.gig_packages;
create policy gig_packages_read on public.gig_packages
  for select using (true);

drop policy if exists gig_packages_write on public.gig_packages;
create policy gig_packages_write on public.gig_packages
  for all
  using (
    exists (
      select 1 from public.listings l
       where l.id = gig_packages.listing_id
         and public.owns_shop(l.shop_id)
    )
  )
  with check (
    exists (
      select 1 from public.listings l
       where l.id = gig_packages.listing_id
         and public.owns_shop(l.shop_id)
    )
  );

-- ---------------------------------------------------------------------
-- 2. The order line remembers which tier was bought
-- ---------------------------------------------------------------------
alter table public.order_items
  add column if not exists package_tier text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_package_tier_check'
  ) then
    alter table public.order_items
      add constraint order_items_package_tier_check
      check (package_tier is null or package_tier in ('basic', 'standard', 'premium'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Reviews can name the gig they are about
-- ---------------------------------------------------------------------
alter table public.reviews
  add column if not exists listing_id uuid references public.listings(id) on delete set null;

create index if not exists reviews_listing_idx
  on public.reviews (listing_id)
  where listing_id is not null;

-- One review per buyer per order per listing. The old rule was one review
-- per order; a basket can now hold two gigs from the same shop, and each
-- deserves its own rating.
create unique index if not exists reviews_order_listing_uniq
  on public.reviews (order_id, listing_id)
  where order_id is not null and listing_id is not null;

-- ---------------------------------------------------------------------
-- 4. Per-listing rating rollup
-- ---------------------------------------------------------------------
alter table public.listings
  add column if not exists rating_avg numeric(3,2) not null default 0;

alter table public.listings
  add column if not exists rating_count int not null default 0;

create or replace function public.tg_refresh_listing_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare lid uuid;
begin
  lid := coalesce(new.listing_id, old.listing_id);
  if lid is null then
    return null;
  end if;

  update public.listings l set
    rating_avg = coalesce((
      select round(avg(r.rating)::numeric, 2)
        from public.reviews r
       where r.listing_id = lid and r.status = 'published'
    ), 0),
    rating_count = coalesce((
      select count(*)
        from public.reviews r
       where r.listing_id = lid and r.status = 'published'
    ), 0)
  where l.id = lid;

  return null;
end $$;

drop trigger if exists t_review_listing_rating on public.reviews;
create trigger t_review_listing_rating
  after insert or update or delete on public.reviews
  for each row execute function public.tg_refresh_listing_rating();

-- Backfill from any reviews that already name a listing (none yet, but a
-- re-run after a manual insert must not leave a stale rollup).
update public.listings l set
  rating_avg = coalesce((
    select round(avg(r.rating)::numeric, 2)
      from public.reviews r
     where r.listing_id = l.id and r.status = 'published'
  ), 0),
  rating_count = coalesce((
    select count(*)
      from public.reviews r
     where r.listing_id = l.id and r.status = 'published'
  ), 0)
where exists (select 1 from public.reviews r where r.listing_id = l.id);

-- ---------------------------------------------------------------------
-- 5. leave_gig_review
-- ---------------------------------------------------------------------
-- The shop-level `leave_review` stays exactly as it was, so a product
-- order still reviews the shop. This is the gig-scoped sibling: it also
-- completes the order, and it refuses a review from someone who did not
-- actually buy that gig.
create or replace function public.leave_gig_review(
  p_order_id   uuid,
  p_listing_id uuid,
  p_rating     int,
  p_body       text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   public.orders;
  v_listing public.listings;
  v_id      uuid;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Choose a rating from 1 to 5 stars.';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found.'; end if;
  if v_order.buyer_id <> auth.uid() then raise exception 'Not your order.'; end if;
  if v_order.status not in ('delivered', 'completed') then
    raise exception 'You can review after delivery.';
  end if;

  select * into v_listing from public.listings where id = p_listing_id;
  if not found then raise exception 'That gig no longer exists.'; end if;
  if v_listing.type <> 'service' then
    raise exception 'This is a product — review the shop instead.';
  end if;

  -- The gig must actually be on this order. Without this a buyer could
  -- rate any gig in the marketplace by guessing an id.
  if not exists (
    select 1 from public.order_items oi
     where oi.order_id = p_order_id and oi.listing_id = p_listing_id
  ) then
    raise exception 'That gig is not on this order.';
  end if;

  if exists (
    select 1 from public.reviews r
     where r.order_id = p_order_id and r.listing_id = p_listing_id
  ) then
    raise exception 'You already reviewed this gig.';
  end if;

  insert into public.reviews (order_id, buyer_id, shop_id, listing_id, rating, body)
  values (p_order_id, auth.uid(), v_order.shop_id, p_listing_id, p_rating, p_body)
  returning id into v_id;

  update public.orders
     set status = 'completed', completed_at = now()
   where id = p_order_id and status = 'delivered';

  return v_id;
end $$;

grant execute on function public.leave_gig_review(uuid, uuid, int, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- 6. place_order — price the chosen package server-side
-- ---------------------------------------------------------------------
-- The client sends `package_tier` on a gig line. The price is read from
-- `gig_packages` here, never trusted from the request: a buyer who edits
-- the cart in devtools must not be able to buy Premium for Basic money.
--
-- Everything else is unchanged from 0019 — the no-delivery-fee rule, the
-- online-gig distance exemption and the stock decrement all behave as
-- before.
create or replace function public.place_order(
  p_shop_id    uuid,
  p_items      jsonb,
  p_fulfilment text default 'delivery',
  p_address    text default null,
  p_note       text default null
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_shop     public.shops;
  v_buyer    public.profiles;
  v_item     jsonb;
  v_listing  public.listings;
  v_pkg      public.gig_packages;
  v_tier     text;
  v_qty      int;
  v_unit     numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_fee      numeric(12,2) := 0;
  v_total    numeric(12,2) := 0;
  v_order    public.orders;
  v_cfg      public.platform_settings;
  v_lines    jsonb := '[]'::jsonb;
  v_acct     public.payment_accounts;
  v_min      numeric(12,2);
  v_same_state boolean;
  v_same_lga   boolean;
  v_has_goods  boolean := false;
  v_all_online boolean := true;
begin
  if v_uid is null then raise exception 'Please sign in to place an order.'; end if;

  select * into v_buyer from public.profiles where id = v_uid;
  if v_buyer.is_banned then raise exception 'This account is suspended. Contact support.'; end if;

  select * into v_shop from public.shops where id = p_shop_id;
  if not found then raise exception 'That shop no longer exists.'; end if;
  if v_shop.status <> 'approved' then raise exception 'This shop is not taking orders right now.'; end if;

  if p_fulfilment not in ('delivery','pickup') then
    raise exception 'Choose delivery or pickup.';
  end if;
  if p_fulfilment = 'delivery' and coalesce(trim(p_address), '') = '' then
    raise exception 'Add a delivery address first.';
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  select * into v_cfg from public.platform_settings where id = 1;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(coalesce((v_item->>'quantity')::int, 1), 1);
    v_tier := nullif(btrim(coalesce(v_item->>'package_tier', '')), '');

    select * into v_listing from public.listings
      where id = (v_item->>'listing_id')::uuid and shop_id = p_shop_id;
    if not found then
      raise exception 'An item in your cart is no longer available.';
    end if;
    if v_listing.status <> 'live' then
      raise exception '% is not available right now.', v_listing.title;
    end if;
    if v_listing.type = 'product' and v_listing.stock < v_qty then
      raise exception 'Only % left of %.', v_listing.stock, v_listing.title;
    end if;

    -- Price: a gig with a chosen tier is priced from that tier. A gig with
    -- no tier (or no packages at all) falls back to its starting price, so
    -- a seller who never set packages can still be booked.
    v_unit := v_listing.price;

    if v_listing.type = 'service' and v_tier is not null then
      select * into v_pkg from public.gig_packages
        where listing_id = v_listing.id and tier = v_tier;
      if not found then
        raise exception 'The % package for % is no longer offered.', v_tier, v_listing.title;
      end if;
      v_unit := v_pkg.price;
    end if;

    if v_listing.type = 'product' then
      v_has_goods := true;
      v_all_online := false;
    elsif v_listing.service_mode is distinct from 'online' then
      v_all_online := false;
    end if;

    v_subtotal := v_subtotal + (v_unit * v_qty);
    v_lines := v_lines || jsonb_build_object(
      'listing_id', v_listing.id,
      'title', v_listing.title,
      'unit_price', v_unit,
      'quantity', v_qty,
      'line_total', (v_unit * v_qty),
      'package_tier', v_tier
    );
  end loop;

  -- delivery fee: only physical goods are shipped. A gig is performed,
  -- so a service-only basket pays nothing to have it "delivered".
  if p_fulfilment = 'delivery' and v_has_goods then
    v_fee := v_shop.delivery_fee;
    select coalesce(max((d->>'delivery_fee_override')::numeric), v_shop.delivery_fee)
      into v_fee
      from jsonb_array_elements(v_lines) d
      join public.listings l on l.id = (d->>'listing_id')::uuid
      where l.delivery_fee_override is not null;

    if v_shop.free_delivery_threshold is not null
       and v_subtotal >= v_shop.free_delivery_threshold then
      v_fee := 0;
    end if;
  else
    v_fee := 0;
  end if;

  if v_fee is null then v_fee := 0; end if;
  v_total := v_subtotal + v_fee;

  -- ------------------------------------------------------------------
  -- DISTANCE RULE
  --   online gig only            -> no restriction at all
  --   total >  cross_lga_min_total  -> anywhere in the country
  --   total <= cross_lga_min_total  -> the buyer's own state AND LGA
  -- ------------------------------------------------------------------
  v_min := coalesce(v_cfg.cross_lga_min_total, 20000);
  v_same_state := (v_buyer.state is null or v_shop.state is null
                   or lower(btrim(v_buyer.state)) = lower(btrim(v_shop.state)));
  v_same_lga   := (v_buyer.city is null or v_shop.city is null
                   or lower(btrim(v_buyer.city)) = lower(btrim(v_shop.city)));

  if not v_all_online then
    if v_total <= v_min and (not v_same_state or not v_same_lga) then
      raise exception 'This seller is in %, outside your LGA (%). Orders under % can only be placed with sellers in your own LGA — add more items to reach % and you can order from anywhere in the country.',
        coalesce(v_shop.city, v_shop.state, 'another area'),
        coalesce(v_buyer.city, 'not set'),
        to_char(v_min, 'FM999,999,999'),
        to_char(v_min, 'FM999,999,999');
    end if;
  end if;

  v_acct := public.my_payment_account();

  insert into public.orders (
    buyer_id, shop_id, status, fulfilment, subtotal, delivery_fee, total,
    commission_rate, commission_amount, payout_amount, payout_status,
    buyer_note, address, payment_account_id
  ) values (
    v_uid, p_shop_id, 'pending_payment', p_fulfilment, v_subtotal, v_fee, v_total,
    v_cfg.commission_rate, round(v_total * v_cfg.commission_rate, 2),
    round(v_total * (1 - v_cfg.commission_rate), 2), 'held',
    p_note, p_address, v_acct.id
  ) returning * into v_order;

  insert into public.order_items (
    order_id, listing_id, title, unit_price, quantity, line_total, package_tier
  )
  select v_order.id, (d->>'listing_id')::uuid, d->>'title',
         (d->>'unit_price')::numeric, (d->>'quantity')::int,
         (d->>'line_total')::numeric, nullif(d->>'package_tier', '')
  from jsonb_array_elements(v_lines) d;

  update public.listings l
    set stock = l.stock - (d->>'quantity')::int,
        status = case when l.stock - (d->>'quantity')::int <= 0 and l.type = 'product'
                      then 'out_of_stock' else l.status end
    from jsonb_array_elements(v_lines) d
    where l.id = (d->>'listing_id')::uuid and l.type = 'product';

  insert into public.payments (order_id, type, amount, reference, payment_account_id)
  values (v_order.id, 'order', v_total, v_order.reference, v_acct.id);

  update public.payment_account_assignments
     set order_id = v_order.id, expires_at = now()
   where buyer_id = v_uid and account_id = v_acct.id and order_id is null;

  return v_order;
end $$;

-- ---------------------------------------------------------------------
-- 7. Ranking — a gig ranks on its own rating
-- ---------------------------------------------------------------------
-- Same buckets, same daily seed, same rotation. The only change is which
-- rating feeds the "rated" bucket and the score: a service uses its own
-- rollup when it has reviews, and falls back to the shop's when it does
-- not. A product is untouched.
drop function if exists public.storefront_feed(text, text, int, text, text, int);

create or replace function public.storefront_feed(
  p_city         text default null,
  p_type         text default null,
  p_limit        int  default 8,
  p_seed         text default null,
  p_service_mode text default null,
  p_offset       int  default 0
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
  v_off  int  := greatest(coalesce(p_offset, 0), 0);
  v_cap  int  := v_off + v_lim;
begin
  return query
  with eligible as (
    select
      l.id,
      l.created_at,
      l.views,
      -- A gig is judged on its own reviews; a product on its shop's.
      case when l.type = 'service'
           then coalesce(nullif(l.rating_avg, 0), s.rating_avg, 0)
           else coalesce(s.rating_avg, 0) end as rating_avg,
      case when l.type = 'service'
           then greatest(coalesce(l.rating_count, 0), coalesce(s.rating_count, 0))
           else coalesce(s.rating_count, 0) end as rating_count,
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
      and (p_service_mode is null or l.service_mode = p_service_mode)
      and (
        p_city is null
        or btrim(p_city) = ''
        or s.city = btrim(p_city)
        -- An online service has no coverage area, so a city filter must
        -- never hide it.
        or (l.type = 'service' and l.service_mode = 'online')
      )
  ),
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
   where r.rn <= v_cap
   order by
     r.rn,
     ((case r.bucket when 'new' then 0 when 'rated' then 1
                     when 'selling' then 2 else 3 end)
       + (('x' || substr(md5(v_seed), 1, 8))::bit(32)::int & 3)) % 4
   limit v_lim
  offset v_off;
end $$;

grant execute on function public.storefront_feed(text, text, int, text, text, int)
  to anon, authenticated;

-- Search: same substitution, so a gig found by search ranks on its own
-- reviews too. Signature is unchanged from 0019.
create or replace function public.search_listing_ids(
  p_q            text    default null,
  p_category     text    default null,
  p_city         text    default null,
  p_type         text    default null,
  p_min          numeric default null,
  p_max          numeric default null,
  p_min_rating   numeric default null,
  p_pickup       boolean default false,
  p_verified     boolean default false,
  p_sort         text    default null,
  p_limit        int     default 60,
  p_offset       int     default 0,
  p_service_mode text    default null
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
  if p_category is not null and btrim(p_category) <> '' then
    select c.id into v_cat_id
      from public.categories c
     where c.slug = btrim(p_category);

    if v_cat_id is null then
      return;
    end if;
  end if;

  if v_q is not null then
    select string_agg(t || ':*', ' & ' order by t)
      into v_expr
      from unnest(regexp_split_to_array(lower(v_q), '\s+')) t
     where t <> '';

    if v_expr is not null then
      begin
        v_tsq := to_tsquery('simple', v_expr);
      exception when others then
        v_tsq := null;
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
      case when l.type = 'service'
           then coalesce(nullif(l.rating_avg, 0), s.rating_avg, 0)
           else coalesce(s.rating_avg, 0) end as rating_avg,
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
      and (v_cat_id is null or l.category_id = v_cat_id)
      and (p_type is null or l.type = p_type)
      and (p_service_mode is null or l.service_mode = p_service_mode)
      and (p_min is null or l.price >= p_min)
      and (p_max is null or l.price <= p_max)
      and (p_min_rating is null or
           (case when l.type = 'service'
                 then coalesce(nullif(l.rating_avg, 0), s.rating_avg, 0)
                 else coalesce(s.rating_avg, 0) end) >= p_min_rating)
      and (not p_pickup or s.pickup_available)
      and (not p_verified or s.verified)
      and (
        p_city is null
        or btrim(p_city) = ''
        or s.city = btrim(p_city)
        or (l.type = 'service' and l.service_mode = 'online')
      )
      and (
        v_q is null
        or (v_tsq is not null and l.search_vector @@ v_tsq)
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
      + case when b.created_at > now() - interval '3 days' then 3.0
             when b.created_at > now() - interval '7 days' then 1.5
             else 0 end
      + (b.rating_avg / 5.0) * 2.0
      + least(ln(1 + b.units_sold), 3.0) * 0.8
      + b.jitter * 1.2
    )::numeric as rank_score
  from base b
  order by
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

grant execute on function public.search_listing_ids(
  text, text, text, text, numeric, numeric, numeric, boolean, boolean, text, int, int, text
) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Seed the three packages for gigs that have none
-- ---------------------------------------------------------------------
-- A gig with no packages still works (it is booked at its starting
-- price), but the detail page reads better with the Fiverr three-tier
-- shape. Only gigs that have NO packages are seeded, so a seller who
-- edited their tiers keeps them.
insert into public.gig_packages (listing_id, tier, name, description, price, delivery_days, features, sort_order)
select
  l.id,
  v.tier,
  v.name,
  v.description,
  round(l.price * v.mult, 2),
  -- Delivery shortens as the tier rises: Basic is the slowest, Premium the
  -- fastest. Derived from the gig's own delivery time so a seller who
  -- quotes 7 days gets 7 / 6 / 5 rather than a flat 3.
  greatest(1, coalesce(l.delivery_days, 3) - v.sort_order),
  v.features::jsonb,
  v.sort_order
from public.listings l
cross join (values
  ('basic',    'Basic',    'The essentials, delivered once.',        1.00,
   '["1 revision","Standard delivery","Source files not included"]', 0),
  ('standard', 'Standard', 'More scope and a revision round.',       1.80,
   '["3 revisions","Faster delivery","Source files included"]',      1),
  ('premium',  'Premium',  'Full scope, fastest turnaround.',        3.00,
   '["Unlimited revisions","Fastest delivery","Source files included","Priority support"]', 2)
) as v(tier, name, description, mult, features, sort_order)
where l.type = 'service'
  and l.status in ('live', 'draft')
  and not exists (
    select 1 from public.gig_packages p where p.listing_id = l.id
  );

-- ---------------------------------------------------------------------
-- 9. Tell PostgREST to reload its schema cache
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
