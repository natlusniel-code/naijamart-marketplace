-- Behavioural tests for sql/0013, run against a real Postgres.
-- Every assertion raises an exception on failure, so psql -v ON_ERROR_STOP=1
-- turns any wrong behaviour into a non-zero exit.

\set ON_ERROR_STOP on
\pset pager off

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'buyer@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'seller@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'other@example.com');

insert into public.profiles (id, role, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'buyer', 'Buyer One'),
  ('22222222-2222-2222-2222-222222222222', 'seller', 'Seller One'),
  ('33333333-3333-3333-3333-333333333333', 'buyer', 'Buyer Two');

insert into public.shops (id, owner_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'Test Shop');

-- ============================================================ 1. DISCOUNTS
\echo '--- 1. discount generated column ---'

insert into public.listings (id, shop_id, title, price, original_price) values
  ('b0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Twenty off', 8000, 10000),
  ('b0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'No discount', 8000, null),
  ('b0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Same price', 10000, 10000),
  ('b0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Third off', 6667, 10000);

do $$
declare pct numeric;
begin
  select discount_percent into pct from public.listings where id = 'b0000000-0000-0000-0000-000000000001';
  if pct <> 20 then raise exception 'expected 20, got %', pct; end if;

  select discount_percent into pct from public.listings where id = 'b0000000-0000-0000-0000-000000000002';
  if pct <> 0 then raise exception 'null original should be 0, got %', pct; end if;

  select discount_percent into pct from public.listings where id = 'b0000000-0000-0000-0000-000000000003';
  if pct <> 0 then raise exception 'same price should be 0, got %', pct; end if;

  select discount_percent into pct from public.listings where id = 'b0000000-0000-0000-0000-000000000004';
  if pct <> 33.33 then raise exception 'expected 33.33, got %', pct; end if;

  raise notice 'PASS: generated column matches the JS implementation';
end $$;

-- The percentage must follow the prices when they change, not go stale.
update public.listings set price = 5000 where id = 'b0000000-0000-0000-0000-000000000001';
do $$
declare pct numeric;
begin
  select discount_percent into pct from public.listings where id = 'b0000000-0000-0000-0000-000000000001';
  if pct <> 50 then raise exception 'after update expected 50, got %', pct; end if;
  raise notice 'PASS: percentage recomputes on price change';
end $$;

-- A "discount" that raises the price must be rejected by the constraint.
do $$
begin
  begin
    update public.listings set original_price = 100 where id = 'b0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: constraint did not reject original_price < price';
  exception when check_violation then
    raise notice 'PASS: constraint rejects original_price below price';
  end;
end $$;

-- ============================================================ 2. WISHLIST
\echo '--- 2. wishlist ---'

insert into public.wishlists (user_id, listing_id)
values ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001');

-- Saving the same thing twice must not create a duplicate row.
do $$
begin
  begin
    insert into public.wishlists (user_id, listing_id)
    values ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: duplicate wishlist row was allowed';
  exception when unique_violation then
    raise notice 'PASS: a listing can only be saved once per buyer';
  end;
end $$;

-- Deleting the listing must clear the wishlist row (no orphans).
delete from public.listings where id = 'b0000000-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from public.wishlists where listing_id = 'b0000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FAIL: % orphaned wishlist rows', n; end if;
  raise notice 'PASS: wishlist rows cascade when a listing is deleted';
end $$;

-- ==================================================== 3. ORDER NOTIFICATIONS
\echo '--- 3. order status notifications ---'

insert into public.orders (id, buyer_id, shop_id, status, total)
values ('c0000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'pending_payment', 15000);

-- One notification for the buyer, one for the seller, on insert.
do $$
declare buyer_n int; seller_n int;
begin
  select count(*) into buyer_n from public.notifications
   where order_id = 'c0000000-0000-0000-0000-000000000001'
     and user_id = '11111111-1111-1111-1111-111111111111';
  select count(*) into seller_n from public.notifications
   where order_id = 'c0000000-0000-0000-0000-000000000001'
     and user_id = '22222222-2222-2222-2222-222222222222';

  if buyer_n <> 1 then raise exception 'FAIL: buyer got % notifications on insert', buyer_n; end if;
  if seller_n <> 1 then raise exception 'FAIL: seller got % notifications on insert', seller_n; end if;
  raise notice 'PASS: new order notifies both buyer and seller';
end $$;

-- Each status change adds exactly one buyer notification.
update public.orders set status = 'paid' where id = 'c0000000-0000-0000-0000-000000000001';
update public.orders set status = 'accepted' where id = 'c0000000-0000-0000-0000-000000000001';
update public.orders set status = 'shipped' where id = 'c0000000-0000-0000-0000-000000000001';

do $$
declare n int;
begin
  select count(*) into n from public.notifications
   where order_id = 'c0000000-0000-0000-0000-000000000001'
     and user_id = '11111111-1111-1111-1111-111111111111';
  if n <> 4 then raise exception 'FAIL: expected 4 buyer notifications, got %', n; end if;
  raise notice 'PASS: each status change adds one notification';
end $$;

-- An update that does NOT change the status must not notify. This is the
-- case that would spam a buyer every time a receipt was uploaded.
update public.orders set total = 16000 where id = 'c0000000-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from public.notifications
   where order_id = 'c0000000-0000-0000-0000-000000000001'
     and user_id = '11111111-1111-1111-1111-111111111111';
  if n <> 4 then raise exception 'FAIL: a non-status update created a notification (now %)', n; end if;
  raise notice 'PASS: non-status updates do not notify';
end $$;

-- Setting the same status again must not notify either.
update public.orders set status = 'shipped' where id = 'c0000000-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from public.notifications
   where order_id = 'c0000000-0000-0000-0000-000000000001'
     and user_id = '11111111-1111-1111-1111-111111111111';
  if n <> 4 then raise exception 'FAIL: re-setting the same status notified (now %)', n; end if;
  raise notice 'PASS: re-setting the same status does not notify';
end $$;

-- The notification must carry a working link to the order.
do $$
declare v_href text;
begin
  select n.href into v_href from public.notifications n
   where n.order_id = 'c0000000-0000-0000-0000-000000000001'
     and n.user_id = '11111111-1111-1111-1111-111111111111'
   order by n.created_at desc limit 1;
  if v_href <> '/orders/c0000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: href was %', v_href;
  end if;
  raise notice 'PASS: notification links to the order';
end $$;

-- ================================================ 4. UNREAD COUNT / MARK READ
\echo '--- 4. unread count and mark-read ---'

-- Act as the buyer for the RPCs, which read auth.uid().
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare n int;
begin
  n := public.unread_notification_count();
  if n <> 4 then raise exception 'FAIL: unread count was %, expected 4', n; end if;
  raise notice 'PASS: unread count is per-user and correct';
end $$;

-- Another user must not see the buyer's count.
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
declare n int;
begin
  n := public.unread_notification_count();
  if n <> 0 then raise exception 'FAIL: other user saw % unread', n; end if;
  raise notice 'PASS: unread count is isolated per user';
end $$;

-- Marking read only touches the caller's rows.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.mark_notifications_read(null);

do $$
declare n int;
begin
  n := public.unread_notification_count();
  if n <> 0 then raise exception 'FAIL: % still unread after mark-all', n; end if;
  raise notice 'PASS: mark-all-read clears the count';
end $$;

-- Marking read must not have touched the seller's notifications.
do $$
declare n int;
begin
  select count(*) into n from public.notifications
   where user_id = '22222222-2222-2222-2222-222222222222' and read_at is null;
  if n <> 1 then raise exception 'FAIL: seller rows were affected (unread=%)', n; end if;
  raise notice 'PASS: mark-read does not cross users';
end $$;

-- ==================================================== 5. PUSH SUBSCRIPTIONS
\echo '--- 5. push subscriptions ---'

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values ('11111111-1111-1111-1111-111111111111', 'https://push.example/abc', 'key1', 'auth1');

-- The same endpoint cannot be registered twice (a re-subscribe must upsert).
do $$
begin
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values ('11111111-1111-1111-1111-111111111111', 'https://push.example/abc', 'key1', 'auth1');
    raise exception 'FAIL: duplicate endpoint was allowed';
  exception when unique_violation then
    raise notice 'PASS: endpoint is unique, so re-subscribing upserts';
  end;
end $$;

-- A user can have several devices.
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values ('11111111-1111-1111-1111-111111111111', 'https://push.example/phone', 'key2', 'auth2');
do $$
declare n int;
begin
  select count(*) into n from public.push_subscriptions
   where user_id = '11111111-1111-1111-1111-111111111111';
  if n <> 2 then raise exception 'FAIL: expected 2 devices, got %', n; end if;
  raise notice 'PASS: one user can register several devices';
end $$;

-- ============================================================ 6. IDEMPOTENCY
\echo '--- 6. re-running the migration ---'
\echo '(handled by the runner: 0013 is applied twice)'

\echo ''
\echo 'ALL SQL TESTS PASSED'
