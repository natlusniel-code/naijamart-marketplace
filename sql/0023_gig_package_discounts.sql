-- =====================================================================
-- 0023 — gig plan discounts
-- =====================================================================
--
-- Run AFTER 0021. Idempotent: safe to run more than once.
--
-- WHY
--
-- A seller can now edit their Basic / Standard / Premium plans, and put a
-- plan on sale. A discount must be a FIRST-CLASS column, not a seller
-- rewriting `price`:
--
--   * the buyer needs to see "was ₦18,000, now ₦14,400, 20% off" — a
--     silently lowered price would hide that the plan was discounted;
--   * a discount is temporary, so the seller must be able to end it and get
--     the original price back without remembering what it was;
--   * `place_order` prices the line from this table, so the discount has to
--     be part of the priced value or the cart and the order would disagree.
--
-- So: `price` stays the list price, `discount_percent` is an optional
-- 0–90% reduction, and `effective_price` is one generated expression that
-- BOTH the storefront and `place_order` read. One definition, no drift.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The discount column
-- ---------------------------------------------------------------------
alter table public.gig_packages
  add column if not exists discount_percent numeric(5,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gig_packages_discount_check'
  ) then
    -- 0–90%, not 100: a free plan is not a discount, and a 100% line would
    -- let a seller create free orders that still carry commission maths.
    alter table public.gig_packages
      add constraint gig_packages_discount_check
      check (
        discount_percent is null
        or (discount_percent > 0 and discount_percent <= 90)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. One pricing expression, used everywhere
-- ---------------------------------------------------------------------
-- A generated column rather than a trigger or app-side maths: the database
-- is the single source of truth, so a client that edits the cart cannot
-- invent a price, and the storefront cannot show something different to
-- what `place_order` will charge.
--
-- Rounded to the kobo so `price` and `effective_price` always add up.
alter table public.gig_packages
  add column if not exists effective_price numeric(12,2)
  generated always as (
    case
      when discount_percent is null then price
      else round(price * (1 - discount_percent / 100.0), 2)
    end
  ) stored;

-- ---------------------------------------------------------------------
-- 3. place_order — charge the DISCOUNTED price
-- ---------------------------------------------------------------------
-- Same function as 0021 with one line changed: the unit price of a tiered
-- gig comes from `effective_price` instead of `price`. Everything else —
-- the no-delivery-fee rule, the distance rule, the stock decrement — is
-- untouched.
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

    -- A gig with a chosen tier is priced from that tier's EFFECTIVE price —
    -- the list price less any discount the seller put on the plan. A gig with
    -- no tier (or no packages) falls back to its starting price.
    v_unit := v_listing.price;

    if v_listing.type = 'service' and v_tier is not null then
      select * into v_pkg from public.gig_packages
        where listing_id = v_listing.id and tier = v_tier;
      if not found then
        raise exception 'The % package for % is no longer offered.', v_tier, v_listing.title;
      end if;
      v_unit := v_pkg.effective_price;
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
-- 4. Read policy: a seller must see their own DRAFT gig's plans
-- ---------------------------------------------------------------------
-- `gig_packages_read` is `using (true)`, so the edit form can load the plans
-- of the seller's own gig. That already holds. The write policy in 0021
-- covers insert/update/delete through `owns_shop`, which is what the plan
-- editor relies on — re-asserted here so re-running 0023 alone is enough.
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
-- 5. Keep listings.price (the card's "From") in step
-- ---------------------------------------------------------------------
-- The gig card and the storefront feed show `listings.price` as the "from"
-- price. If the Basic plan is discounted, that number must move with it —
-- otherwise the card advertises a price the detail page no longer honours.
create or replace function public.tg_sync_listing_from_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_listing uuid := coalesce(new.listing_id, old.listing_id);
begin
  if v_listing is null then return null; end if;

  update public.listings l
     set price = coalesce((
       select min(p.effective_price)
         from public.gig_packages p
        where p.listing_id = v_listing
     ), l.price)
   where l.id = v_listing
     and l.type = 'service'
     and exists (select 1 from public.gig_packages p where p.listing_id = v_listing);

  return null;
end $$;

drop trigger if exists t_gig_package_sync_price on public.gig_packages;
create trigger t_gig_package_sync_price
  after insert or update or delete on public.gig_packages
  for each row execute function public.tg_sync_listing_from_price();

-- Backfill: a re-run after a manual edit must not leave a stale "from" price.
update public.listings l
   set price = sub.min_price
  from (
    select listing_id, min(effective_price) as min_price
      from public.gig_packages
     group by listing_id
  ) sub
 where l.id = sub.listing_id
   and l.type = 'service'
   and l.price <> sub.min_price;

-- ---------------------------------------------------------------------
-- 6. Reload PostgREST
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
