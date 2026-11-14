-- =====================================================================
-- Functional test for 0035–0037.
-- =====================================================================
-- Seeds a buyer, two sellers (one Basic, one Premium), listings, views,
-- orders and reviews, then exercises every new function and asserts the
-- result. Any failed assertion raises and the run stops.
--
-- Run:  psql -d nmtest -v ON_ERROR_STOP=1 -f sql/_test_plans_and_ai.sql
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages to warning;

-- ── fixtures ─────────────────────────────────────────────────────────
do $$
declare
  v_buyer   uuid := '11111111-1111-1111-1111-111111111111';
  v_seller1 uuid := '22222222-2222-2222-2222-222222222222';  -- basic
  v_seller2 uuid := '33333333-3333-3333-3333-333333333333';  -- premium
  v_shop1   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_shop2   uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  v_cat     uuid;
  v_l1      uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_l2      uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  v_l3      uuid := 'bbbbbbbb-0000-0000-0000-000000000003';
  v_order   uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_chat    uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_msg     uuid;
begin
  insert into auth.users (id, email) values
    (v_buyer,   'buyer@test.ng'),
    (v_seller1, 'basic@test.ng'),
    (v_seller2, 'premium@test.ng')
  on conflict (id) do nothing;

  insert into public.profiles (id, email, full_name, role, state, city)
  values
    (v_buyer,   'buyer@test.ng',   'Test Buyer',   'buyer',  'Lagos', 'Ikeja'),
    (v_seller1, 'basic@test.ng',   'Basic Seller', 'seller', 'Lagos', 'Ikeja'),
    (v_seller2, 'premium@test.ng', 'Prem Seller',  'seller', 'Lagos', 'Ikeja')
  on conflict (id) do update set state = excluded.state, city = excluded.city;

  select id into v_cat from public.categories limit 1;

  insert into public.shops
    (id, owner_id, name, slug, description, category, state, city, status, verified,
     plan, subscription_status, subscription_expires_at, delivery_fee, free_delivery_threshold,
     pickup_available, kind, rating_avg, rating_count)
  values
    (v_shop1, v_seller1, 'Basic Shop', 'basic-shop', 'A basic shop', 'fashion', 'Lagos', 'Ikeja',
     'approved', true, 'basic', 'active', now() + interval '20 days', 500, 20000, true, 'both', 4.2, 3),
    (v_shop2, v_seller2, 'Premium Shop', 'premium-shop', 'A premium shop', 'fashion', 'Lagos', 'Ikeja',
     'approved', true, 'premium', 'active', now() + interval '20 days', 500, 20000, true, 'both', 4.8, 5)
  on conflict (id) do nothing;

  insert into public.listings
    (id, shop_id, type, title, description, category_id, price, stock, status, images,
     rating_avg, rating_count, views, clicks)
  values
    (v_l1, v_shop1, 'product', 'Leather Sandals', 'Brown leather sandals', v_cat, 12000, 10, 'live', '[]', 4.5, 2, 40, 8),
    (v_l2, v_shop2, 'product', 'Wireless Earbuds', 'Bluetooth earbuds', v_cat, 18000, 5, 'live', '[]', 4.9, 4, 90, 20),
    (v_l3, v_shop2, 'product', 'Phone Case', 'Silicone case', v_cat, 3000, 50, 'live', '[]', 4.0, 1, 5, 1)
  on conflict (id) do nothing;

  -- The buyer viewed the sandals twice (should de-dupe to one row).
  perform public.track_listing_view(v_l1, v_buyer);
  perform public.track_listing_view(v_l1, v_buyer);
  perform public.track_listing_view(v_l2, v_buyer);

  -- A delivered order on the sandals, so "already bought" can be tested.
  insert into public.orders
    (id, reference, buyer_id, shop_id, status, subtotal, delivery_fee, total,
     commission_rate, commission_amount, payout_amount, accepted_at, delivered_at)
  values
    (v_order, 'NM-TEST-1', v_buyer, v_shop1, 'delivered', 12000, 500, 12500,
     0.05, 600, 11400, now() - interval '3 days', now() - interval '1 day')
  on conflict (id) do nothing;

  insert into public.order_items (order_id, listing_id, title, unit_price, quantity, line_total)
  values (v_order, v_l1, 'Leather Sandals', 12000, 1, 12000)
  on conflict do nothing;

  -- Reviews on the premium shop.
  insert into public.reviews (buyer_id, shop_id, rating, body, status)
  values
    (v_buyer, v_shop2, 5, 'Fast delivery, exactly as described.', 'published'),
    (v_buyer, v_shop2, 4, 'Good but the box was dented.', 'published')
  on conflict do nothing;

  -- A chat with one buyer message, for the AI reply queue.
  insert into public.chats (id, buyer_id, seller_id, shop_id)
  values (v_chat, v_buyer, v_seller2, v_shop2)
  on conflict (id) do nothing;

  insert into public.messages (chat_id, sender_id, body)
  values (v_chat, v_buyer, 'Do you deliver to Surulere?')
  returning id into v_msg;

  raise notice 'fixtures ok (message %)', v_msg;
end $$;

-- ── 1. plans exist with the right prices ─────────────────────────────
do $$
declare v_premium numeric; v_basic numeric;
begin
  select price into v_premium from public.seller_plans where id = 'premium';
  select price into v_basic   from public.seller_plans where id = 'basic';

  if v_premium <> 7500 then
    raise exception 'Premium price should be 7500, got %', v_premium;
  end if;
  if v_basic <> 0 then
    raise exception 'Basic should be free, got %', v_basic;
  end if;
  raise notice 'PASS 1: plans seeded (basic=%, premium=%)', v_basic, v_premium;
end $$;

-- ── 2. the feature gate ──────────────────────────────────────────────
do $$
declare
  v_shop1 uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_shop2 uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
begin
  -- Basic: no AI, but the base features are there.
  if public.seller_has_feature(v_shop1, 'aiInsights') then
    raise exception 'Basic shop must NOT have AI seller analytics';
  end if;
  if public.seller_has_feature(v_shop1, 'aiListing') then
    raise exception 'Basic shop must NOT have the AI listing assistant';
  end if;
  if not public.seller_has_feature(v_shop1, 'orders') then
    raise exception 'Basic shop SHOULD have unlimited orders';
  end if;

  -- Premium: everything.
  if not public.seller_has_feature(v_shop2, 'aiInsights') then
    raise exception 'Premium shop MUST have AI seller analytics';
  end if;
  if not public.seller_has_feature(v_shop2, 'aiReply') then
    raise exception 'Premium shop MUST have AI auto-reply';
  end if;

  raise notice 'PASS 2: feature gate separates Basic from Premium';
end $$;

-- ── 3. the gate closes on an expired subscription ────────────────────
do $$
declare v_shop2 uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
begin
  -- The shops guard reverts subscription columns for a non-admin, so BOTH
  -- writes go through the service role, exactly as the app does.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.shops set subscription_expires_at = now() - interval '1 day' where id = v_shop2;
  perform set_config('request.jwt.claim.role', '', true);
  if public.seller_has_feature(v_shop2, 'aiInsights') then
    raise exception 'An EXPIRED subscription must not keep Premium features';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.shops set subscription_expires_at = now() + interval '20 days' where id = v_shop2;
  perform set_config('request.jwt.claim.role', '', true);
  raise notice 'PASS 3: expiry closes the gate';
end $$;

-- ── 4. the gate closes on an unverified shop ─────────────────────────
do $$
declare v_shop2 uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.shops set verified = false where id = v_shop2;
  perform set_config('request.jwt.claim.role', '', true);
  if public.seller_has_feature(v_shop2, 'aiInsights') then
    raise exception 'An UNVERIFIED shop must not have Premium features';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.shops set verified = true where id = v_shop2;
  perform set_config('request.jwt.claim.role', '', true);
  raise notice 'PASS 4: verification closes the gate';
end $$;

-- ── 5. admin can change the Premium price ────────────────────────────
do $$
declare v_price numeric; v_legacy numeric;
begin
  -- Pretend to be an admin for the is_admin() check. `is_admin()` reads
  -- `admin_users`, not `profiles.role` — a row there IS admin access.
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  insert into public.admin_users (user_id, email)
  values ('22222222-2222-2222-2222-222222222222', 'basic@test.ng')
  on conflict (user_id) do nothing;

  perform public.admin_update_seller_plan('premium', 9000, null, 'Now with more');

  select price into v_price from public.seller_plans where id = 'premium';
  select subscription_price into v_legacy from public.platform_settings where id = 1;

  if v_price <> 9000 then
    raise exception 'Admin price change did not land: %', v_price;
  end if;
  if v_legacy <> 9000 then
    raise exception 'Legacy subscription_price did not follow: %', v_legacy;
  end if;

  -- Put it back.
  perform public.admin_update_seller_plan('premium', 7500, null, 'Every seller feature, including all the AI tools');
  delete from public.admin_users where user_id = '22222222-2222-2222-2222-222222222222';
  raise notice 'PASS 5: admin edits the Premium price and the legacy column follows';
end $$;

-- ── 6. a non-admin cannot change the price ───────────────────────────
do $$
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  begin
    perform public.admin_update_seller_plan('premium', 1, null, null);
    raise exception 'A buyer was able to change the plan price!';
  exception
    when others then
      if sqlerrm like '%Admins only%' then
        raise notice 'PASS 6: non-admin is refused';
      else
        raise;
      end if;
  end;
end $$;

-- ── 7. recommendation signals ────────────────────────────────────────
do $$
declare
  v_buyer uuid := '11111111-1111-1111-1111-111111111111';
  v_sig   jsonb;
  v_cands jsonb;
  v_ids   text[];
begin
  v_sig := public.buyer_recommendation_signals(v_buyer, '{}'::uuid[], 40);

  if v_sig is null then raise exception 'signals returned null'; end if;

  -- The buyer viewed two listings; the log must have de-duped the repeat.
  if jsonb_array_length(v_sig->'viewed') <> 2 then
    raise exception 'expected 2 distinct viewed listings, got %',
      jsonb_array_length(v_sig->'viewed');
  end if;

  v_cands := v_sig->'candidates';
  if jsonb_array_length(v_cands) = 0 then
    raise exception 'no candidates were produced';
  end if;

  -- The sandals were BOUGHT, so they must not be recommended again.
  select array_agg(c->>'id') into v_ids from jsonb_array_elements(v_cands) c;
  if 'bbbbbbbb-0000-0000-0000-000000000001' = any(v_ids) then
    raise exception 'a listing the buyer already bought was recommended';
  end if;

  -- The buyer's own shop must never appear (they own none, but the rule
  -- is checked by the query; assert the premium shop's items are there).
  if not ('bbbbbbbb-0000-0000-0000-000000000002' = any(v_ids)) then
    raise exception 'the live premium listing was not a candidate';
  end if;

  raise notice 'PASS 7: signals gathered, bought item excluded, % candidates',
    jsonb_array_length(v_cands);
end $$;

-- ── 8. cart ids are honoured ─────────────────────────────────────────
do $$
declare
  v_buyer uuid := '11111111-1111-1111-1111-111111111111';
  v_sig   jsonb;
begin
  v_sig := public.buyer_recommendation_signals(
    v_buyer, array['bbbbbbbb-0000-0000-0000-000000000003']::uuid[], 40);

  if jsonb_array_length(v_sig->'cart') <> 1 then
    raise exception 'the cart signal was not picked up';
  end if;
  raise notice 'PASS 8: cart ids reach the signal gatherer';
end $$;

-- ── 9. quality metrics ───────────────────────────────────────────────
do $$
declare
  v_shop2 uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  v_m     jsonb;
begin
  v_m := public.seller_quality_metrics(v_shop2);

  if (v_m->>'review_count')::int <> 2 then
    raise exception 'expected 2 reviews, got %', v_m->>'review_count';
  end if;
  if (v_m->>'rating_avg')::numeric <> 4.5 then
    raise exception 'expected a 4.5 average, got %', v_m->>'rating_avg';
  end if;
  -- 4.5/5 * 100 = 90
  if (v_m->>'review_score')::int <> 90 then
    raise exception 'expected review_score 90, got %', v_m->>'review_score';
  end if;
  -- No orders on this shop: reliability must be the neutral 60, not 0.
  if (v_m->>'reliability_score')::int <> 60 then
    raise exception 'a shop with no orders should score 60 on reliability, got %',
      v_m->>'reliability_score';
  end if;

  raise notice 'PASS 9: quality metrics (reviews=%, score=%)',
    v_m->>'review_count', v_m->>'review_score';
end $$;

-- ── 10. insight inputs ───────────────────────────────────────────────
do $$
declare
  v_shop1 uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_i     jsonb;
begin
  v_i := public.seller_insight_inputs(v_shop1);

  if v_i is null then raise exception 'insight inputs returned null'; end if;
  if jsonb_array_length(v_i->'listings') = 0 then
    raise exception 'no listings in the insight inputs';
  end if;
  if (v_i->'totals_30d'->>'orders')::int <> 1 then
    raise exception 'expected 1 order in the last 30 days, got %',
      v_i->'totals_30d'->>'orders';
  end if;
  if (v_i->'totals_30d'->>'revenue')::numeric <> 12500 then
    raise exception 'expected 12500 revenue, got %', v_i->'totals_30d'->>'revenue';
  end if;

  raise notice 'PASS 10: insight inputs (orders=%, revenue=%)',
    v_i->'totals_30d'->>'orders', v_i->'totals_30d'->>'revenue';
end $$;

-- ── 11. presence + AI reply queue ────────────────────────────────────
do $$
declare
  v_shop2 uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  v_chat  uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_msg   uuid;
  v_id    uuid;
  v_online boolean;
begin
  select id into v_msg from public.messages where chat_id = v_chat limit 1;

  -- Fresh shop: never seen → offline.
  update public.shops set last_seen_at = null where id = v_shop2;
  v_online := public.seller_is_online(v_shop2);
  if v_online then raise exception 'a shop never seen must be offline'; end if;

  -- Seen just now → online.
  update public.shops set last_seen_at = now() where id = v_shop2;
  v_online := public.seller_is_online(v_shop2);
  if not v_online then raise exception 'a shop seen now must be online'; end if;

  -- Seen 10 minutes ago → offline again.
  update public.shops set last_seen_at = now() - interval '10 minutes' where id = v_shop2;
  v_online := public.seller_is_online(v_shop2);
  if v_online then raise exception 'a shop seen 10 min ago must be offline'; end if;

  -- Queue a suggestion, then a second one: the first must be superseded.
  v_id := public.queue_ai_reply(v_chat, v_msg, 'Yes, we deliver to Surulere.', 'auto');
  if v_id is null then raise exception 'queue_ai_reply returned null'; end if;

  perform public.queue_ai_reply(v_chat, v_msg, 'A newer draft.', 'suggested');

  if (select count(*) from public.ai_reply_suggestions
       where chat_id = v_chat and status = 'pending') <> 1 then
    raise exception 'the older suggestion was not superseded';
  end if;

  raise notice 'PASS 11: presence window and reply queue both behave';
end $$;

-- ── 12. view tracking de-dupes within the hour ───────────────────────
do $$
declare
  v_buyer uuid := '11111111-1111-1111-1111-111111111111';
  v_l3    uuid := 'bbbbbbbb-0000-0000-0000-000000000003';
  v_n     int;
begin
  perform public.track_listing_view(v_l3, v_buyer);
  perform public.track_listing_view(v_l3, v_buyer);
  perform public.track_listing_view(v_l3, v_buyer);

  select count(*) into v_n from public.listing_views
   where listing_id = v_l3 and viewer_id = v_buyer;

  if v_n <> 1 then
    raise exception 'three views in an hour should log once, logged %', v_n;
  end if;
  raise notice 'PASS 12: repeat views de-dupe to one row';
end $$;

-- ── 13. a seller viewing their own listing is not a view ─────────────
do $$
declare
  v_seller2 uuid := '33333333-3333-3333-3333-333333333333';
  v_l2      uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  v_before  int;
  v_after   int;
begin
  select views into v_before from public.listings where id = v_l2;
  perform public.track_listing_view(v_l2, v_seller2);
  select views into v_after from public.listings where id = v_l2;

  if v_after <> v_before then
    raise exception 'a seller viewing their own listing incremented the counter';
  end if;
  raise notice 'PASS 13: self-views are ignored';
end $$;

-- ── 14. choose_seller_plan reads the price from the plan ─────────────
do $$
declare
  v_seller1 uuid := '22222222-2222-2222-2222-222222222222';
  v_res     jsonb;
begin
  perform set_config('request.jwt.claim.sub', v_seller1::text, true);
  v_res := public.choose_seller_plan('premium');

  if (v_res->>'price')::numeric <> 7500 then
    raise exception 'choose_seller_plan returned the wrong price: %', v_res->>'price';
  end if;
  if (select plan from public.shops where owner_id = v_seller1) <> 'premium' then
    raise exception 'the shop plan was not updated';
  end if;
  if (select subscription_status from public.shops where owner_id = v_seller1) <> 'pending' then
    raise exception 'the shop should be pending verification after choosing a plan';
  end if;

  raise notice 'PASS 14: choosing a plan records the tier and the real price';
end $$;

-- ── 15. a seller CANNOT grant themselves Premium ─────────────────────
-- The hole 0038 closes: `plan` was unguarded, so a seller could set
-- plan='premium' and leave subscription_status='active'.
do $$
declare
  v_seller1 uuid := '22222222-2222-2222-2222-222222222222';
  v_shop1   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_plan    text;
  v_status  text;
begin
  perform set_config('request.jwt.claim.sub', v_seller1::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Put the shop back to a clean, active Basic state.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.shops
     set plan = 'basic', subscription_status = 'active',
         subscription_expires_at = now() + interval '20 days'
   where id = v_shop1;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- The attack: flip the plan, leave the status alone.
  update public.shops set plan = 'premium' where id = v_shop1;

  select plan, subscription_status into v_plan, v_status
    from public.shops where id = v_shop1;

  if v_plan = 'premium' then
    raise exception 'PRIVILEGE ESCALATION: a seller set plan=premium while active';
  end if;
  if public.seller_has_feature(v_shop1, 'aiInsights') then
    raise exception 'PRIVILEGE ESCALATION: a seller gained Premium features';
  end if;

  raise notice 'PASS 15: a seller cannot grant themselves Premium (plan=%, status=%)',
    v_plan, v_status;
end $$;

-- ── 16. a seller cannot activate their own subscription ──────────────
do $$
declare
  v_seller1 uuid := '22222222-2222-2222-2222-222222222222';
  v_shop1   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_status  text;
begin
  perform set_config('request.jwt.claim.sub', v_seller1::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.shops set subscription_status = 'pending' where id = v_shop1;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- The attack: set the status straight to active.
  update public.shops set subscription_status = 'active' where id = v_shop1;

  select subscription_status into v_status from public.shops where id = v_shop1;
  if v_status = 'active' then
    raise exception 'PRIVILEGE ESCALATION: a seller activated their own subscription';
  end if;

  raise notice 'PASS 16: a seller cannot activate their own subscription (status=%)', v_status;
end $$;

-- ── 17. the admin confirmation path works ────────────────────────────
do $$
declare
  v_shop1 uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_res   jsonb;
  v_status text;
  v_exp   timestamptz;
begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  insert into public.admin_users (user_id, email)
  values ('22222222-2222-2222-2222-222222222222', 'basic@test.ng')
  on conflict (user_id) do nothing;

  v_res := public.admin_confirm_subscription(v_shop1, 30);

  select subscription_status, subscription_expires_at into v_status, v_exp
    from public.shops where id = v_shop1;

  if v_status <> 'active' then
    raise exception 'admin confirmation did not activate: %', v_status;
  end if;
  if v_exp < now() + interval '29 days' then
    raise exception 'the expiry was not extended by 30 days: %', v_exp;
  end if;

  delete from public.admin_users where user_id = '22222222-2222-2222-2222-222222222222';
  raise notice 'PASS 17: admin confirmation activates and extends';
end $$;

-- ── 18. the AI reply is sent AS THE SELLER, not as the buyer ─────────
-- The bug 0039 fixes: `send_chat_message` derives the sender from
-- auth.uid(), and the caller is the buyer's browser.
do $$
declare
  v_buyer  uuid := '11111111-1111-1111-1111-111111111111';
  v_seller2 uuid := '33333333-3333-3333-3333-333333333333';
  v_chat   uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_res    jsonb;
  v_sender uuid;
  v_ai     boolean;
begin
  -- The buyer's session is what calls this.
  perform set_config('request.jwt.claim.sub', v_buyer::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_res := public.send_ai_reply(v_chat, 'Yes, we deliver to Surulere. Delivery is ₦500.');

  if (v_res->>'blocked')::boolean then
    raise exception 'the AI reply was blocked unexpectedly';
  end if;

  select sender_id, ai_generated into v_sender, v_ai
    from public.messages
   where id = (v_res->'message'->>'id')::uuid;

  if v_sender <> v_seller2 then
    raise exception 'AI reply was sent as % — it must be the SELLER (%)',
      v_sender, v_seller2;
  end if;
  if v_ai is not true then
    raise exception 'the AI reply was not flagged ai_generated';
  end if;

  raise notice 'PASS 18: the AI reply is sent as the seller and flagged';
end $$;

-- ── 19. the AI reply still hits the chat guard ───────────────────────
do $$
declare
  v_buyer uuid := '11111111-1111-1111-1111-111111111111';
  v_chat  uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_res   jsonb;
  v_n     int;
begin
  perform set_config('request.jwt.claim.sub', v_buyer::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select count(*) into v_n from public.messages where chat_id = v_chat;

  -- A phone number is exactly what the guard exists to stop.
  v_res := public.send_ai_reply(v_chat, 'Call me on 08031234567 to arrange it.');

  if not coalesce((v_res->>'blocked')::boolean, false) then
    raise exception 'the chat guard did not block a phone number in an AI reply';
  end if;
  if (select count(*) from public.messages where chat_id = v_chat) <> v_n then
    raise exception 'a blocked AI reply was still inserted into messages';
  end if;
  if not exists (select 1 from public.blocked_messages where chat_id = v_chat) then
    raise exception 'the block was not recorded in blocked_messages';
  end if;

  raise notice 'PASS 19: the chat guard applies to AI replies too';
end $$;

-- ── 20. a stranger cannot make the AI speak for a shop ───────────────
do $$
declare
  v_chat uuid := 'dddddddd-0000-0000-0000-000000000001';
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    perform public.send_ai_reply(v_chat, 'Hello from a stranger.');
    raise exception 'a stranger was able to send an AI reply into a chat!';
  exception
    when others then
      if sqlerrm like '%not yours%' then
        raise notice 'PASS 20: a stranger is refused';
      else
        raise;
      end if;
  end;
end $$;

\echo ''
\echo '=========================================='
\echo ' ALL 20 ASSERTIONS PASSED'
\echo '=========================================='
