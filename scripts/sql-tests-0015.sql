-- =====================================================================
-- Behavioural tests for sql/0015 — run against a real Postgres.
-- Every assertion raises on failure, so ON_ERROR_STOP turns a wrong
-- result into a non-zero exit.
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'seller@example.com');

-- handle_new_user() already created the profile row from the auth.users
-- insert above; this only pins the role the fixtures need.
insert into public.profiles (id, role, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'seller', 'Seller One')
on conflict (id) do update set role = 'seller', full_name = 'Seller One';

insert into public.shops (id, owner_id, name, slug, city, state, status, verified, pickup_available, rating_avg, rating_count)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
   'Lagos Appliances', 'lagos-appliances', 'Ikeja', 'Lagos', 'approved', true, true, 4.6, 12),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111',
   'Abeokuta Home', 'abeokuta-home', 'Abeokuta', 'Ogun', 'approved', false, false, 3.2, 2);

-- Category ids come from the real seed in 0001.
\set elec  '''(select id from public.categories where slug = ''electronics'')'''
\set furn  '''(select id from public.categories where slug = ''home-furniture'')'''

-- ---------------------------------------------------------------- listings
-- 1. The reported search bug: title says "Washer", buyer searches
--    "washing machine". Only tags can bridge that gap.
insert into public.listings (id, shop_id, type, title, description, category_id, price, stock, status, tags, views)
values
  ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'product',
   'LG 7kg Front Load Washer', 'Energy efficient, barely used.',
   (select id from public.categories where slug = 'electronics'), 185000, 3, 'live',
   array['Washing Machine','Home Appliance','Laundry'], 40),

  ('c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'product',
   'Samsung 55 inch Smart TV', '4K, wall mount included.',
   (select id from public.categories where slug = 'electronics'), 320000, 2, 'live',
   array['Television','Smart TV','Electronics'], 90),

  ('c0000000-0000-0000-0000-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'product',
   'Blue 3-Seater Sofa', 'Fabric, deep blue.',
   (select id from public.categories where slug = 'home-furniture'), 145000, 1, 'live',
   array['Sofa','Blue Sofa','Furniture','Living Room'], 25),

  ('c0000000-0000-0000-0000-000000000004', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'product',
   'Wooden Dining Table', 'Six seater.',
   (select id from public.categories where slug = 'home-furniture'), 98000, 4, 'live',
   array['Table','Dining','Furniture'], 10),

  ('c0000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'service',
   'Plumber — home service', 'Fixes leaks and installs pipes.',
   (select id from public.categories where slug = 'home-services'), 15000, 0, 'live',
   array['Plumber','Pipe Repair','Home Service'], 5);

-- ============================================================ 1. TAGS
\echo '--- 1. tag normalisation ---'

-- Casing, padding, duplicates and empties are all cleaned by the trigger.
insert into public.listings (id, shop_id, title, price, status, tags)
values ('c0000000-0000-0000-0000-000000000010', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Tag normalisation probe', 1000, 'live',
        array['  Blue   Sofa ', 'blue sofa', '', 'SOFA']);

do $$
declare v_tags text[];
begin
  select tags into v_tags from public.listings
   where id = 'c0000000-0000-0000-0000-000000000010';
  if v_tags <> array['blue sofa','sofa'] then
    raise exception 'FAIL normalisation: got %', v_tags;
  end if;
  raise notice 'PASS normalisation -> %', v_tags;
end $$;

\echo '--- 2. 20-tag cap is enforced by the database ---'

do $$
declare v_many text[] := '{}';
        i int;
begin
  for i in 1..25 loop
    v_many := v_many || ('tag' || i);
  end loop;

  begin
    insert into public.listings (id, shop_id, title, price, status, tags)
    values ('c0000000-0000-0000-0000-000000000011', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'Too many tags', 1000, 'live', v_many);
    raise exception 'FAIL: 25 tags were accepted';
  exception when check_violation then
    raise notice 'PASS 25 tags rejected by listings_tags_max';
  end;
end $$;

-- Exactly 20 must be accepted.
do $$
declare v_many text[] := '{}';
        i int;
begin
  for i in 1..20 loop
    v_many := v_many || ('tag' || i);
  end loop;
  insert into public.listings (id, shop_id, title, price, status, tags)
  values ('c0000000-0000-0000-0000-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'Exactly twenty', 1000, 'live', v_many);
  raise notice 'PASS 20 tags accepted';
end $$;

-- ============================================================ 2. SEARCH
\echo '--- 3. "washing machine" finds the Washer (the reported bug) ---'

do $$
declare v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.search_listing_ids(p_q => 'washing machine');
  if not ('c0000000-0000-0000-0000-000000000001' = any (v_ids)) then
    raise exception 'FAIL: washing machine did not find the washer. got %', v_ids;
  end if;
  raise notice 'PASS washing machine -> % result(s)', coalesce(array_length(v_ids,1),0);
end $$;

\echo '--- 4. partial word still matches (prefix query) ---'

do $$
declare v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.search_listing_ids(p_q => 'wash');
  if not ('c0000000-0000-0000-0000-000000000001' = any (v_ids)) then
    raise exception 'FAIL: "wash" did not match. got %', v_ids;
  end if;
  raise notice 'PASS wash -> % result(s)', coalesce(array_length(v_ids,1),0);
end $$;

\echo '--- 5. multi-word tag search: "blue sofa" ---'

do $$
declare v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.search_listing_ids(p_q => 'blue sofa');
  if not ('c0000000-0000-0000-0000-000000000003' = any (v_ids)) then
    raise exception 'FAIL: blue sofa did not match. got %', v_ids;
  end if;
  raise notice 'PASS blue sofa -> % result(s)', coalesce(array_length(v_ids,1),0);
end $$;

\echo '--- 6. nonsense query returns nothing, not everything ---'

do $$
declare v_n int;
begin
  select count(*) into v_n from public.search_listing_ids(p_q => 'zzzznotathing');
  if v_n <> 0 then
    raise exception 'FAIL: nonsense query returned % rows', v_n;
  end if;
  raise notice 'PASS nonsense query -> 0';
end $$;

-- ============================================================ 3. CATEGORY
\echo '--- 7. category filter returns ONLY that category (the reported bug) ---'

do $$
declare v_ids uuid[];
        v_n int;
begin
  select array_agg(id), count(*) into v_ids, v_n
    from public.search_listing_ids(p_category => 'home-furniture');

  if v_n <> 2 then
    raise exception 'FAIL: home-furniture returned % rows, expected 2: %', v_n, v_ids;
  end if;
  if 'c0000000-0000-0000-0000-000000000001' = any (v_ids) then
    raise exception 'FAIL: an electronics listing leaked into home-furniture';
  end if;
  raise notice 'PASS home-furniture -> % rows, no leakage', v_n;
end $$;

\echo '--- 8. electronics returns only electronics ---'

do $$
declare v_n int;
begin
  select count(*) into v_n from public.search_listing_ids(p_category => 'electronics');
  if v_n <> 2 then
    raise exception 'FAIL: electronics returned % rows, expected 2', v_n;
  end if;
  raise notice 'PASS electronics -> % rows', v_n;
end $$;

\echo '--- 9. unknown category returns nothing, not everything ---'

do $$
declare v_n int;
begin
  select count(*) into v_n from public.search_listing_ids(p_category => 'no-such-category');
  if v_n <> 0 then
    raise exception 'FAIL: unknown category returned % rows', v_n;
  end if;
  raise notice 'PASS unknown category -> 0';
end $$;

\echo '--- 10. category + query compose ---'

do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.search_listing_ids(p_category => 'home-furniture', p_q => 'sofa');
  if v_n <> 1 then
    raise exception 'FAIL: home-furniture + sofa returned % rows, expected 1', v_n;
  end if;
  raise notice 'PASS home-furniture + sofa -> 1';
end $$;

\echo '--- 11. city filter ---'

do $$
declare v_n int;
begin
  select count(*) into v_n from public.search_listing_ids(p_city => 'Abeokuta');
  if v_n <> 2 then
    raise exception 'FAIL: Abeokuta returned % rows, expected 2', v_n;
  end if;
  raise notice 'PASS Abeokuta -> % rows', v_n;
end $$;

\echo '--- 12. type filter separates services from goods ---'

do $$
declare v_n int;
begin
  select count(*) into v_n from public.search_listing_ids(p_type => 'service');
  if v_n <> 1 then
    raise exception 'FAIL: service filter returned % rows, expected 1', v_n;
  end if;
  raise notice 'PASS service -> % rows', v_n;
end $$;

-- ============================================================ 4. RANKING
\echo '--- 13. relevance outranks recency ---'

do $$
declare v_first uuid;
begin
  -- The TV has more views but the washer is the exact tag match for the
  -- query; relevance must win.
  select id into v_first from public.search_listing_ids(p_q => 'washing machine') limit 1;
  if v_first <> 'c0000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: relevance did not rank the washer first, got %', v_first;
  end if;
  raise notice 'PASS relevance ranked the washer first';
end $$;

\echo '--- 14. price sort is honoured ---'

do $$
declare v_prices numeric[];
        v_sorted numeric[];
begin
  select array_agg(l.price order by o.ord) into v_prices
    from public.search_listing_ids(p_sort => 'price_asc') with ordinality as o(id, rank_score, ord)
    join public.listings l on l.id = o.id;

  select array_agg(p order by p) into v_sorted from unnest(v_prices) p;

  if v_prices <> v_sorted then
    raise exception 'FAIL: price_asc not monotonic: %', v_prices;
  end if;
  raise notice 'PASS price_asc -> % prices ascending', array_length(v_prices, 1);
end $$;

\echo '--- 15. sales boost: a sold listing outranks an unsold peer ---'

insert into public.orders (id, shop_id, status, total) values
  ('d0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'completed', 98000);

insert into public.order_items (order_id, listing_id, title, unit_price, quantity, line_total) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004',
   'Wooden Dining Table', 98000, 5, 490000);

do $$
declare v_sold int;
begin
  select units_sold into v_sold from public.listing_sales
   where listing_id = 'c0000000-0000-0000-0000-000000000004';
  if v_sold <> 5 then
    raise exception 'FAIL: units_sold was %, expected 5', v_sold;
  end if;
  raise notice 'PASS listing_sales counted % units', v_sold;
end $$;

\echo '--- 16. cancelled orders do NOT count as sales ---'

insert into public.orders (id, shop_id, status, total) values
  ('d0000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cancelled', 1000);
insert into public.order_items (order_id, listing_id, title, unit_price, quantity, line_total) values
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'Wooden Dining Table', 1000, 99, 99000);

do $$
declare v_sold int;
begin
  select units_sold into v_sold from public.listing_sales
   where listing_id = 'c0000000-0000-0000-0000-000000000004';
  if v_sold <> 5 then
    raise exception 'FAIL: cancelled order inflated sales to %', v_sold;
  end if;
  raise notice 'PASS cancelled order ignored, still %', v_sold;
end $$;

-- ============================================================ 5. ROTATION
\echo '--- 17. storefront feed returns a balanced mix ---'

do $$
declare v_buckets text[];
begin
  select array_agg(distinct bucket) into v_buckets
    from public.storefront_feed(p_limit => 8);
  raise notice 'PASS feed buckets present: %', v_buckets;
  if coalesce(array_length(v_buckets,1),0) < 2 then
    raise exception 'FAIL: feed used only % bucket(s)', v_buckets;
  end if;
end $$;

\echo '--- 18. feed never repeats a listing ---'

do $$
declare v_total int;
        v_distinct int;
begin
  select count(*), count(distinct id) into v_total, v_distinct
    from public.storefront_feed(p_limit => 8);
  if v_total <> v_distinct then
    raise exception 'FAIL: feed returned % rows but only % distinct', v_total, v_distinct;
  end if;
  raise notice 'PASS feed has no duplicates (% rows)', v_total;
end $$;

\echo '--- 19. rotation: a different seed changes the order ---'

do $$
declare v_a uuid[];
        v_b uuid[];
begin
  select array_agg(id) into v_a from public.storefront_feed(p_limit => 5, p_seed => '2026-11-11');
  select array_agg(id) into v_b from public.storefront_feed(p_limit => 5, p_seed => '2026-11-12');

  if v_a = v_b then
    raise exception 'FAIL: tomorrow''s feed is identical to today''s';
  end if;
  raise notice 'PASS seed rotation changes the order';
end $$;

\echo '--- 20. same seed is stable within a day ---'

do $$
declare v_a uuid[];
        v_b uuid[];
begin
  select array_agg(id) into v_a from public.storefront_feed(p_limit => 5, p_seed => '2026-11-11');
  select array_agg(id) into v_b from public.storefront_feed(p_limit => 5, p_seed => '2026-11-11');
  if v_a <> v_b then
    raise exception 'FAIL: same seed produced different orders';
  end if;
  raise notice 'PASS same seed is stable';
end $$;

\echo '--- 21. feed respects city and type ---'

do $$
declare v_n int;
begin
  select count(*) into v_n from public.storefront_feed(p_city => 'Abeokuta', p_limit => 8);
  if v_n <> 2 then
    raise exception 'FAIL: Abeokuta feed returned % rows, expected 2', v_n;
  end if;
  raise notice 'PASS Abeokuta feed -> % rows', v_n;
end $$;

\echo '--- 22. hidden / non-approved shops never surface ---'

update public.shops set status = 'suspended' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

do $$
declare v_n int;
begin
  select count(*) into v_n from public.search_listing_ids(p_city => 'Abeokuta');
  if v_n <> 0 then
    raise exception 'FAIL: suspended shop listings still searchable (% rows)', v_n;
  end if;
  select count(*) into v_n from public.storefront_feed(p_city => 'Abeokuta');
  if v_n <> 0 then
    raise exception 'FAIL: suspended shop listings still in feed (% rows)', v_n;
  end if;
  raise notice 'PASS suspended shop is invisible in search and feed';
end $$;

\echo ''
\echo '=========================================='
\echo ' ALL 0015 TESTS PASSED'
\echo '=========================================='
