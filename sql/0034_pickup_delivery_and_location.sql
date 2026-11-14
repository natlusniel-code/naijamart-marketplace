-- ---------------------------------------------------------------------
-- 0034 — pickup vs delivery per listing, shop pickup location, and
--        location sharing in chat.
--
-- WHY
--   Checkout only ever offered delivery. A seller with a physical shop had
--   no way to say "collect it from me", and a buyer standing in that shop
--   still paid a courier fee for a parcel nobody was going to carry.
--
--   This migration adds the three pieces that were missing:
--
--     1. `listings.fulfilment_mode` — the seller's choice, per listing:
--        'both' (default), 'pickup' or 'delivery'.
--     2. `shops.shop_lat / shop_lng / shop_address` — where a buyer
--        actually collects from. Coordinates are optional; the address is
--        what a human reads, the pin is what a map opens.
--     3. `messages.lat / lng / location_label` — a location a buyer or
--        seller deliberately shares inside a chat.
--
--   The fee rule is unchanged and is the one the brief asks for: pickup
--   carries NO delivery fee, delivery carries the shop/listing fee. A
--   seller who only offers pickup still sets a delivery fee — it simply
--   never applies, because no delivery can be chosen.
--
-- PRIVACY
--   Nothing here stores a visitor's coordinates. The footer "Share My
--   Location" button is pure client-side: it reads the browser position and
--   opens Google Maps in a new tab. The only coordinates that reach the
--   database are ones a signed-in user explicitly sends to the other party
--   in a chat, which is a deliberate act with its own button and its own
--   confirmation.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. listings.fulfilment_mode
-- ---------------------------------------------------------------------
alter table public.listings
  add column if not exists fulfilment_mode text not null default 'both';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listings_fulfilment_mode_check'
  ) then
    alter table public.listings
      add constraint listings_fulfilment_mode_check
      check (fulfilment_mode in ('both', 'pickup', 'delivery'));
  end if;
end $$;

comment on column public.listings.fulfilment_mode is
  'How this listing can be fulfilled: both (default), pickup only, or delivery only.';

-- ---------------------------------------------------------------------
-- 2. shops — the pickup point
-- ---------------------------------------------------------------------
alter table public.shops add column if not exists shop_lat     double precision;
alter table public.shops add column if not exists shop_lng     double precision;
alter table public.shops add column if not exists shop_address text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shops_lat_range_check'
  ) then
    alter table public.shops
      add constraint shops_lat_range_check
      check (shop_lat is null or (shop_lat between -90 and 90));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'shops_lng_range_check'
  ) then
    alter table public.shops
      add constraint shops_lng_range_check
      check (shop_lng is null or (shop_lng between -180 and 180));
  end if;
end $$;

comment on column public.shops.shop_address is
  'Human-readable pickup address shown to a buyer who chose pickup.';
comment on column public.shops.shop_lat is
  'Optional pickup pin latitude. Set by the seller from their own browser.';

-- ---------------------------------------------------------------------
-- 3. messages — a deliberately shared location
-- ---------------------------------------------------------------------
alter table public.messages add column if not exists lat            double precision;
alter table public.messages add column if not exists lng            double precision;
alter table public.messages add column if not exists location_label text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_lat_range_check'
  ) then
    alter table public.messages
      add constraint messages_lat_range_check
      check (lat is null or (lat between -90 and 90));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'messages_lng_range_check'
  ) then
    alter table public.messages
      add constraint messages_lng_range_check
      check (lng is null or (lng between -180 and 180));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. send_chat_message — carry an optional location
-- ---------------------------------------------------------------------
-- The 4-argument version is dropped first: adding defaulted arguments
-- would otherwise leave two overloads and make every call ambiguous.
drop function if exists public.send_chat_message(uuid, text, text, uuid[]);

create or replace function public.send_chat_message(
  p_chat_id        uuid,
  p_body           text default null,
  p_image_url      text default null,
  p_package_ids    uuid[] default null,
  p_lat            double precision default null,
  p_lng            double precision default null,
  p_location_label text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_chat     public.chats;
  v_receiver uuid;
  v_rule     record;
  v_msg      public.messages;
  v_body     text := nullif(btrim(coalesce(p_body, '')), '');
  v_image    text := nullif(btrim(coalesce(p_image_url, '')), '');
  v_label    text := nullif(btrim(coalesce(p_location_label, '')), '');
  v_canon    text;
  v_check    text;
  v_exempt   boolean := false;
  v_warning  text := 'This message was not sent because it contains restricted contact, payment, or external platform information. Please keep all communication and payment inside the platform.';
begin
  if v_uid is null then
    raise exception 'Sign in to send a message.';
  end if;

  select * into v_chat from public.chats where id = p_chat_id;
  if not found then
    raise exception 'Chat not found.';
  end if;
  if v_chat.buyer_id <> v_uid and v_chat.seller_id <> v_uid then
    raise exception 'This chat is not yours.';
  end if;

  v_receiver := case when v_chat.buyer_id = v_uid then v_chat.seller_id else v_chat.buyer_id end;

  -- A location is a message on its own: it needs no body and no image.
  if v_body is null and v_image is null and p_lat is null then
    raise exception 'Type a message first.';
  end if;

  if p_lat is not null and (p_lat < -90 or p_lat > 90) then
    raise exception 'That location is not valid.';
  end if;
  if p_lng is not null and (p_lng < -180 or p_lng > 180) then
    raise exception 'That location is not valid.';
  end if;

  if v_body is not null then
    v_check := v_body;

    -- Rebuild the plan text from the database and require the message to
    -- begin with it. `left(...) = v_canon` is an exact byte comparison, so
    -- a buyer cannot hand-type a near-miss and have it treated as exempt.
    if p_package_ids is not null then
      v_canon := public.nm_plan_draft(p_package_ids);
      if v_canon is not null and left(v_body, length(v_canon)) = v_canon then
        v_exempt := true;
        -- Only what the buyer added AFTER the plan is checked.
        v_check := btrim(substr(v_body, length(v_canon) + 1));
      end if;
    end if;

    if v_check is not null and btrim(v_check) <> '' then
      select * into v_rule from public.nm_check_message(v_check) limit 1;
      if found then
        insert into public.blocked_messages
          (chat_id, sender_id, receiver_id, body, rule_group, rule_pattern, matched_text)
        values
          (p_chat_id, v_uid, v_receiver, v_body, v_rule.rule_group, v_rule.pattern, v_rule.matched);

        -- Nothing is inserted into `messages`: the receiver never sees it,
        -- and no partial or masked copy is sent.
        return jsonb_build_object('blocked', true, 'warning', v_warning);
      end if;
    end if;
  end if;

  -- Tell the trigger this row's prefix is the app's own text. Transaction
  -- local, so it dies with this call and cannot affect the next message.
  perform set_config('nm.plan_exempt', case when v_exempt then 'on' else 'off' end, true);

  insert into public.messages (chat_id, sender_id, body, image_url, lat, lng, location_label)
  values (p_chat_id, v_uid, v_body, v_image, p_lat, p_lng, v_label)
  returning * into v_msg;

  return jsonb_build_object('blocked', false, 'message', to_jsonb(v_msg));
end $$;

grant execute on function public.send_chat_message(uuid, text, text, uuid[], double precision, double precision, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- 5. place_order — honour the listing's fulfilment mode
-- ---------------------------------------------------------------------
-- Everything from 0021 is kept. The only additions are:
--   * a pickup order is refused if any line is delivery-only;
--   * a delivery order is refused if any line is pickup-only;
--   * the fee stays 0 for pickup (already true) and is never charged for a
--     basket that holds no physical goods (already true).
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

    -- The seller's fulfilment choice is enforced here, not in the client:
    -- a tampered cart cannot collect an item the seller only ships, or
    -- have one shipped that the seller only hands over.
    if p_fulfilment = 'pickup' and v_listing.fulfilment_mode = 'delivery' then
      raise exception '% is delivery only — it cannot be picked up.', v_listing.title;
    end if;
    if p_fulfilment = 'delivery' and v_listing.fulfilment_mode = 'pickup' then
      raise exception '% is pickup only — choose pickup to order it.', v_listing.title;
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

  -- delivery fee: only physical goods are shipped, and only when the buyer
  -- chose delivery. Pickup is always free — that is the whole point of it.
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
  --   pickup                     -> no restriction: the buyer travels
  --   total >  cross_lga_min_total  -> anywhere in the country
  --   total <= cross_lga_min_total  -> the buyer's own state AND LGA
  -- ------------------------------------------------------------------
  v_min := coalesce(v_cfg.cross_lga_min_total, 20000);
  v_same_state := (v_buyer.state is null or v_shop.state is null
                   or lower(btrim(v_buyer.state)) = lower(btrim(v_shop.state)));
  v_same_lga   := (v_buyer.city is null or v_shop.city is null
                   or lower(btrim(v_buyer.city)) = lower(btrim(v_shop.city)));

  if not v_all_online and p_fulfilment <> 'pickup' then
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

grant execute on function public.place_order(uuid, jsonb, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. shop_locations view — expose the pickup pin to the storefront
-- ---------------------------------------------------------------------
-- The view already exists for city browsing. Recreate it with the pickup
-- columns so a listing page can render a map link without a second query.
drop view if exists public.shop_locations;

create view public.shop_locations as
  select
    s.id,
    s.slug,
    s.name,
    s.city,
    s.state,
    s.shop_address,
    s.shop_lat,
    s.shop_lng,
    s.pickup_available,
    count(l.id)::int as listing_count
  from public.shops s
  left join public.listings l on l.shop_id = s.id and l.status = 'live'
  where s.status = 'approved'
  group by s.id, s.slug, s.name, s.city, s.state, s.shop_address,
           s.shop_lat, s.shop_lng, s.pickup_available;

grant select on public.shop_locations to anon, authenticated;

notify pgrst, 'reload schema';
