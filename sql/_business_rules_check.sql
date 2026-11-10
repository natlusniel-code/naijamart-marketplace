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

  -- RULE: 24–48h payout clock -----------------------------------------
  if (select available_at from public.payouts where order_id = v_order)
       between now() + interval '23 hours' and now() + interval '25 hours' then
    raise notice 'PASS  payout locks for 24h after delivery';
  else
    raise notice 'FAIL  payout available_at is not 24h out'; v_ok := false;
  end if;

  -- RULE: seller cannot withdraw before the lock expires --------------
  perform set_config('request.jwt.claim.sub', v_seller::text, true);
  begin
    perform public.request_payout(v_shop);
    raise notice 'FAIL  payout was withdrawable inside the 24h lock'; v_ok := false;
  exception when others then
    raise notice 'PASS  payout blocked inside the 24h lock';
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

  raise notice '---- % ----', case when v_ok then 'ALL BUSINESS RULES PASS' else 'SOME RULES FAILED' end;
end $$;
