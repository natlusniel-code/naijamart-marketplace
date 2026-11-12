-- =====================================================================
-- 0019 — services and gigs
-- =====================================================================
--
-- Run AFTER 0018. Idempotent: safe to run more than once.
--
-- WHY THIS EXTENDS `listings` INSTEAD OF ADDING A `gigs` TABLE
--
-- A gig is a service a seller offers. Everything a gig needs to be sold
-- already exists on `listings`: title, description, images, price, tags,
-- category, shop, reviews, cart, order_items, search and ranking. A
-- separate `gigs` table would have duplicated all of that machinery and
-- — worse — produced two parallel ways to create an order, which is how
-- escrow, commission and payout accounting drift apart.
--
-- So "gig" is the UI word for a `listings` row with `type = 'service'`.
-- This migration adds the parts a gig genuinely needs and a product does
-- not: which TYPE of service it is, and how long delivery takes.
--
--
-- TWO TYPES OF SERVICE
--
--   physical  — plumbing, bricklaying, home repairs. The provider has to
--               travel, so coverage matters: a buyer can only book a
--               provider who can reach them. Enforced by the existing
--               distance rule.
--
--   online    — graphic design, web development, letter writing. The work
--               crosses no distance at all, so a city or LGA filter must
--               never hide an online gig. This is the rule that was
--               previously wrong: every service was filtered by city, so
--               a Lagos designer was invisible to a buyer in Kano.
--
-- Neither type carries a delivery fee. A service is performed, not
-- shipped, so `place_order` charges nothing for delivery when the basket
-- contains no physical goods, and `accept_offer` already wrote 0.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Gig columns
-- ---------------------------------------------------------------------
alter table public.listings
  add column if not exists service_mode text;

alter table public.listings
  add column if not exists delivery_days int;

-- Only these two values are meaningful. Applied as a named constraint so
-- re-running does not stack duplicates.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listings_service_mode_check'
  ) then
    alter table public.listings
      add constraint listings_service_mode_check
      check (service_mode is null or service_mode in ('physical', 'online'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'listings_delivery_days_check'
  ) then
    alter table public.listings
      add constraint listings_delivery_days_check
      check (delivery_days is null or (delivery_days >= 1 and delivery_days <= 365));
  end if;
end $$;

-- A service must declare which type it is; a product must not.
--
-- Backfill first: the seeded plumber predates this column and is clearly
-- a physical trade, so it is filled rather than rejected. Anything else
-- unclassified defaults to 'physical' — the stricter of the two, because
-- guessing 'online' would make an unknown provider visible nationwide.
update public.listings
   set service_mode = 'physical'
 where type = 'service' and service_mode is null;

update public.listings
   set service_mode = null
 where type = 'product' and service_mode is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listings_service_mode_required'
  ) then
    alter table public.listings
      add constraint listings_service_mode_required
      check (
        (type = 'service' and service_mode is not null)
        or (type = 'product' and service_mode is null)
      );
  end if;
end $$;

-- "Online" is the filter buyers will use most, alongside category and
-- price, so it gets its own index rather than a scan over every service.
create index if not exists listings_service_mode_idx
  on public.listings (service_mode)
  where type = 'service';

-- ---------------------------------------------------------------------
-- 2. A service never carries a delivery fee
-- ---------------------------------------------------------------------
-- The seller form hides these fields for services, but the database is
-- not the only writer. Clearing them here means a crafted insert cannot
-- attach a delivery fee to a gig, and `place_order` then has nothing to
-- charge.
create or replace function public.tg_listings_service_no_delivery()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'service' then
    new.delivery_fee_override := null;
    new.free_delivery_threshold := null;
  end if;
  return new;
end $$;

drop trigger if exists t_listings_service_no_delivery on public.listings;
create trigger t_listings_service_no_delivery
  before insert or update of type, delivery_fee_override, free_delivery_threshold
  on public.listings
  for each row execute function public.tg_listings_service_no_delivery();

-- Backfill the rows that already carry a fee.
update public.listings
   set delivery_fee_override = null,
       free_delivery_threshold = null
 where type = 'service'
   and (delivery_fee_override is not null or free_delivery_threshold is not null);

-- ---------------------------------------------------------------------
-- 3. Storefront feed — online gigs ignore the city filter
-- ---------------------------------------------------------------------
-- The signature grows by one argument (p_service_mode), so the four-column
-- version is dropped rather than left behind: two functions with the same
-- name and different rules is exactly how the UI and the server drift.
drop function if exists public.storefront_feed(text, text, int, text);

create or replace function public.storefront_feed(
  p_city         text default null,
  p_type         text default 'product',
  p_limit        int  default 8,
  p_seed         text default null,
  p_service_mode text default null
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
      and (p_service_mode is null or l.service_mode = p_service_mode)
      and (
        p_city is null
        or btrim(p_city) = ''
        or s.city = btrim(p_city)
        -- An online service has no coverage area, so a city filter must
        -- never hide it. Without this a Lagos designer is invisible to a
        -- buyer browsing from Kano.
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
   where r.rn <= v_lim
   order by
     r.rn,
     ((case r.bucket when 'new' then 0 when 'rated' then 1
                     when 'selling' then 2 else 3 end)
       + (('x' || substr(md5(v_seed), 1, 8))::bit(32)::int & 3)) % 4
   limit v_lim;
end $$;

grant execute on function public.storefront_feed(text, text, int, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Search — same rule, plus a service-mode filter
-- ---------------------------------------------------------------------
-- Same signature problem: drop the twelve-argument version, recreate with
-- the extra filter so a caller can ask for "online gigs only".
drop function if exists public.search_listing_ids(
  text, text, text, text, numeric, numeric, numeric, boolean, boolean, text, int, int
);

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
      coalesce(s.rating_avg, 0)   as rating_avg,
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
      and (p_min_rating is null or coalesce(s.rating_avg, 0) >= p_min_rating)
      and (not p_pickup or s.pickup_available)
      and (not p_verified or s.verified)
      -- An online gig crosses no distance, so the city filter must not
      -- apply to it. A physical service and every product still do.
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
-- 5. place_order — no delivery fee for a service-only basket
-- ---------------------------------------------------------------------
-- Previously the delivery fee was taken from the shop for ANY basket, so
-- a buyer booking a plumber paid a courier fee for a van that never
-- moved. The fee is now only charged when the basket contains physical
-- goods; a service-only order is zero.
--
-- The distance rule also learns about online gigs: work delivered over
-- the internet has no coverage area, so it is not restricted. A physical
-- service keeps the existing rule, because the provider does have to
-- travel.
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
  v_qty      int;
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

    -- Two facts decide the fee and the distance rule, so they are tracked
    -- while the basket is read rather than re-queried afterwards.
    if v_listing.type = 'product' then
      v_has_goods := true;
      v_all_online := false;
    elsif v_listing.service_mode is distinct from 'online' then
      v_all_online := false;
    end if;

    v_subtotal := v_subtotal + (v_listing.price * v_qty);
    v_lines := v_lines || jsonb_build_object(
      'listing_id', v_listing.id,
      'title', v_listing.title,
      'unit_price', v_listing.price,
      'quantity', v_qty,
      'line_total', (v_listing.price * v_qty)
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

  insert into public.order_items (order_id, listing_id, title, unit_price, quantity, line_total)
  select v_order.id, (d->>'listing_id')::uuid, d->>'title',
         (d->>'unit_price')::numeric, (d->>'quantity')::int, (d->>'line_total')::numeric
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
-- 6. checkout_range — an online gig is always allowed
-- ---------------------------------------------------------------------
drop function if exists public.checkout_range(uuid, numeric);

create or replace function public.checkout_range(
  p_shop_id uuid,
  p_total   numeric,
  p_online  boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_buyer public.profiles;
  v_shop  public.shops;
  v_min   numeric(12,2);
  v_same_state boolean;
  v_same_lga   boolean;
begin
  select coalesce(cross_lga_min_total, 20000) into v_min from public.platform_settings where id = 1;
  v_min := coalesce(v_min, 20000);

  select * into v_shop from public.shops where id = p_shop_id;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'That shop no longer exists.');
  end if;

  -- An online gig has no coverage area: the work travels over the
  -- internet, so there is nothing to check.
  if coalesce(p_online, false) then
    return jsonb_build_object('allowed', true, 'threshold', v_min, 'mode', 'online');
  end if;

  if v_uid is null then
    return jsonb_build_object('allowed', true, 'threshold', v_min);
  end if;

  select * into v_buyer from public.profiles where id = v_uid;

  v_same_state := (v_buyer.state is null or v_shop.state is null
                   or lower(btrim(v_buyer.state)) = lower(btrim(v_shop.state)));
  v_same_lga   := (v_buyer.city is null or v_shop.city is null
                   or lower(btrim(v_buyer.city)) = lower(btrim(v_shop.city)));

  if coalesce(p_total, 0) > v_min then
    return jsonb_build_object('allowed', true, 'threshold', v_min, 'mode', 'nationwide');
  end if;

  if v_same_state and v_same_lga then
    return jsonb_build_object('allowed', true, 'threshold', v_min, 'mode', 'lga');
  end if;

  return jsonb_build_object(
    'allowed', false, 'threshold', v_min, 'mode', 'lga',
    'reason', format('This provider is in %s, outside your LGA (%s). Bookings under %s can only be made with providers in your own LGA — or choose an online service, which has no location limit.',
                     coalesce(v_shop.city, v_shop.state, 'another area'),
                     coalesce(v_buyer.city, 'not set'),
                     to_char(v_min, 'FM999,999,999')));
end $$;

grant execute on function public.checkout_range(uuid, numeric, boolean) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 7. Gig categories
-- ---------------------------------------------------------------------
-- The storefront's service tab needs somewhere sensible to land. These
-- are inserted only when absent, so an admin who renamed one keeps their
-- name rather than getting a duplicate.
insert into public.categories (name, slug, icon, sort_order)
select v.name, v.slug, v.icon, v.sort_order
from (values
  ('Home Repairs',   'home-repairs',   '🔧',  95),
  ('Plumbing',       'plumbing',       '🚿',  96),
  ('Building & Masonry','building-masonry','🧱', 97),
  ('Cleaning',       'cleaning',       '🧹',  98),
  ('Design & Graphics','design-graphics','🎨', 99),
  ('Web & Software', 'web-software',   '💻', 100),
  ('Writing & Translation','writing-translation','✍️',101),
  ('Digital Marketing','digital-marketing','📣',102)
) as v(name, slug, icon, sort_order)
where not exists (
  select 1 from public.categories c where c.slug = v.slug
);

-- ---------------------------------------------------------------------
-- 8. Tell PostgREST to reload its schema cache
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
