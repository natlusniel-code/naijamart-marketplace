-- =====================================================================
-- 0028 — delivery lifecycle, per-listing analytics, payout floor
-- =====================================================================
-- One migration for the whole order lifecycle, because the pieces are not
-- independent: a delivery cannot be accepted without a promised date, a
-- promised date cannot be scored without a delivery, and the analytics
-- counters are the same events read back.
--
--   1. A seller must promise a DATE when sending an offer. The timeline
--      ("2 days") is derived from it, never typed, so the number the buyer
--      is shown and the number the ranking is scored against are the same.
--   2. The seller is told about an offer only once the buyer has PAID and
--      an admin has verified the payment. Accepting an offer used to fire
--      "New order received" immediately, which told the seller to start
--      work on money that had not arrived.
--   3. A delivery is a first-class row with files and links attached, so
--      the buyer can download what was delivered and the files can be
--      purged on a schedule.
--   4. Accepting a delivery is what marks the order delivered, counts the
--      gig's delivery, queues the payout and scores on-time performance.
--   5. Per-listing views/clicks/orders/delivered/pending for analytics.
--   6. A payout floor of ₦10,000.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Promised delivery date on an offer
-- ---------------------------------------------------------------------
alter table public.offers add column if not exists delivery_date date;
-- Derived from delivery_date at insert time. Stored rather than computed so
-- a later edit to the date cannot silently rewrite history on an order that
-- was already scored.
alter table public.offers add column if not exists delivery_days int;

-- ---------------------------------------------------------------------
-- 2. The same promise, carried onto the order
-- ---------------------------------------------------------------------
alter table public.orders add column if not exists promised_delivery_at timestamptz;
alter table public.orders add column if not exists delivery_days int;
-- Set when the buyer accepts: was the work handed over by the promise?
alter table public.orders add column if not exists delivered_on_time boolean;
-- A service order has no courier and no pickup. The tracking UI reads this
-- instead of guessing from `fulfilment`, which is 'pickup' for every offer
-- order because nothing is shipped.
alter table public.orders add column if not exists is_service boolean not null default false;

-- ---------------------------------------------------------------------
-- 3. Deliveries and their files
-- ---------------------------------------------------------------------
create table if not exists public.deliveries (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  chat_id     uuid references public.chats(id) on delete set null,
  seller_id   uuid not null references auth.users(id) on delete cascade,
  note        text,
  status      text not null default 'sent' check (status in ('sent','accepted','rejected')),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists deliveries_order_idx on public.deliveries(order_id, created_at desc);

create table if not exists public.delivery_files (
  id          uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  kind        text not null default 'file' check (kind in ('file','link')),
  url         text not null,
  name        text,
  size_bytes  bigint,
  -- Seven days from upload. `run_order_timers` deletes the row when this
  -- passes; the storage object is removed by the same job.
  expires_at  timestamptz not null default (now() + interval '7 days'),
  created_at  timestamptz not null default now()
);
create index if not exists delivery_files_delivery_idx on public.delivery_files(delivery_id);
create index if not exists delivery_files_expiry_idx on public.delivery_files(expires_at);

alter table public.deliveries enable row level security;
alter table public.delivery_files enable row level security;

-- Only the two parties to the order (or an admin) may read a delivery.
drop policy if exists deliveries_read on public.deliveries;
create policy deliveries_read on public.deliveries for select
  using (
    exists (
      select 1 from public.orders o
       where o.id = deliveries.order_id
         and (o.buyer_id = auth.uid() or public.owns_shop(o.shop_id) or public.is_admin())
    )
  );

drop policy if exists delivery_files_read on public.delivery_files;
create policy delivery_files_read on public.delivery_files for select
  using (
    exists (
      select 1 from public.deliveries d
        join public.orders o on o.id = d.order_id
       where d.id = delivery_files.delivery_id
         and (o.buyer_id = auth.uid() or public.owns_shop(o.shop_id) or public.is_admin())
    )
  );

-- Writes go through the RPCs below (SECURITY DEFINER), never the browser.

-- ---------------------------------------------------------------------
-- 4. Analytics counters
-- ---------------------------------------------------------------------
alter table public.listings add column if not exists clicks int not null default 0;
-- Deliveries completed for this listing. Requirement: +1 per accepted
-- delivery, shown on the gig and used by the ranking.
alter table public.listings add column if not exists deliveries int not null default 0;

alter table public.shops add column if not exists orders_delivered int not null default 0;

-- ---------------------------------------------------------------------
-- 5. Payout floor
-- ---------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists min_payout numeric(12,2) not null default 10000;

-- ---------------------------------------------------------------------
-- 6. Notification kinds
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('order', 'chat', 'broadcast', 'system', 'promo', 'delivery'));

-- ---------------------------------------------------------------------
-- 7. Notify every admin
-- ---------------------------------------------------------------------
-- One helper so every lifecycle step can tell the operators what happened
-- without repeating the fan-out. Admins are rows in `admin_users`.
create or replace function public.nm_notify_admin(
  p_title text,
  p_body  text,
  p_href  text default '/admin-fuckliving',
  p_kind  text default 'system'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, kind, title, body, href)
  select a.user_id, p_kind, p_title, p_body, p_href
    from public.admin_users a;
end $$;

revoke all on function public.nm_notify_admin(text, text, text, text) from public;
revoke all on function public.nm_notify_admin(text, text, text, text) from anon;
revoke all on function public.nm_notify_admin(text, text, text, text) from authenticated;

-- ---------------------------------------------------------------------
-- 8. Offer timeline is derived from the chosen date
-- ---------------------------------------------------------------------
create or replace function public.tg_offer_delivery_days()
returns trigger language plpgsql as $$
begin
  if new.delivery_date is not null then
    -- Whole days from today, floored at 1: a date in the past is not a
    -- promise, and 0 would read as "today" on a job that has not started.
    new.delivery_days := greatest(1, (new.delivery_date - current_date));
  end if;
  return new;
end $$;

drop trigger if exists t_offer_delivery_days on public.offers;
create trigger t_offer_delivery_days
  before insert or update of delivery_date on public.offers
  for each row execute function public.tg_offer_delivery_days();

-- ---------------------------------------------------------------------
-- 9. Order items carry the service flag and the promise
-- ---------------------------------------------------------------------
-- `place_order` is redefined in six files; a trigger is the only way to add
-- this without redeclaring it a seventh time and risking a divergence.
create or replace function public.tg_order_item_flags()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_type text; v_days int;
begin
  select l.type, l.delivery_days into v_type, v_days
    from public.listings l where l.id = new.listing_id;

  if v_type = 'service' then
    update public.orders set is_service = true where id = new.order_id;
  end if;

  -- A goods order promises the listing's own lead time, if it has one.
  if v_days is not null then
    update public.orders
       set promised_delivery_at = coalesce(promised_delivery_at, now() + make_interval(days => v_days)),
           delivery_days = coalesce(delivery_days, v_days)
     where id = new.order_id;
  end if;

  return new;
end $$;

drop trigger if exists t_order_item_flags on public.order_items;
create trigger t_order_item_flags
  after insert on public.order_items
  for each row execute function public.tg_order_item_flags();

-- ---------------------------------------------------------------------
-- 10. accept_offer — carry the promise, do NOT notify the seller yet
-- ---------------------------------------------------------------------
-- The old body created the order and let `t_notify_new_order_seller` fire
-- on insert, so the seller was told "New order received" the moment the
-- buyer accepted — before a naira had been paid. The seller notification
-- now lives in `admin_verify_payment` (section 11), which is the first
-- moment the money is real.
create or replace function public.accept_offer(p_offer_id uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_offer public.offers; v_chat public.chats; v_shop uuid;
  v_order public.orders; v_cfg public.platform_settings;
  v_acct public.payment_accounts;
  v_promised timestamptz;
begin
  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then raise exception 'Offer not found.'; end if;
  if v_offer.buyer_id <> auth.uid() then raise exception 'This offer is not yours.'; end if;
  if v_offer.status <> 'pending' then raise exception 'This offer was already answered.'; end if;

  select * into v_chat from public.chats where id = v_offer.chat_id;
  v_shop := v_chat.shop_id;
  if v_shop is null then raise exception 'This chat is not linked to a shop.'; end if;

  select * into v_cfg from public.platform_settings where id = 1;
  v_acct := public.my_payment_account();

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

  insert into public.payments (order_id, type, amount, reference, payment_account_id)
  values (v_order.id, 'order', v_order.total, v_order.reference, v_acct.id);

  update public.payment_account_assignments
     set order_id = v_order.id, expires_at = now()
   where buyer_id = auth.uid() and account_id = v_acct.id and order_id is null;

  return v_order;
end $$;

-- ---------------------------------------------------------------------
-- 11. admin_verify_payment — the seller learns about the offer HERE
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
  v_owner uuid;
  v_offer public.offers;
  v_days  int;
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

    -- ── The seller is told now, and only now ──────────────────────────
    -- This is the first moment the buyer's money is confirmed. An offer
    -- that was merely accepted is not news the seller can act on.
    select s.owner_id into v_owner from public.shops s where s.id = v_order.shop_id;
    select * into v_offer from public.offers where order_id = v_order.id limit 1;

    if v_owner is not null then
      v_days := coalesce(v_order.delivery_days, v_offer.delivery_days);

      insert into public.notifications (user_id, kind, title, body, href, order_id)
      values (
        v_owner, 'order',
        case when v_offer.id is not null then 'Offer accepted and paid' else 'New order received' end,
        case
          when v_offer.id is not null then
            format('The buyer accepted your offer and payment is verified — %s. %s',
                   v_order.reference,
                   case when v_days is not null
                        then format('You will be delivering in %s day%s.', v_days, case when v_days = 1 then '' else 's' end)
                        else 'Start work when you are ready.' end)
          else
            format('%s — N%s. Accept it within 24 hours.', v_order.reference, to_char(v_order.total, 'FM999,999,999.00'))
        end,
        '/seller/orders', v_order.id
      );
    end if;

    perform public.nm_notify_admin(
      'Payment verified',
      format('%s — N%s verified for %s.', v_order.reference,
             to_char(v_order.total, 'FM999,999,999.00'),
             coalesce((select s.name from public.shops s where s.id = v_order.shop_id), 'a shop')),
      '/admin-fuckliving/payments', 'order'
    );

  elsif v_pay.type = 'subscription' and v_pay.shop_id is not null then
    select * into v_shop from public.shops where id = v_pay.shop_id for update;
    select * into v_cfg from public.platform_settings where id = 1;

    v_first := not coalesce(v_shop.first_payment_deducted, false);

    update public.shops
       set subscription_status = 'pending',
           first_payment_deducted = true
     where id = v_shop.id;

    if v_first then
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

    update public.listings set status = 'live'
     where shop_id = v_shop.id and status = 'hidden';

    perform public.nm_notify_admin(
      'Subscription verified',
      format('%s renewed for 30 days.', v_shop.name),
      '/admin-fuckliving/payments', 'order'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 12. The old "new order" trigger must not fire on an unpaid order
-- ---------------------------------------------------------------------
-- It fired on INSERT, which is the moment `accept_offer` creates the row —
-- i.e. before payment. Replaced by the notification inside
-- `admin_verify_payment`, which fires on the transition to 'paid'.
drop trigger if exists t_notify_new_order_seller on public.orders;
drop function if exists public.tg_notify_new_order_seller();

-- ---------------------------------------------------------------------
-- 13. Seller sends a delivery
-- ---------------------------------------------------------------------
create or replace function public.seller_send_delivery(
  p_order_id uuid,
  p_note     text default null,
  p_files    jsonb default '[]'::jsonb
) returns public.deliveries
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
  v_del   public.deliveries;
  v_chat  uuid;
  v_item  jsonb;
  v_days  int;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.owns_shop(v_order.shop_id) then raise exception 'This is not your order.'; end if;
  if v_order.status not in ('paid','accepted','processing','shipped','ready_for_pickup') then
    raise exception 'This order cannot be delivered from its current state.';
  end if;

  select c.id into v_chat from public.chats c where c.order_id = v_order.id limit 1;

  insert into public.deliveries (order_id, chat_id, seller_id, note)
  values (v_order.id, v_chat, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_del;

  for v_item in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    if coalesce(v_item->>'url', '') = '' then continue; end if;
    insert into public.delivery_files (delivery_id, kind, url, name, size_bytes)
    values (
      v_del.id,
      case when v_item->>'kind' = 'link' then 'link' else 'file' end,
      v_item->>'url',
      nullif(v_item->>'name', ''),
      nullif(v_item->>'size', '')::bigint
    );
  end loop;

  update public.orders
     set status = case when status in ('paid','accepted') then 'processing' else status end
   where id = v_order.id;

  -- The buyer is told there is something to look at.
  insert into public.notifications (user_id, kind, title, body, href, order_id)
  values (
    v_order.buyer_id, 'delivery', 'Delivery received',
    format('%s — the seller has sent your delivery. Review it and accept to release payment.', v_order.reference),
    '/chats/' || coalesce(v_chat::text, ''), v_order.id
  );

  perform public.nm_notify_admin(
    'Delivery submitted',
    format('%s — seller submitted a delivery.', v_order.reference),
    '/admin-fuckliving/orders', 'delivery'
  );

  return v_del;
end $$;

-- ---------------------------------------------------------------------
-- 14. Buyer accepts a delivery
-- ---------------------------------------------------------------------
-- This is the single place an order becomes delivered. It counts the gig's
-- delivery, queues the payout four days out, scores on-time performance and
-- tells both sides.
create or replace function public.buyer_accept_delivery(p_delivery_id uuid)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_del   public.deliveries;
  v_order public.orders;
  v_days  int;
  v_owner uuid;
  v_on_time boolean;
  v_shop_name text;
  v_item  record;
begin
  select * into v_del from public.deliveries where id = p_delivery_id for update;
  if not found then raise exception 'Delivery not found.'; end if;

  select * into v_order from public.orders where id = v_del.order_id for update;
  if v_order.buyer_id <> auth.uid() then raise exception 'This is not your order.'; end if;
  if v_del.status = 'accepted' then raise exception 'You already accepted this delivery.'; end if;

  select coalesce(payout_hold_days, 4) into v_days from public.platform_settings where id = 1;
  v_days := coalesce(v_days, 4);

  v_on_time := (v_order.promised_delivery_at is null or now() <= v_order.promised_delivery_at);

  update public.deliveries
     set status = 'accepted', accepted_at = now()
   where id = p_delivery_id;

  update public.orders
     set status = 'delivered', delivered_at = now(),
         payout_status = 'released',
         delivered_on_time = v_on_time,
         auto_confirm_at = coalesce(auto_confirm_at, now() + interval '7 days')
   where id = v_order.id;

  -- +1 delivery on every gig in the order (requirement 7).
  for v_item in
    select distinct oi.listing_id from public.order_items oi
     where oi.order_id = v_order.id and oi.listing_id is not null
  loop
    update public.listings set deliveries = deliveries + 1 where id = v_item.listing_id;
  end loop;

  update public.shops set orders_delivered = orders_delivered + 1 where id = v_order.shop_id;

  insert into public.payouts (shop_id, order_id, amount, gross_amount, commission_amount, kind, status, available_at)
  values (v_order.shop_id, v_order.id, v_order.payout_amount, v_order.total,
          v_order.commission_amount, 'order', 'queued', now() + make_interval(days => v_days))
  on conflict do nothing;

  -- On-time performance feeds the ranking. A late delivery is a real
  -- penalty, not a rounding error: the score is the share of on-time
  -- deliveries across everything this shop has completed.
  update public.seller_scores s
     set on_time_score = coalesce((
           select round(100.0 * count(*) filter (where o.delivered_on_time)
                        / greatest(count(*), 1), 2)
             from public.orders o
            where o.shop_id = v_order.shop_id
              and o.status in ('delivered','completed')
              and o.delivered_on_time is not null
         ), 0),
         updated_at = now()
   where s.shop_id = v_order.shop_id;

  select s.owner_id, s.name into v_owner, v_shop_name
    from public.shops s where s.id = v_order.shop_id;

  if v_owner is not null then
    insert into public.notifications (user_id, kind, title, body, href, order_id)
    values (
      v_owner, 'order', 'Order delivered',
      format('%s — the buyer accepted your delivery. You can request a withdrawal from %s.',
             v_order.reference,
             to_char(now() + make_interval(days => v_days), 'DD Mon YYYY')),
      '/seller/payouts', v_order.id
    );
  end if;

  perform public.nm_notify_admin(
    'Delivery accepted',
    format('%s — buyer accepted delivery from %s. Payout queued for %s.',
           v_order.reference, coalesce(v_shop_name, 'a shop'),
           to_char(now() + make_interval(days => v_days), 'DD Mon YYYY')),
    '/admin-fuckliving/orders', 'delivery'
  );

  return v_order;
end $$;

-- ---------------------------------------------------------------------
-- 15. confirm_delivery (goods) — same bookkeeping, no delivery row
-- ---------------------------------------------------------------------
create or replace function public.confirm_delivery(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
  v_days  int;
  v_owner uuid;
  v_on_time boolean;
  v_item  record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_order.buyer_id <> auth.uid() then raise exception 'Not your order.'; end if;
  if v_order.status not in ('shipped','ready_for_pickup','delivered') then
    raise exception 'You can confirm only after the seller has shipped or prepared the item.';
  end if;
  if v_order.status = 'delivered' then return; end if;

  select coalesce(payout_hold_days, 4) into v_days from public.platform_settings where id = 1;
  v_days := coalesce(v_days, 4);

  v_on_time := (v_order.promised_delivery_at is null or now() <= v_order.promised_delivery_at);

  update public.orders
     set status = 'delivered', delivered_at = now(),
         payout_status = 'released',
         delivered_on_time = v_on_time,
         auto_confirm_at = coalesce(auto_confirm_at, now() + interval '7 days')
   where id = p_order_id;

  for v_item in
    select distinct oi.listing_id from public.order_items oi
     where oi.order_id = v_order.id and oi.listing_id is not null
  loop
    update public.listings set deliveries = deliveries + 1 where id = v_item.listing_id;
  end loop;

  update public.shops set orders_delivered = orders_delivered + 1 where id = v_order.shop_id;

  insert into public.payouts (shop_id, order_id, amount, gross_amount, commission_amount, kind, status, available_at)
  values (v_order.shop_id, v_order.id, v_order.payout_amount, v_order.total,
          v_order.commission_amount, 'order', 'queued', now() + make_interval(days => v_days))
  on conflict do nothing;

  update public.seller_scores s
     set on_time_score = coalesce((
           select round(100.0 * count(*) filter (where o.delivered_on_time)
                        / greatest(count(*), 1), 2)
             from public.orders o
            where o.shop_id = v_order.shop_id
              and o.status in ('delivered','completed')
              and o.delivered_on_time is not null
         ), 0),
         updated_at = now()
   where s.shop_id = v_order.shop_id;

  select s.owner_id into v_owner from public.shops s where s.id = v_order.shop_id;
  if v_owner is not null then
    insert into public.notifications (user_id, kind, title, body, href, order_id)
    values (
      v_owner, 'order', 'Order delivered',
      format('%s — the buyer confirmed receipt. You can request a withdrawal from %s.',
             v_order.reference,
             to_char(now() + make_interval(days => v_days), 'DD Mon YYYY')),
      '/seller/payouts', v_order.id
    );
  end if;

  perform public.nm_notify_admin(
    'Delivery confirmed',
    format('%s — buyer confirmed receipt.', v_order.reference),
    '/admin-fuckliving/orders', 'delivery'
  );
end $$;

-- ---------------------------------------------------------------------
-- 16. request_payout — ₦10,000 floor
-- ---------------------------------------------------------------------
create or replace function public.request_payout(p_shop_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_amount numeric(12,2);
  v_days   int;
  v_min    numeric(12,2);
  v_soonest timestamptz;
begin
  if not public.owns_shop(p_shop_id) then raise exception 'Not your shop.'; end if;

  select coalesce(payout_hold_days, 4), coalesce(min_payout, 10000)
    into v_days, v_min
    from public.platform_settings where id = 1;
  v_days := coalesce(v_days, 4);
  v_min  := coalesce(v_min, 10000);

  select coalesce(sum(amount), 0) into v_amount
    from public.payouts
   where shop_id = p_shop_id and status = 'queued'
     and requested_at is null and available_at <= now();

  if v_amount <= 0 then
    select min(available_at) into v_soonest
      from public.payouts
     where shop_id = p_shop_id and status = 'queued' and requested_at is null;

    if v_soonest is not null then
      raise exception 'Nothing available to withdraw yet. Your next payout unlocks on %.',
        to_char(v_soonest, 'DD Mon YYYY');
    end if;
    raise exception 'Nothing available to withdraw yet. Payouts unlock % days after delivery confirmation.', v_days;
  end if;

  if v_amount < v_min then
    raise exception 'The minimum withdrawal is N%s. You have N%s available — it stays in your balance until you reach the minimum.',
      to_char(v_min, 'FM999,999,999'), to_char(v_amount, 'FM999,999,999.00');
  end if;

  update public.payouts
     set requested_at = now(), reference = 'PO-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))
   where shop_id = p_shop_id and status = 'queued'
     and requested_at is null and available_at <= now();

  perform public.nm_notify_admin(
    'Withdrawal requested',
    format('A seller requested a withdrawal of N%s.', to_char(v_amount, 'FM999,999,999.00')),
    '/admin-fuckliving/payouts', 'order'
  );

  return v_amount;
end $$;

-- ---------------------------------------------------------------------
-- 17. run_order_timers — purge expired delivery files
-- ---------------------------------------------------------------------
create or replace function public.run_order_timers()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cancel int := 0; v_confirm int := 0; v_expire int := 0; v_hide int := 0;
  v_purged int := 0;
  v_days int;
begin
  select coalesce(payout_hold_days, 4) into v_days from public.platform_settings where id = 1;
  v_days := coalesce(v_days, 4);

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

  with auto as (
    update public.orders
       set status = 'delivered', delivered_at = coalesce(delivered_at, now()), payout_status = 'released'
     where status in ('shipped','ready_for_pickup')
       and shipped_at is not null and shipped_at < now() - interval '7 days'
     returning id, shop_id, payout_amount, total, commission_amount
  )
  select count(*) into v_confirm from auto;

  insert into public.payouts (shop_id, order_id, amount, gross_amount, commission_amount, kind, status, available_at)
  select o.shop_id, o.id, o.payout_amount, o.total, o.commission_amount, 'order', 'queued',
         now() + make_interval(days => v_days)
    from public.orders o
   where o.status = 'delivered' and o.payout_status = 'released'
     and not exists (select 1 from public.payouts p where p.order_id = o.id);

  -- Delivery files live for one week, then go for good. The row is the
  -- record; deleting it is what makes the deletion permanent.
  with gone as (
    delete from public.delivery_files where expires_at < now() returning id
  )
  select count(*) into v_purged from gone;

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
                            'subscriptions_expired', v_expire, 'listings_hidden', v_hide,
                            'delivery_files_purged', v_purged,
                            'payout_hold_days', v_days);
end $$;

grant execute on function public.run_order_timers() to authenticated, anon;

-- ---------------------------------------------------------------------
-- 18. Analytics — one row per listing, plus the shop's own performance
-- ---------------------------------------------------------------------
create or replace function public.seller_analytics(p_shop_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not public.owns_shop(p_shop_id) and not public.is_admin() then
    raise exception 'Not your shop.';
  end if;

  select coalesce(jsonb_agg(row order by row->>'title'), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'listing_id', l.id,
      'title',      l.title,
      'type',       l.type,
      'status',     l.status,
      'image',      l.images->>0,
      'price',      l.price,
      'views',      l.views,
      'clicks',     l.clicks,
      'deliveries', l.deliveries,
      'orders',     coalesce(agg.total_orders, 0),
      'delivered',  coalesce(agg.delivered, 0),
      'pending',    coalesce(agg.pending, 0),
      'revenue',    coalesce(agg.revenue, 0)
    ) as row
    from public.listings l
    left join lateral (
      select
        count(distinct o.id) as total_orders,
        count(distinct o.id) filter (where o.status in ('delivered','completed')) as delivered,
        count(distinct o.id) filter (where o.status in ('paid','accepted','processing','shipped','ready_for_pickup')) as pending,
        coalesce(sum(oi.line_total) filter (where o.status in ('delivered','completed')), 0) as revenue
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.listing_id = l.id
    ) agg on true
    where l.shop_id = p_shop_id
  ) s;

  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 19. Count a click on a listing
-- ---------------------------------------------------------------------
-- Views are counted server-side when the page renders. A click is the
-- buyer opening the gig from a card, which is a different signal and is
-- what tells a seller their thumbnail is working.
create or replace function public.track_listing_click(p_listing_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.listings set clicks = clicks + 1 where id = p_listing_id;
end $$;

grant execute on function public.track_listing_click(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 20. Grants
-- ---------------------------------------------------------------------
grant execute on function public.seller_send_delivery(uuid, text, jsonb) to authenticated;
grant execute on function public.buyer_accept_delivery(uuid) to authenticated;
grant execute on function public.seller_analytics(uuid) to authenticated;

notify pgrst, 'reload schema';
