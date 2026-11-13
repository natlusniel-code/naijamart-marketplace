-- ---------------------------------------------------------------------
-- 0031 — two defects that made the order lifecycle look broken
--
-- 1. A buyer could upload a receipt and the admin never heard about it.
--    `submit_receipt` wrote the payment row and stopped. The admin console
--    only shows what is already in `payments`, so a receipt that arrived
--    while nobody was looking sat there silently. The admin now gets a
--    notification (and therefore a push) the moment a receipt lands.
--
-- 2. `accept_offer` created the order but never pointed the CHAT at it.
--    `chats.order_id` stayed null, so the chat page loaded with
--    `order = null` — which is what hid the "Deliver Order" tab and the
--    Deliver button from the seller. The offer was accepted, the order
--    existed, and the seller still had no way to deliver it.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. submit_receipt — notify the admin that a receipt is waiting
-- ---------------------------------------------------------------------
create or replace function public.submit_receipt(p_order_id uuid, p_receipt_url text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders;
  v_shop  text;
begin
  select * into v_order from public.orders o
   where o.id = p_order_id and o.buyer_id = v_uid;
  if not found then
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

  -- The admin has to be told, or the receipt is invisible until someone
  -- happens to open the payments page. `nm_notify_admin` fans out to every
  -- row in `admin_users`; if that table is empty this is a no-op, which is
  -- why the console also lists pending payments directly.
  select s.name into v_shop from public.shops s where s.id = v_order.shop_id;

  perform public.nm_notify_admin(
    'Receipt uploaded — verify payment',
    coalesce(v_shop, 'A buyer') || ' · ' || v_order.reference ||
      ' · ₦' || to_char(v_order.total, 'FM999,999,999.00') ||
      ' — a buyer submitted a transfer receipt.',
    '/admin-fuckliving/payments',
    'payment'
  );
end $$;

revoke all on function public.submit_receipt(uuid, text) from public;
revoke all on function public.submit_receipt(uuid, text) from anon;
grant execute on function public.submit_receipt(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. accept_offer — link the chat to the order it just created
--
-- Redeclared from the live 0028 body with one addition: the chat row is
-- pointed at the new order. Without it the thread has no order to act on,
-- so the seller's Deliver surface never appears.
-- ---------------------------------------------------------------------
create or replace function public.accept_offer(p_offer_id uuid)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_offer    public.offers;
  v_shop     uuid;
  v_cfg      public.platform_settings;
  v_acct     public.payment_accounts;
  v_order    public.orders;
  v_promised timestamptz;
begin
  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then raise exception 'Offer not found.'; end if;
  if v_offer.status <> 'pending' then raise exception 'That offer is no longer open.'; end if;

  -- Only the buyer in this conversation may accept.
  if not exists (
    select 1 from public.chats c
     where c.id = v_offer.chat_id and c.buyer_id = auth.uid()
  ) then
    raise exception 'This is not your offer to accept.';
  end if;

  select c.shop_id into v_shop from public.chats c where c.id = v_offer.chat_id;
  if v_shop is null then raise exception 'This conversation has no shop.'; end if;

  select * into v_cfg from public.platform_settings limit 1;

  -- The account the buyer was told to pay into for this conversation.
  select pa.* into v_acct
    from public.payment_account_assignments a
    join public.payment_accounts pa on pa.id = a.account_id
   where a.buyer_id = auth.uid() and a.order_id is null
   order by a.created_at desc
   limit 1;

  -- The promise the seller made when quoting. A date in the past is not a
  -- promise, so it is floored at one day from now.
  v_promised := case
    when v_offer.delivery_date is not null
      then greatest(v_offer.delivery_date::timestamptz, now() + interval '1 day')
    else null
  end;

  insert into public.orders (
    buyer_id, shop_id, status, fulfilment, subtotal, delivery_fee, total,
    commission_rate, commission_amount, payout_amount, payout_status, buyer_note,
    payment_account_id, is_service, promised_delivery_at, delivery_days
  ) values (
    auth.uid(), v_shop, 'pending_payment', 'pickup', v_offer.price, 0, v_offer.price,
    v_cfg.commission_rate, round(v_offer.price * v_cfg.commission_rate, 2),
    round(v_offer.price * (1 - v_cfg.commission_rate), 2), 'held',
    'Service: ' || coalesce(v_offer.scope, 'Quoted job'), v_acct.id,
    true, v_promised, v_offer.delivery_days
  ) returning * into v_order;

  insert into public.order_items (order_id, title, unit_price, quantity, line_total)
  values (v_order.id, 'Service — ' || coalesce(v_offer.scope, 'Quoted job'),
          v_offer.price, 1, v_offer.price);

  update public.offers set status = 'accepted', order_id = v_order.id where id = p_offer_id;
  update public.offers set status = 'declined'
   where chat_id = v_offer.chat_id and id <> p_offer_id and status = 'pending';
  update public.enquiries set status = 'accepted'
   where id = (select enquiry_id from public.chats where id = v_offer.chat_id);

  -- THE FIX: the thread must know which order it is about, or the seller's
  -- Deliver tab and Deliver button have nothing to act on.
  update public.chats set order_id = v_order.id where id = v_offer.chat_id;

  insert into public.payments (order_id, type, amount, reference, payment_account_id)
  values (v_order.id, 'order', v_order.total, v_order.reference, v_acct.id);

  update public.payment_account_assignments
     set order_id = v_order.id, expires_at = now()
   where buyer_id = auth.uid() and account_id = v_acct.id and order_id is null;

  return v_order;
end $$;

revoke all on function public.accept_offer(uuid) from public;
revoke all on function public.accept_offer(uuid) from anon;
grant execute on function public.accept_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Backfill — chats that already have an accepted offer but no order link
--
-- Four real conversations were in this state: the buyer had accepted, the
-- order existed, and the seller could not deliver it. Point each chat at
-- the order its accepted offer created.
-- ---------------------------------------------------------------------
update public.chats c
   set order_id = o.order_id
  from public.offers o
 where o.chat_id = c.id
   and o.status = 'accepted'
   and o.order_id is not null
   and c.order_id is null;
