-- ---------------------------------------------------------------------
-- 0024 — a service is not bound by the delivery distance rule
-- ---------------------------------------------------------------------
-- THE BUG
--   A buyer in Odeda tried to buy a ₦5,000 logo from a provider in Ijebu
--   Ode and was refused:
--
--     "Fex Graphics is in Ijebu Ode, outside your LGA (Odeda). Orders under
--      ₦20,000 can only be placed with sellers in your own LGA..."
--
--   Nothing was going to travel. The work is a file, sent over chat. The
--   cross-LGA rule exists to stop a cheap parcel being couriered across the
--   country for less than the delivery costs — it has no meaning for a
--   service, and applying it made every affordable gig unbookable outside
--   the buyer's own LGA.
--
-- THE FIX
--   The distance check now runs only when the basket contains physical
--   goods (`v_has_goods`). A service-only basket skips it entirely, at any
--   price. A mixed basket still pays the courier fee and still obeys the
--   rule, because the goods in it really do travel.
--
--   This is the same condition the client already applies in
--   `checkout-flow.tsx` (`if (isServiceOnly(shop)) return null;`), so the
--   message the buyer sees and the rule the server enforces agree.
--
-- WHY A NEW FILE
--   `place_order` is redefined in 0003, 0011, 0016, 0019, 0021 and 0023.
--   Postgres keeps only the LAST definition, so editing an earlier file
--   would change nothing in a live database. This file re-declares the
--   function from 0023's current body — the discounted `effective_price`
--   pricing, the package_tier column, the no-fee-for-services rule — with
--   the single distance condition changed.
--
--   Everything else is byte-for-byte 0023. Do not "tidy" it here: a
--   divergence between this and 0023 is how the two prices drift apart.
-- ---------------------------------------------------------------------

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

  -- ── THE ONE CHANGE FROM 0023 ──────────────────────────────────────
  -- `v_has_goods` is now part of the condition. A basket of services has
  -- nothing to deliver, so there is no distance to measure: the buyer may
  -- order from any LGA at any price. A basket containing a product still
  -- obeys the rule exactly as before.
  if v_has_goods and not v_all_online then
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
-- checkout_range — the same rule, for the pre-checkout probe
-- ---------------------------------------------------------------------
-- The client calls this to decide whether to show bank details. It already
-- had an `online` escape hatch, but a HOME-VISIT gig (service_mode =
-- 'home') still fell through to the LGA check. A service is a service:
-- whether the provider travels to the buyer or works remotely, nothing is
-- being couriered, so the parcel rule does not apply.
--
-- `p_is_service` is added with a default so existing callers keep working.
drop function if exists public.checkout_range(uuid, numeric, boolean);

create or replace function public.checkout_range(
  p_shop_id    uuid,
  p_total      numeric,
  p_online     boolean default false,
  p_is_service boolean default false
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

  -- A service has no coverage area to check: the work is delivered as a
  -- file or performed on site, and no parcel crosses an LGA boundary.
  if coalesce(p_is_service, false) then
    return jsonb_build_object('allowed', true, 'threshold', v_min, 'mode', 'service');
  end if;

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
    'reason', format('This seller is in %s, outside your LGA (%s). Orders under %s can only be placed with sellers in your own LGA.',
                     coalesce(v_shop.city, v_shop.state, 'another area'),
                     coalesce(v_buyer.city, 'not set'),
                     to_char(v_min, 'FM999,999,999')));
end $$;

-- ---------------------------------------------------------------------
-- PostgREST must be told the schema changed
-- ---------------------------------------------------------------------
-- Without this the API keeps serving the function it read at boot, and the
-- new definition stays invisible until the next restart — the same
-- "in the schema cache" failure that made 0011 and 0013 look unapplied.
notify pgrst, 'reload schema';
