-- =====================================================================
-- 0016 — nationwide delivery for orders over the threshold
-- =====================================================================
--
-- Run AFTER 0011. Idempotent: safe to run more than once.
--
-- WHAT CHANGED
--
-- 0011 introduced the distance rule:
--
--   total >  cross_lga_min_total  -> any LGA, but ONLY inside the buyer's
--                                    own state
--   total <= cross_lga_min_total  -> the buyer's own state AND LGA
--
-- The first branch was too tight. A buyer in Ogun could not order a
-- ₦159,999 item from a seller in Oyo, even though the whole point of the
-- threshold is that a large enough basket is worth a longer trip. The
-- rule is now:
--
--   total >  cross_lga_min_total  -> ANYWHERE IN THE COUNTRY
--   total <= cross_lga_min_total  -> the buyer's own state AND LGA
--
-- The under-threshold branch is deliberately unchanged: a small basket
-- still has to be local, which is what keeps delivery economics sane.
--
-- A missing state/LGA on either side is still treated as "no
-- restriction" — the old behaviour for profiles that never set a
-- location. That is what makes the rule safe to tighten later without
-- locking out existing accounts.
--
-- Both `place_order()` (the authority) and `checkout_range()` (the
-- helper the UI reads) are replaced together, so the message the buyer
-- sees and the rule the server enforces cannot drift apart.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. place_order — nationwide over the threshold
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

    v_subtotal := v_subtotal + (v_listing.price * v_qty);
    v_lines := v_lines || jsonb_build_object(
      'listing_id', v_listing.id,
      'title', v_listing.title,
      'unit_price', v_listing.price,
      'quantity', v_qty,
      'line_total', (v_listing.price * v_qty)
    );
  end loop;

  -- delivery fee: the most specific listing override wins, else the shop default
  if p_fulfilment = 'delivery' then
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

  if v_fee is null then v_fee := coalesce(v_cfg.default_delivery_fee, 0); end if;
  v_total := v_subtotal + v_fee;

  -- ------------------------------------------------------------------
  -- DISTANCE RULE (server-side, cannot be skipped from the browser)
  --   total >  cross_lga_min_total  -> anywhere in the country
  --   total <= cross_lga_min_total  -> the buyer's own state AND LGA
  -- A missing state/LGA on either side is treated as "no restriction",
  -- which is the old behaviour for profiles that never set a location.
  -- ------------------------------------------------------------------
  v_min := coalesce(v_cfg.cross_lga_min_total, 20000);
  v_same_state := (v_buyer.state is null or v_shop.state is null
                   or lower(btrim(v_buyer.state)) = lower(btrim(v_shop.state)));
  v_same_lga   := (v_buyer.city is null or v_shop.city is null
                   or lower(btrim(v_buyer.city)) = lower(btrim(v_shop.city)));

  -- over the threshold there is no distance restriction at all, so only
  -- the under-threshold branch has anything to enforce.
  if v_total <= v_min and (not v_same_state or not v_same_lga) then
    raise exception 'This seller is in %, outside your LGA (%). Orders under % can only be placed with sellers in your own LGA — add more items to reach % and you can order from anywhere in the country.',
      coalesce(v_shop.city, v_shop.state, 'another area'),
      coalesce(v_buyer.city, 'not set'),
      to_char(v_min, 'FM999,999,999'),
      to_char(v_min, 'FM999,999,999');
  end if;

  -- the account the buyer was shown at checkout
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

  -- reserve stock immediately so two buyers can't take the last unit
  update public.listings l
    set stock = l.stock - (d->>'quantity')::int,
        status = case when l.stock - (d->>'quantity')::int <= 0 and l.type = 'product'
                      then 'out_of_stock' else l.status end
    from jsonb_array_elements(v_lines) d
    where l.id = (d->>'listing_id')::uuid and l.type = 'product';

  -- buyer "receipts" list needs the payment row to exist
  insert into public.payments (order_id, type, amount, reference, payment_account_id)
  values (v_order.id, 'order', v_total, v_order.reference, v_acct.id);

  -- the reservation is spent: the next order rotates to another account
  update public.payment_account_assignments
     set order_id = v_order.id, expires_at = now()
   where buyer_id = v_uid and account_id = v_acct.id and order_id is null;

  return v_order;
end $$;

-- ---------------------------------------------------------------------
-- 2. checkout_range — the helper the UI reads, same rule
-- ---------------------------------------------------------------------

-- The pre-0011 single-argument overload is still present on the live
-- database. It takes no total, so it can only ever answer the
-- under-threshold question, and it still carries the old "not outside
-- your state" wording. Nothing calls it, but leaving a second function
-- with the same name and a different rule is exactly how the UI and the
-- server drift apart. Drop it.
drop function if exists public.checkout_range(uuid);
create or replace function public.checkout_range(p_shop_id uuid, p_total numeric)
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

  if v_uid is null then
    return jsonb_build_object('allowed', true, 'threshold', v_min);
  end if;

  select * into v_buyer from public.profiles where id = v_uid;

  v_same_state := (v_buyer.state is null or v_shop.state is null
                   or lower(btrim(v_buyer.state)) = lower(btrim(v_shop.state)));
  v_same_lga   := (v_buyer.city is null or v_shop.city is null
                   or lower(btrim(v_buyer.city)) = lower(btrim(v_shop.city)));

  if coalesce(p_total, 0) > v_min then
    -- over the threshold: anywhere in the country
    return jsonb_build_object('allowed', true, 'threshold', v_min, 'mode', 'nationwide');
  end if;

  if v_same_state and v_same_lga then
    return jsonb_build_object('allowed', true, 'threshold', v_min, 'mode', 'lga');
  end if;

  return jsonb_build_object(
    'allowed', false, 'threshold', v_min, 'mode', 'lga',
    'reason', format('This seller is in %s, outside your LGA (%s). Orders under %s can only be placed with sellers in your own LGA — add more items to reach %s and you can order from anywhere in the country.',
                     coalesce(v_shop.city, v_shop.state, 'another area'),
                     coalesce(v_buyer.city, 'not set'),
                     to_char(v_min, 'FM999,999,999'),
                     to_char(v_min, 'FM999,999,999')));
end $$;

grant execute on function public.checkout_range(uuid, numeric) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 3. Tell PostgREST to reload its schema cache
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
