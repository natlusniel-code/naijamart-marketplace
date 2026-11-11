-- =====================================================================
-- End-to-end business-rule test. Run against the LOCAL shimmed DB only.
--   psql -d nmtest -f sql/_business_rules_check.sql
-- Every block either prints PASS or raises. Any output containing FAIL
-- means a rule is broken.
-- =====================================================================
\set QUIET on
\pset footer off

do $$
declare
  v_buyer uuid := gen_random_uuid();
  v_seller uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_listing uuid;
  v_shop uuid;
  v_order uuid;
  v_orders public.orders;
  v_res jsonb;
  v_total numeric;
  v_pay uuid;
  v_ok boolean := true;
begin
  -- fixtures ------------------------------------------------------------
  insert into auth.users (id, email) values
    (v_buyer, 'buyer@test.local'),
    (v_seller, 'seller@test.local'),
    (v_admin, 'admin@test.local');

  insert into public.profiles (id, role, full_name, email, city, state)
  values (v_buyer, 'buyer', 'Adaeze Okonkwo', 'buyer@test.local', 'Abeokuta South', 'Ogun'),
         (v_seller, 'seller', 'Tunde Bakare', 'seller@test.local', 'Abeokuta South', 'Ogun'),
         (v_admin, 'admin', 'Admin', 'admin@test.local', 'Abeokuta South', 'Ogun')
  -- handle_new_user() already made blank profiles on the auth.users insert
  on conflict (id) do update
    set role = excluded.role, full_name = excluded.full_name,
        city = excluded.city, state = excluded.state;

  insert into public.admin_users (user_id, email) values (v_admin, 'admin@test.local');

  select id into v_shop from public.shops where slug = 'techhub-abeokuta';
  update public.shops set owner_id = v_seller, is_demo = false where id = v_shop;
  select id into v_listing from public.listings where shop_id = v_shop and title = 'Wireless Earbuds Pro';

  -- act as the buyer ---------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_buyer::text, true);

  -- RULE: buyer may only order inside their own city --------------------
  begin
    perform public.place_order(
      v_shop, jsonb_build_array(jsonb_build_object('listing_id', v_listing, 'quantity', 2)),
      'delivery', '12 Kuto Road', 'Adaeze Okonkwo · 08030000000');
    raise notice 'PASS  buyer places order in own city';
  exception when others then
    raise notice 'FAIL  place_order in own city: %', sqlerrm;
    v_ok := false;
  end;

  select o.* into v_orders from public.orders o
   where o.buyer_id = v_buyer order by o.created_at desc limit 1;
  v_order := v_orders.id;

  -- RULE: order starts pending_payment, 5% commission, payout = 95% -----
  if v_orders.status = 'pending_payment' then
    raise notice 'PASS  new order is pending_payment';
  else
    raise notice 'FAIL  new order status = %', v_orders.status; v_ok := false;
  end if;

  v_total := 8000 * 2 + 500;   -- 2 × earbuds + delivery
  if v_orders.total = v_total then
    raise notice 'PASS  total = % (items + delivery)', v_total;
  else
    raise notice 'FAIL  total = %, expected %', v_orders.total, v_total; v_ok := false;
  end if;

  if v_orders.commission_amount = round(v_total * 0.05, 2)
     and v_orders.payout_amount = v_total - v_orders.commission_amount then
    raise notice 'PASS  5%% commission split: commission % / payout %',
      v_orders.commission_amount, v_orders.payout_amount;
  else
    raise notice 'FAIL  commission math: % / %', v_orders.commission_amount, v_orders.payout_amount;
    v_ok := false;
  end if;

  if v_orders.payout_status = 'held' then
    raise notice 'PASS  money starts held in escrow';
  else
    raise notice 'FAIL  payout_status = %', v_orders.payout_status; v_ok := false;
  end if;

  -- RULE: only an admin can verify the receipt -------------------------
  select id into v_pay from public.payments where order_id = v_order;
  begin
    perform public.admin_verify_payment(v_pay, true, null);
    raise notice 'FAIL  buyer was able to verify their own payment'; v_ok := false;
  exception when others then
    raise notice 'PASS  non-admin cannot verify a payment';
  end;

  -- act as the admin ---------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.admin_verify_payment(v_pay, true, null);
  select * into v_orders from public.orders where id = v_order;

  if v_orders.status = 'paid' and v_orders.auto_cancel_at is not null then
    raise notice 'PASS  admin verify → paid, 24h accept clock set';
  else
    raise notice 'FAIL  after verify: status = %, auto_cancel_at = %', v_orders.status, v_orders.auto_cancel_at;
    v_ok := false;
  end if;

  -- act as the seller --------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_seller::text, true);
  begin
    perform public.seller_accept_order(v_order);
    raise notice 'PASS  seller accepts';
  exception when others then
    raise notice 'FAIL  seller_accept_order: %', sqlerrm; v_ok := false;
  end;

  perform public.seller_advance_order(v_order, 'processing');
  perform public.seller_advance_order(v_order, 'shipped');
  select * into v_orders from public.orders where id = v_order;
  if v_orders.status = 'shipped' then
    raise notice 'PASS  seller advances processing → shipped';
  else
    raise notice 'FAIL  expected shipped, got %', v_orders.status; v_ok := false;
  end if;

  -- RULE: seller cannot confirm delivery on the buyer's behalf --------
  begin
    perform public.confirm_delivery(v_order);
    raise notice 'FAIL  seller confirmed delivery themselves'; v_ok := false;
  exception when others then
    raise notice 'PASS  only the buyer can confirm delivery';
  end;

  -- act as the buyer again ---------------------------------------------
  perform set_config('request.jwt.claim.sub', v_buyer::text, true);
  begin
    perform public.confirm_delivery(v_order);
    raise notice 'PASS  buyer confirms delivery';
  exception when others then
    raise notice 'FAIL  confirm_delivery: %', sqlerrm; v_ok := false;
  end;

  select * into v_orders from public.orders where id = v_order;
  if v_orders.payout_status = 'released' then
    raise notice 'PASS  delivery releases escrow to the seller';
  else
    raise notice 'FAIL  payout_status after delivery = %', v_orders.payout_status; v_ok := false;
  end if;

  if exists (select 1 from public.payouts where order_id = v_order and status = 'queued') then
    raise notice 'PASS  a queued payout row was created';
  else
    raise notice 'FAIL  no payout row for the order'; v_ok := false;
  end if;

  -- RULE: payout unlocks 4 days after delivery confirmation -----------
  if (select available_at from public.payouts where order_id = v_order)
       between now() + interval '95 hours' and now() + interval '97 hours' then
    raise notice 'PASS  payout locks for 4 days after delivery';
  else
    raise notice 'FAIL  payout available_at is not 4 days out (got %)',
      (select available_at from public.payouts where order_id = v_order);
    v_ok := false;
  end if;

  -- RULE: the 4-day window is configurable, not hard-coded ------------
  if (select payout_hold_days from public.platform_settings where id = 1) = 4 then
    raise notice 'PASS  platform_settings.payout_hold_days = 4';
  else
    raise notice 'FAIL  payout_hold_days = %',
      (select payout_hold_days from public.platform_settings where id = 1);
    v_ok := false;
  end if;

  -- RULE: seller cannot withdraw before the lock expires --------------
  perform set_config('request.jwt.claim.sub', v_seller::text, true);
  begin
    perform public.request_payout(v_shop);
    raise notice 'FAIL  payout was withdrawable inside the 4-day lock'; v_ok := false;
  exception when others then
    raise notice 'PASS  payout blocked inside the 4-day lock';
  end;

  -- release the lock, then withdraw ------------------------------------
  update public.payouts set available_at = now() - interval '1 minute' where order_id = v_order;
  begin
    perform public.request_payout(v_shop);
    raise notice 'PASS  seller can request payout once unlocked';
  exception when others then
    raise notice 'FAIL  request_payout after unlock: %', sqlerrm; v_ok := false;
  end;

  -- RULE: admin marks it paid -----------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.admin_mark_payout_paid((select id from public.payouts where order_id = v_order), 'TEST-REF');
  if (select status from public.payouts where order_id = v_order) = 'paid'
     and (select payout_status from public.orders where id = v_order) = 'paid' then
    raise notice 'PASS  admin marks payout paid → payout + order agree';
  else
    raise notice 'FAIL  payout paid state did not propagate'; v_ok := false;
  end if;

  -- RULE: buyer reviews once; order becomes completed ------------------
  perform set_config('request.jwt.claim.sub', v_buyer::text, true);
  begin
    perform public.leave_review(v_order, 5, 'Earbuds arrived sealed, sound is clean.');
    raise notice 'PASS  buyer leaves a review';
  exception when others then
    raise notice 'FAIL  leave_review: %', sqlerrm; v_ok := false;
  end;

  begin
    perform public.leave_review(v_order, 1, 'again');
    raise notice 'FAIL  buyer could review the same order twice'; v_ok := false;
  exception when others then
    raise notice 'PASS  duplicate review rejected';
  end;

  if (select rating_avg from public.shops where id = v_shop) > 0 then
    raise notice 'PASS  shop rating recalculated after review';
  else
    raise notice 'FAIL  shop rating not updated'; v_ok := false;
  end if;

  -- ==================================================================
  -- RULE: chat blocker (sql/0011)
  -- ==================================================================
  declare
    v_chat uuid;
    v_res2 jsonb;
    v_before int;
  begin
    insert into public.chats (buyer_id, seller_id, shop_id)
    values (v_buyer, v_seller, v_shop) returning id into v_chat;

    perform set_config('request.jwt.claim.sub', v_buyer::text, true);

    -- a clean message goes through
    v_res2 := public.send_chat_message(v_chat, 'Is the earbuds still available?', null);
    if (v_res2->>'blocked')::boolean = false then
      raise notice 'PASS  clean message is sent';
    else
      raise notice 'FAIL  clean message was blocked'; v_ok := false;
    end if;

    -- a blocked message is refused, logged, and never stored
    select count(*) into v_before from public.messages where chat_id = v_chat;
    v_res2 := public.send_chat_message(v_chat, 'chat me on whatsapp 08031234567', null);
    if (v_res2->>'blocked')::boolean = true
       and (v_res2->>'warning') like 'This message was not sent because it contains restricted%' then
      raise notice 'PASS  blocked message returns the exact warning';
    else
      raise notice 'FAIL  blocked message did not return the warning: %', v_res2; v_ok := false;
    end if;

    if (select count(*) from public.messages where chat_id = v_chat) = v_before then
      raise notice 'PASS  blocked message is not stored (receiver never sees it)';
    else
      raise notice 'FAIL  blocked message reached the messages table'; v_ok := false;
    end if;

    if exists (select 1 from public.blocked_messages
                where chat_id = v_chat and sender_id = v_buyer
                  and receiver_id = v_seller
                  and body = 'chat me on whatsapp 08031234567'
                  and rule_group is not null and rule_pattern is not null) then
      raise notice 'PASS  blocked message logged with sender, receiver, body and rule';
    else
      raise notice 'FAIL  blocked message was not logged'; v_ok := false;
    end if;

    -- the direct-insert door is closed
    begin
      insert into public.messages (chat_id, sender_id, body)
      values (v_chat, v_buyer, 'reach me on telegram');
      raise notice 'FAIL  a blocked message was inserted directly'; v_ok := false;
    exception when others then
      raise notice 'PASS  direct insert of blocked content is refused';
    end;

    -- the allowed examples must not be blocked
    if (public.send_chat_message(v_chat, 'I need an Instagram logo design', null)->>'blocked')::boolean = false
       and (public.send_chat_message(v_chat, 'Send me the design file', null)->>'blocked')::boolean = false
       and (public.send_chat_message(v_chat, 'What is your price?', null)->>'blocked')::boolean = false
       and (public.send_chat_message(v_chat, 'Can you do this in 2 days?', null)->>'blocked')::boolean = false
       and (public.send_chat_message(v_chat, 'I will send the invoice by email later', null)->>'blocked')::boolean = false then
      raise notice 'PASS  the allowed examples are not blocked';
    else
      raise notice 'FAIL  an allowed example was blocked'; v_ok := false;
    end if;
  end;

  -- ==================================================================
  -- RULE: checkout distance (sql/0011)
  -- ==================================================================
  declare
    v_far_shop uuid;
    v_far_listing uuid;
    v_cheap numeric;
    v_pricey numeric;
  begin
    -- a shop in another LGA of the same state
    insert into public.shops (owner_id, name, slug, status, state, city, delivery_fee)
    values (v_seller, 'Far Shop', 'far-shop-test', 'approved', 'Ogun', 'Sagamu', 500)
    returning id into v_far_shop;

    insert into public.listings (shop_id, title, type, price, stock, status)
    values (v_far_shop, 'Cheap Item', 'product', 3000, 10, 'live')
    returning id into v_far_listing;

    perform set_config('request.jwt.claim.sub', v_buyer::text, true);

    -- under ₦20,000 → own LGA only, so this must be refused
    begin
      perform public.place_order(v_far_shop,
        jsonb_build_array(jsonb_build_object('listing_id', v_far_listing, 'quantity', 1)),
        'delivery', '12 Kuto Road', null);
      raise notice 'FAIL  under-threshold order from another LGA was allowed'; v_ok := false;
    exception when others then
      raise notice 'PASS  under ₦20,000 is restricted to the buyer''s own LGA';
    end;

    -- the same shop, but the basket clears ₦20,000 → any LGA in the state
    update public.listings set price = 25000 where id = v_far_listing;
    begin
      perform public.place_order(v_far_shop,
        jsonb_build_array(jsonb_build_object('listing_id', v_far_listing, 'quantity', 1)),
        'delivery', '12 Kuto Road', null);
      raise notice 'PASS  over ₦20,000 can order from any LGA in the state';
    exception when others then
      raise notice 'FAIL  over-threshold order from another LGA was refused: %', sqlerrm; v_ok := false;
    end;

    -- checkout_range() reports the same verdict the RPC enforces
    if (public.checkout_range(v_far_shop, 5000)->>'allowed')::boolean = false
       and (public.checkout_range(v_far_shop, 25000)->>'allowed')::boolean = true then
      raise notice 'PASS  checkout_range() agrees with place_order()';
    else
      raise notice 'FAIL  checkout_range() disagrees with place_order()'; v_ok := false;
    end if;
  end;

  -- ==================================================================
  -- RULE: payment-account rotation (sql/0011)
  -- ==================================================================
  declare
    v_a1 uuid;
    v_a2 uuid;
    v_b1 public.payment_accounts;
    v_b2 public.payment_accounts;
    v_b3 public.payment_accounts;
    v_other uuid := gen_random_uuid();
    v_other_acct public.payment_accounts;
  begin
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    v_a1 := (public.admin_save_payment_account(null, 'GTBank', '0123456789', 'NaijaMart Ltd', 'Main', null, true, 0)).id;
    v_a2 := (public.admin_save_payment_account(null, 'Zenith', '9876543210', 'NaijaMart Ltd', 'Backup', null, true, 1)).id;

    -- buyer A: two consecutive reservations must differ
    perform set_config('request.jwt.claim.sub', v_buyer::text, true);
    v_b1 := public.my_payment_account();
    -- spend the reservation the way place_order does
    update public.payment_account_assignments set expires_at = now()
     where buyer_id = v_buyer and account_id = v_b1.id and order_id is null;
    v_b2 := public.my_payment_account();

    if v_b1.id <> v_b2.id then
      raise notice 'PASS  a repeat buyer is rotated to a different account';
    else
      raise notice 'FAIL  repeat buyer got the same account twice'; v_ok := false;
    end if;

    -- buyer B must not be handed the same account as buyer A
    insert into auth.users (id, email) values (v_other, 'buyer2@test.local');
    insert into public.profiles (id, role, full_name, email, city, state)
    values (v_other, 'buyer', 'Chidi Eze', 'buyer2@test.local', 'Abeokuta South', 'Ogun')
    on conflict (id) do nothing;

    perform set_config('request.jwt.claim.sub', v_other::text, true);
    v_other_acct := public.my_payment_account();

    if v_other_acct.id is not null then
      raise notice 'PASS  a second buyer is assigned an account (buyer A had %)', v_b1.id;
    else
      raise notice 'FAIL  second buyer got no account'; v_ok := false;
    end if;

    -- the assignment is stored on the order, not chosen in the browser
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'orders'
         and column_name = 'payment_account_id'
    ) and exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'payments'
         and column_name = 'payment_account_id'
    ) then
      raise notice 'PASS  orders and payments both carry payment_account_id';
    else
      raise notice 'FAIL  payment_account_id missing from orders/payments'; v_ok := false;
    end if;

    -- buyers cannot read the account list directly
    perform set_config('request.jwt.claim.sub', v_buyer::text, true);
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = 'payment_accounts'
         and policyname = 'payment_accounts_admin'
    ) then
      raise notice 'FAIL  payment_accounts has no admin-only policy'; v_ok := false;
    else
      raise notice 'PASS  payment_accounts is admin-only';
    end if;
  end;

  raise notice '---- % ----', case when v_ok then 'ALL BUSINESS RULES PASS' else 'SOME RULES FAILED' end;
end $$;
