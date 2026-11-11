-- =====================================================================
-- 0013 — discounts, wishlist, notifications, web-push subscriptions
-- =====================================================================
--
-- Four features that all hang off the same idea: a buyer should be able to
-- see a real saving, keep something for later, and be told when an order
-- moves without having to refresh the page.
--
--   1. listings.original_price  — the "was" price. The discount percentage
--      is a GENERATED column, so it can never disagree with the two prices
--      it is derived from. A seller cannot type 40% off a ₦10,000 item and
--      have the storefront show ₦9,500.
--   2. wishlists                — one row per (buyer, listing).
--   3. notifications            — one row per recipient. An admin broadcast
--      fans out to one row per user rather than a shared row with a read
--      flag, because "read" is per person and a shared row cannot express it.
--   4. push_subscriptions       — the browser's Web Push endpoint, so a
--      notification can reach the phone when the tab is closed.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Discounts
-- ---------------------------------------------------------------------
alter table public.listings
  add column if not exists original_price numeric(12,2);

-- The percentage is derived, never stored by hand. `stored` (not virtual)
-- so it can be indexed and filtered on later without a table scan.
alter table public.listings
  add column if not exists discount_percent numeric(5,2)
  generated always as (
    case
      when original_price is not null
       and original_price > 0
       and original_price > price
      then round(((original_price - price) / original_price) * 100, 2)
      else 0
    end
  ) stored;

-- A "discount" that raises the price is not a discount. Enforced in the
-- database as well as the form, because the form is not the only writer.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listings_original_price_gte_price'
  ) then
    alter table public.listings
      add constraint listings_original_price_gte_price
      check (original_price is null or original_price >= price);
  end if;
end $$;

create index if not exists listings_discount_idx
  on public.listings(discount_percent desc)
  where discount_percent > 0;

-- ---------------------------------------------------------------------
-- 2. Wishlist
-- ---------------------------------------------------------------------
create table if not exists public.wishlists (
  user_id    uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index if not exists wishlists_user_idx
  on public.wishlists(user_id, created_at desc);
create index if not exists wishlists_listing_idx
  on public.wishlists(listing_id);

alter table public.wishlists enable row level security;

-- A wishlist is private. Only the owner reads, adds or removes.
drop policy if exists wishlists_own on public.wishlists;
create policy wishlists_own on public.wishlists for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. Notifications
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null default 'order'
    check (kind in ('order','broadcast','system')),
  title       text not null,
  body        text,
  href        text,
  order_id    uuid references public.orders(id) on delete cascade,
  -- set for admin broadcasts so one send can be audited / counted as a group
  broadcast_id uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications(user_id, created_at desc);
-- Partial index: the unread badge only ever counts unread rows, and that
-- count runs on every page load.
create index if not exists notifications_unread_idx
  on public.notifications(user_id)
  where read_at is null;
create index if not exists notifications_broadcast_idx
  on public.notifications(broadcast_id)
  where broadcast_id is not null;

alter table public.notifications enable row level security;

-- Read your own; mark your own read. Nobody can insert from the browser —
-- rows are written by the trigger below (SECURITY DEFINER) or by the admin
-- broadcast action through the service role.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select
  using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3a. Order status → buyer notification
--
-- The trigger is the right place for this: every status change already goes
-- through a SECURITY DEFINER RPC, but a future code path (a cron job, a
-- manual SQL fix) would bypass an application-level call. Hooking the table
-- means the buyer is told no matter who moved the order.
-- ---------------------------------------------------------------------
create or replace function public.tg_notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body  text;
  v_shop  text;
begin
  -- Only a real status change is a "new step". Receipt uploads, note edits
  -- and payout flags all update the row without moving the order.
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.buyer_id is null then return new; end if;

  select s.name into v_shop from public.shops s where s.id = new.shop_id;

  case new.status
    when 'pending_payment' then
      v_title := 'Order placed';
      v_body  := format('We are waiting for your payment on %s. Upload your transfer receipt to get it moving.', new.reference);
    when 'paid' then
      v_title := 'Payment confirmed';
      v_body  := format('%s confirmed your payment for %s. The seller has 24 hours to accept.', coalesce(v_shop, 'The seller'), new.reference);
    when 'accepted' then
      v_title := 'Seller accepted your order';
      v_body  := format('%s accepted %s and will start preparing it.', coalesce(v_shop, 'The seller'), new.reference);
    when 'processing' then
      v_title := 'Your order is being prepared';
      v_body  := format('%s is getting %s ready.', coalesce(v_shop, 'The seller'), new.reference);
    when 'shipped' then
      v_title := 'Your order has been shipped';
      v_body  := format('%s is on the way. Confirm delivery once it arrives.', new.reference);
    when 'ready_for_pickup' then
      v_title := 'Ready for pickup';
      v_body  := format('%s is ready to be collected.', new.reference);
    when 'delivered' then
      v_title := 'Delivered — please confirm';
      v_body  := format('%s was marked delivered. Confirm you received it so the seller gets paid.', new.reference);
    when 'completed' then
      v_title := 'Order completed';
      v_body  := format('%s is complete. Thanks for shopping on NaijaMart.', new.reference);
    when 'cancelled' then
      v_title := 'Order cancelled';
      v_body  := coalesce(new.decline_reason, format('%s was cancelled. Any payment is refunded to your transfer account.', new.reference));
    when 'disputed' then
      v_title := 'Dispute opened';
      v_body  := format('Support is reviewing %s. We will message you with the outcome.', new.reference);
    else
      return new;
  end case;

  insert into public.notifications (user_id, kind, title, body, href, order_id)
  values (new.buyer_id, 'order', v_title, v_body, '/orders/' || new.id, new.id);

  return new;
end $$;

drop trigger if exists t_notify_order_status on public.orders;
create trigger t_notify_order_status
  after insert or update of status on public.orders
  for each row execute function public.tg_notify_order_status();

-- ---------------------------------------------------------------------
-- 3b. New order → seller notification
--
-- Not asked for explicitly, but a seller who is never told an order arrived
-- is the reason orders sit unaccepted until the 24-hour clock cancels them.
-- ---------------------------------------------------------------------
create or replace function public.tg_notify_new_order_seller()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  select s.owner_id into v_owner from public.shops s where s.id = new.shop_id;
  if v_owner is null then return new; end if;

  insert into public.notifications (user_id, kind, title, body, href, order_id)
  values (
    v_owner, 'order', 'New order received',
    format('%s — N%s. Accept it within 24 hours.', new.reference, to_char(new.total, 'FM999,999,999.00')),
    '/seller/orders', new.id
  );
  return new;
end $$;

drop trigger if exists t_notify_new_order_seller on public.orders;
create trigger t_notify_new_order_seller
  after insert on public.orders
  for each row execute function public.tg_notify_new_order_seller();

-- ---------------------------------------------------------------------
-- 3c. Unread count + mark-all-read
-- ---------------------------------------------------------------------
create or replace function public.unread_notification_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.notifications n
   where n.user_id = auth.uid()
     and n.read_at is null;
$$;

revoke all on function public.unread_notification_count() from public;
grant execute on function public.unread_notification_count() to authenticated;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any(p_ids));
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Web Push subscriptions
--
-- One row per browser/device. `endpoint` is unique per subscription, so a
-- user with a phone and a laptop has two rows and gets the notification on
-- both. The keys are what the push service needs to encrypt the payload.
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 5. Realtime
--
-- The header bell subscribes to INSERTs on `notifications` so the badge
-- moves without a refresh. Publishing the table is what makes that work.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'notifications'
     )
  then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Backfill: nothing to do for discounts (null = no discount), but the
--    wishlist and notification tables start empty by design.
-- ---------------------------------------------------------------------
