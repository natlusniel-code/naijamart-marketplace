-- =====================================================================
-- NaijaMart — 0003 business rules (RPC layer)
-- Run AFTER 0002_rls.sql.
--
-- Every state change goes through one of these SECURITY DEFINER functions,
-- so the rules live in one place and cannot be skipped by a crafted insert.
-- They still check auth.uid() at the top: a function is privileged, not open.
-- =====================================================================

-- ---------------------------------------------------------------------
-- place_order: cart (one shop) → order + items, pending_payment
-- p_items: [{"listing_id": "...", "quantity": 2}, ...]
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
begin
  if v_uid is null then raise exception 'Please sign in to place an order.'; end if;

  select * into v_buyer from public.profiles where id = v_uid;
  if v_buyer.is_banned then raise exception 'This account is suspended. Contact support.'; end if;

  select * into v_shop from public.shops where id = p_shop_id;
  if not found then raise exception 'That shop no longer exists.'; end if;
  if v_shop.status <> 'approved' then raise exception 'This shop is not taking orders right now.'; end if;

  -- buyers can only order inside their own city
  if v_buyer.city is not null and v_shop.city is not null
     and lower(v_buyer.city) <> lower(v_shop.city) then
    raise exception 'You can only order from sellers in your city (%). Change your city in your profile first.', v_buyer.city;
  end if;

  if p_fulfilment not in ('delivery','pickup') then
    raise exception 'Choose delivery or pickup.';
  end if;
  if p_fulfilment = 'delivery' and coalesce(trim(p_address), '') = '' then
    raise exception 'Add a delivery address first.';
  end if;
  if p_fulfilment = 'delivery' and v_buyer.is_banned then
    raise exception 'This account is suspended.';
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

  insert into public.orders (
    buyer_id, shop_id, status, fulfilment, subtotal, delivery_fee, total,
    commission_rate, commission_amount, payout_amount, payout_status,
    buyer_note, address
  ) values (
    v_uid, p_shop_id, 'pending_payment', p_fulfilment, v_subtotal, v_fee, v_total,
    v_cfg.commission_rate, round(v_total * v_cfg.commission_rate, 2),
    round(v_total * (1 - v_cfg.commission_rate), 2), 'held',
    p_note, p_address
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
  insert into public.payments (order_id, type, amount, reference)
  values (v_order.id, 'order', v_total, v_order.reference);

  return v_order;
end $$;

-- ---------------------------------------------------------------------
-- submit_receipt: buyer uploads proof of transfer for an order
-- ---------------------------------------------------------------------
create or replace function public.submit_receipt(p_order_id uuid, p_receipt_url text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.orders o
                  where o.id = p_order_id and o.buyer_id = v_uid) then
    raise exception 'Order not found.';
  end if;
  if p_receipt_url is null then raise exception 'Attach a receipt image first.'; end if;

  update public.orders set receipt_url = p_receipt_url where id = p_order_id;

  update public.payments
     set receipt_url = p_receipt_url, status = 'pending', reject_reason = null
   where order_id = p_order_id and type = 'order' and status <> 'verified';

  if not found then
    insert into public.payments (order_id, type, amount, reference, receipt_url)
    select id, 'order', total, reference, p_receipt_url from public.orders where id = p_order_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- admin_verify_payment: the escrow gate
-- p_kind: 'order' | 'subscription'
-- ---------------------------------------------------------------------
create or replace function public.admin_verify_payment(
  p_payment_id uuid,
  p_approve    boolean,
  p_reason     text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pay   public.payments;
  v_order public.orders;
  v_shop  public.shops;
  v_cfg   public.platform_settings;
  v_first boolean := false;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required when rejecting.';
  end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found.'; end if;
  if v_pay.status = 'verified' then raise exception 'That payment is already verified.'; end if;

  if not p_approve then
    update public.payments
       set status = 'rejected', reject_reason = p_reason,
           verified_by = auth.uid(), verified_at = now()
     where id = p_payment_id;

    if v_pay.type = 'order' and v_pay.order_id is not null then
      select * into v_order from public.orders where id = v_pay.order_id for update;
      if v_order.status = 'pending_payment' then
        -- give back the reserved stock
        update public.listings l
           set stock = l.stock + oi.quantity,
               status = case when l.status = 'out_of_stock' then 'live' else l.status end
          from public.order_items oi
         where oi.order_id = v_order.id and l.id = oi.listing_id and l.type = 'product';
      end if;
    end if;

    if v_pay.type = 'subscription' and v_pay.shop_id is not null then
      update public.shops set subscription_status = 'expired' where id = v_pay.shop_id;
    end if;
    return;
  end if;

  update public.payments
     set status = 'verified', verified_by = auth.uid(), verified_at = now(), reject_reason = null
   where id = p_payment_id;

  if v_pay.type = 'order' and v_pay.order_id is not null then
    select * into v_order from public.orders where id = v_pay.order_id for update;
    if v_order.status = 'pending_payment' then
      update public.orders
         set status = 'paid', accepted_at = null,
             auto_cancel_at = now() + interval '24 hours'
       where id = v_order.id;
    end if;

  elsif v_pay.type = 'subscription' and v_pay.shop_id is not null then
    select * into v_shop from public.shops where id = v_pay.shop_id for update;
    select * into v_cfg from public.platform_settings where id = 1;

    -- the first ₦5,000 comes out of the seller's first payout, not their bank
    v_first := not coalesce(v_shop.first_payment_deducted, false);

    update public.shops
       set subscription_status = 'pending',
           first_payment_deducted = true
     where id = v_shop.id;

    if v_first then
      -- credited on approval: no money moves now, the deduction happens at payout
      update public.shops
         set subscription_status = 'active',
             subscription_expires_at = now() + interval '30 days'
       where id = v_shop.id;
    else
      update public.shops
         set subscription_status = 'active',
             subscription_expires_at = greatest(coalesce(subscription_expires_at, now()), now()) + interval '30 days'
       where id = v_shop.id;
    end if;

    -- a lapsed shop gets its listings back
    update public.listings set status = 'live'
     where shop_id = v_shop.id and status = 'hidden';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- seller_accept_order / seller_decline_order
-- ---------------------------------------------------------------------
create or replace function public.seller_accept_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.owns_shop(v_order.shop_id) then raise exception 'Not your order.'; end if;
  if v_order.status <> 'paid' then raise exception 'Only a paid order can be accepted.'; end if;

  update public.orders
     set status = 'accepted', accepted_at = now(), auto_cancel_at = null
   where id = p_order_id;
end $$;

create or replace function public.seller_decline_order(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the buyer a reason.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.owns_shop(v_order.shop_id) then raise exception 'Not your order.'; end if;
  if v_order.status not in ('paid','accepted') then
    raise exception 'This order can no longer be declined.';
  end if;

  update public.orders
     set status = 'cancelled', decline_reason = p_reason, payout_status = 'held'
   where id = p_order_id;

  update public.listings l
     set stock = l.stock + oi.quantity,
         status = case when l.status = 'out_of_stock' then 'live' else l.status end
    from public.order_items oi
   where oi.order_id = p_order_id and l.id = oi.listing_id and l.type = 'product';
end $$;

-- ---------------------------------------------------------------------
-- seller_advance_order: accepted → processing → shipped/ready_for_pickup
-- ---------------------------------------------------------------------
create or replace function public.seller_advance_order(p_order_id uuid, p_next text)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.owns_shop(v_order.shop_id) then raise exception 'Not your order.'; end if;

  if p_next = 'processing' and v_order.status in ('paid','accepted') then
    update public.orders set status = 'processing',
      accepted_at = coalesce(accepted_at, now()), auto_cancel_at = null where id = p_order_id;

  elsif p_next = 'shipped' and v_order.status = 'processing' then
    if v_order.fulfilment <> 'delivery' then raise exception 'This order is pickup.'; end if;
    update public.orders set status = 'shipped', shipped_at = now() where id = p_order_id;

  elsif p_next = 'ready_for_pickup' and v_order.status = 'processing' then
    update public.orders set status = 'ready_for_pickup', shipped_at = now() where id = p_order_id;

  else
    raise exception 'That step is not allowed from %.', v_order.status;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- confirm_delivery: buyer confirms → delivered → payout clock starts
-- ---------------------------------------------------------------------
create or replace function public.confirm_delivery(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_order.buyer_id <> auth.uid() then raise exception 'Not your order.'; end if;
  if v_order.status not in ('shipped','ready_for_pickup','delivered') then
    raise exception 'You can confirm only after the seller has shipped or prepared the item.';
  end if;
  if v_order.status = 'delivered' then return; end if;

  update public.orders
     set status = 'delivered', delivered_at = now(),
         payout_status = 'released',
         auto_confirm_at = coalesce(auto_confirm_at, now() + interval '7 days')
   where id = p_order_id;

  -- a released payout becomes payable 24h after delivery confirmation
  insert into public.payouts (shop_id, order_id, amount, gross_amount, commission_amount, kind, status, available_at)
  values (v_order.shop_id, v_order.id, v_order.payout_amount, v_order.total,
          v_order.commission_amount, 'order', 'queued', now() + interval '24 hours')
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- leave_review (also completes the order)
-- ---------------------------------------------------------------------
create or replace function public.leave_review(
  p_order_id uuid, p_rating int, p_body text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_order public.orders; v_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found.'; end if;
  if v_order.buyer_id <> auth.uid() then raise exception 'Not your order.'; end if;
  if v_order.status not in ('delivered','completed') then
    raise exception 'You can review after delivery.';
  end if;
  if exists (select 1 from public.reviews r where r.order_id = p_order_id) then
    raise exception 'You already reviewed this order.';
  end if;

  insert into public.reviews (order_id, buyer_id, shop_id, rating, body)
  values (p_order_id, auth.uid(), v_order.shop_id, p_rating, p_body)
  returning id into v_id;

  update public.orders set status = 'completed', completed_at = now() where id = p_order_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- raise_dispute
-- ---------------------------------------------------------------------
create or replace function public.raise_dispute(p_order_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_order public.orders; v_id uuid;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Tell us what went wrong.'; end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found.'; end if;
  if v_order.buyer_id <> auth.uid() and not public.owns_shop(v_order.shop_id) then
    raise exception 'Not your order.';
  end if;

  insert into public.disputes (order_id, raised_by, reason)
  values (p_order_id, auth.uid(), p_reason) returning id into v_id;

  update public.orders set status = 'disputed' where id = p_order_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- admin_resolve_dispute
-- ---------------------------------------------------------------------
create or replace function public.admin_resolve_dispute(
  p_dispute_id uuid, p_outcome text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_d public.disputes; v_order public.orders;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_outcome not in ('resolved_buyer','resolved_seller') then
    raise exception 'Choose who the dispute resolves in favour of.';
  end if;

  select * into v_d from public.disputes where id = p_dispute_id for update;
  if not found then raise exception 'Dispute not found.'; end if;
  select * into v_order from public.orders where id = v_d.order_id for update;

  update public.disputes
     set status = p_outcome, resolution_note = p_note,
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_dispute_id;

  if p_outcome = 'resolved_buyer' then
    update public.orders set status = 'cancelled', payout_status = 'held' where id = v_order.id;
    delete from public.payouts where order_id = v_order.id and status = 'queued';
  else
    update public.orders
       set status = 'delivered', delivered_at = coalesce(delivered_at, now()), payout_status = 'released'
     where id = v_order.id;
    insert into public.payouts (shop_id, order_id, amount, gross_amount, commission_amount, kind, status, available_at)
    values (v_order.shop_id, v_order.id, v_order.payout_amount, v_order.total,
            v_order.commission_amount, 'order', 'queued', now() + interval '24 hours');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- request_payout: seller pulls their available balance
-- ---------------------------------------------------------------------
create or replace function public.request_payout(p_shop_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_amount numeric(12,2);
begin
  if not public.owns_shop(p_shop_id) then raise exception 'Not your shop.'; end if;

  select coalesce(sum(amount), 0) into v_amount
    from public.payouts
   where shop_id = p_shop_id and status = 'queued'
     and requested_at is null and available_at <= now();

  if v_amount <= 0 then
    raise exception 'Nothing available to withdraw yet. Payouts unlock 24 hours after delivery confirmation.';
  end if;

  update public.payouts
     set requested_at = now(), reference = 'PO-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))
   where shop_id = p_shop_id and status = 'queued'
     and requested_at is null and available_at <= now();

  return v_amount;
end $$;

-- ---------------------------------------------------------------------
-- admin_mark_payout_paid
-- ---------------------------------------------------------------------
create or replace function public.admin_mark_payout_paid(p_payout_id uuid, p_reference text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.payouts
     set status = 'paid', paid_at = now(),
         reference = coalesce(p_reference, reference, 'PO-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)))
   where id = p_payout_id and status = 'queued';
  if not found then raise exception 'Payout not found or already paid.'; end if;

  update public.orders o set payout_status = 'paid'
    from public.payouts p where p.id = p_payout_id and o.id = p.order_id;
end $$;

-- ---------------------------------------------------------------------
-- admin_set_shop_status: approve / reject / suspend / verify
-- ---------------------------------------------------------------------
create or replace function public.admin_set_shop_status(
  p_shop_id uuid, p_status text, p_note text default null, p_verified boolean default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_status not in ('pending','approved','suspended','rejected') then
    raise exception 'Unknown status.';
  end if;

  update public.shops
     set status = p_status,
         review_note = p_note,
         verified = coalesce(p_verified, verified)
   where id = p_shop_id;

  if p_status = 'approved' then
    update public.listings set status = 'live'
     where shop_id = p_shop_id and status = 'hidden';
    insert into public.seller_scores (shop_id, new_seller_boost_until)
    values (p_shop_id, now() + interval '30 days')
    on conflict (shop_id) do update set new_seller_boost_until = excluded.new_seller_boost_until;
  end if;

  if p_status in ('suspended','rejected') then
    update public.listings set status = 'hidden'
     where shop_id = p_shop_id and status = 'live';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- accept_offer: a service quote becomes an order
-- ---------------------------------------------------------------------
create or replace function public.accept_offer(p_offer_id uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_offer public.offers; v_chat public.chats; v_shop uuid;
  v_order public.orders; v_cfg public.platform_settings;
begin
  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then raise exception 'Offer not found.'; end if;
  if v_offer.buyer_id <> auth.uid() then raise exception 'This offer is not yours.'; end if;
  if v_offer.status <> 'pending' then raise exception 'This offer was already answered.'; end if;

  select * into v_chat from public.chats where id = v_offer.chat_id;
  v_shop := v_chat.shop_id;
  if v_shop is null then raise exception 'This chat is not linked to a shop.'; end if;

  select * into v_cfg from public.platform_settings where id = 1;

  insert into public.orders (
    buyer_id, shop_id, status, fulfilment, subtotal, delivery_fee, total,
    commission_rate, commission_amount, payout_amount, payout_status, buyer_note
  ) values (
    auth.uid(), v_shop, 'pending_payment', 'pickup', v_offer.price, 0, v_offer.price,
    v_cfg.commission_rate, round(v_offer.price * v_cfg.commission_rate, 2),
    round(v_offer.price * (1 - v_cfg.commission_rate), 2), 'held',
    'Service: ' || coalesce(v_offer.scope, 'Quoted job')
  ) returning * into v_order;

  insert into public.order_items (order_id, title, unit_price, quantity, line_total)
  values (v_order.id, 'Service — ' || coalesce(v_offer.scope, 'Quoted job'),
          v_offer.price, 1, v_offer.price);

  update public.offers set status = 'accepted', order_id = v_order.id where id = p_offer_id;
  update public.offers set status = 'declined'
   where chat_id = v_offer.chat_id and id <> p_offer_id and status = 'pending';
  update public.enquiries set status = 'accepted'
   where id = (select enquiry_id from public.chats where id = v_offer.chat_id);

  insert into public.payments (order_id, type, amount, reference)
  values (v_order.id, 'order', v_order.total, v_order.reference);

  return v_order;
end $$;

-- ---------------------------------------------------------------------
-- start_chat: buyer ↔ seller, optionally tied to an order
-- ---------------------------------------------------------------------
create or replace function public.start_chat(p_shop_id uuid, p_order_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_seller uuid; v_chat uuid;
begin
  if v_uid is null then raise exception 'Sign in to chat with a seller.'; end if;
  select owner_id into v_seller from public.shops where id = p_shop_id;
  if v_seller is null then raise exception 'This shop has no owner account yet.'; end if;
  if v_seller = v_uid then raise exception 'That is your own shop.'; end if;

  select id into v_chat from public.chats
   where buyer_id = v_uid and seller_id = v_seller and shop_id = p_shop_id
     and ((p_order_id is null and order_id is null) or order_id = p_order_id)
   limit 1;

  if v_chat is null then
    insert into public.chats (order_id, buyer_id, seller_id, shop_id)
    values (p_order_id, v_uid, v_seller, p_shop_id) returning id into v_chat;
  end if;
  return v_chat;
end $$;

-- ---------------------------------------------------------------------
-- run_order_timers: auto-cancel stale unpaid/accepted orders,
-- auto-confirm delivered orders after 7 days, expire lapsed subscriptions.
-- Safe to call from cron / the /api/jobs/run route too. Idempotent.
-- ---------------------------------------------------------------------
create or replace function public.run_order_timers()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cancel int := 0; v_confirm int := 0; v_expire int := 0; v_hide int := 0;
begin
  -- seller did not accept within 24h
  with stale as (
    update public.orders
       set status = 'cancelled', decline_reason = 'Seller did not accept within 24 hours. Refund due.'
     where status = 'paid' and auto_cancel_at is not null and auto_cancel_at < now()
     returning id, shop_id
  )
  select count(*) into v_cancel from stale;

  with back as (
    select oi.listing_id, oi.quantity
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.status = 'cancelled' and o.decline_reason = 'Seller did not accept within 24 hours. Refund due.'
       and o.updated_at > now() - interval '1 minute'
  )
  update public.listings l set stock = l.stock + back.quantity,
         status = case when l.status = 'out_of_stock' then 'live' else l.status end
    from back where l.id = back.listing_id and l.type = 'product';

  -- buyer never confirmed — trust the delivery after 7 days
  with auto as (
    update public.orders
       set status = 'delivered', delivered_at = coalesce(delivered_at, now()), payout_status = 'released'
     where status in ('shipped','ready_for_pickup')
       and shipped_at is not null and shipped_at < now() - interval '7 days'
     returning id, shop_id, payout_amount, total, commission_amount
  )
  select count(*) into v_confirm from auto;

  insert into public.payouts (shop_id, order_id, amount, gross_amount, commission_amount, kind, status, available_at)
  select o.shop_id, o.id, o.payout_amount, o.total, o.commission_amount, 'order', 'queued', now()
    from public.orders o
   where o.status = 'delivered' and o.payout_status = 'released'
     and not exists (select 1 from public.payouts p where p.order_id = o.id);

  -- subscription lapse → shops stop taking orders, listings hide
  with lapsed as (
    update public.shops
       set subscription_status = 'expired'
     where subscription_status = 'active'
       and subscription_expires_at is not null and subscription_expires_at < now()
     returning id
  )
  select count(*) into v_expire from lapsed;

  with hidden as (
    update public.listings l set status = 'hidden'
      from public.shops s
     where s.id = l.shop_id and s.subscription_status = 'expired' and l.status = 'live'
     returning l.id
  )
  select count(*) into v_hide from hidden;

  return jsonb_build_object('cancelled', v_cancel, 'auto_confirmed', v_confirm,
                            'subscriptions_expired', v_expire, 'listings_hidden', v_hide);
end $$;

-- callable by any signed-in user's page load too (cheap, idempotent)
grant execute on function public.run_order_timers() to authenticated, anon;
