-- =====================================================================
-- NaijaMart — demo seed (safe to re-run)
--
-- Shops and listings are inserted with owner_id = null and is_demo = true
-- so they exist without any auth user. Claim one by running:
--   update shops set owner_id = '<your-user-id>', is_demo = false where slug = 'techhub-abeokuta';
--
-- The sample order / chat / payment below reference the demo shop only.
-- For a fully working escrow demo, sign up as a buyer first, then set
-- buyer_id at the bottom of this file.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Categories live in 0001_schema (reference data). Demo shops:
-- ---------------------------------------------------------------------

insert into public.shops (name, slug, description, category, kind, state, city, status, verified,
                          rating_avg, rating_count, delivery_fee, free_delivery_threshold, pickup_available,
                          subscription_status, subscription_expires_at, is_demo, logo_url)
values
  ('TechHub Abeokuta', 'techhub-abeokuta',
   'Genuine phones, accessories and repairs. Same-day pickup in Kuto, delivery across Abeokuta South.',
   'Electronics vendors', 'both', 'Ogun', 'Abeokuta South', 'approved', true,
   4.8, 37, 500, 20000, true, 'active', now() + interval '23 days', true,
   'https://images.unsplash.com/photo-1556656793-08538906a9f8?w=200&q=70'),

  ('Kuto Fabrics', 'kuto-fabrics',
   'Ankara, aso-oke and lace by the yard. Tailoring referrals available.',
   'Fashion', 'goods', 'Ogun', 'Abeokuta South', 'approved', true,
   4.6, 21, 500, 15000, true, 'active', now() + interval '11 days', true,
   'https://images.unsplash.com/photo-1528825871115-3581a5387919?w=200&q=70'),

  ('Emeka Plumbing Services', 'emeka-plumbing-services',
   'Leak repairs, tank installation and pipe work. 12 years in Abeokuta.',
   'Home Services', 'services', 'Ogun', 'Abeokuta South', 'approved', true,
   4.7, 14, 0, 0, false, 'active', now() + interval '18 days', true,
   'https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=200&q=70'),

  ('Mama Nkechi Foods', 'mama-nkechi-foods',
   'Fresh pepper, palm oil, garri and local spices. Delivered the same day.',
   'Food & Groceries', 'goods', 'Ogun', 'Abeokuta North', 'approved', false,
   4.4, 9, 700, 10000, false, 'active', now() + interval '5 days', true,
   'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=200&q=70')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- Listings
-- ---------------------------------------------------------------------
insert into public.listings (shop_id, type, title, description, category_id, price, stock, images,
                             status, delivery_fee_override, free_delivery_threshold, service_area, needs_home_visit)
select s.id, 'product', 'Wireless Earbuds Pro',
       'Bluetooth 5.3, 30-hour case, noise cancelling. Sealed pack with 6-month warranty.',
       c.id, 8000, 12,
       to_jsonb(array['https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&q=70',
             'https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?w=800&q=70']),
       'live', null, null, null, false
from public.shops s, public.categories c
where s.slug = 'techhub-abeokuta' and c.slug = 'electronics'
  and not exists (select 1 from public.listings l where l.shop_id = s.id and l.title = 'Wireless Earbuds Pro');

insert into public.listings (shop_id, type, title, description, category_id, price, stock, images, status)
select s.id, 'product', 'Phone Case (clear)',
       'Shock-absorbing clear case for iPhone 12–15 and common Android sizes.',
       c.id, 2000, 4,
       to_jsonb(array['https://images.unsplash.com/photo-1601593346740-925612772716?w=800&q=70']), 'live'
from public.shops s, public.categories c
where s.slug = 'techhub-abeokuta' and c.slug = 'phones-accessories'
  and not exists (select 1 from public.listings l where l.shop_id = s.id and l.title = 'Phone Case (clear)');

insert into public.listings (shop_id, type, title, description, category_id, price, stock, images, status)
select s.id, 'product', 'Ankara Material (6 yards)',
       'Wax print cotton, 6 yards. Colours may vary slightly from the photo.',
       c.id, 4000, 30,
       to_jsonb(array['https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=800&q=70']), 'live'
from public.shops s, public.categories c
where s.slug = 'kuto-fabrics' and c.slug = 'fashion'
  and not exists (select 1 from public.listings l where l.shop_id = s.id and l.title like 'Ankara Material%');

insert into public.listings (shop_id, type, title, description, category_id, price, stock, images, status)
select s.id, 'product', 'Aso-oke Head Tie',
       'Handwoven gele, indigo and gold. One size.',
       c.id, 6500, 8,
       to_jsonb(array['https://images.unsplash.com/photo-1594736797933-d0501ba2fe65?w=800&q=70']), 'live'
from public.shops s, public.categories c
where s.slug = 'kuto-fabrics' and c.slug = 'fashion'
  and not exists (select 1 from public.listings l where l.shop_id = s.id and l.title = 'Aso-oke Head Tie');

insert into public.listings (shop_id, type, title, description, category_id, price, stock, images,
                             status, service_area, needs_home_visit)
select s.id, 'service', 'Plumber — Home Service',
       'Leak repair, pipe replacement and tank installation. Diagnosis included; parts priced separately.',
       c.id, 15000, 0,
       to_jsonb(array['https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=800&q=70']),
       'live', 'Abeokuta South and Abeokuta North', true
from public.shops s, public.categories c
where s.slug = 'emeka-plumbing-services' and c.slug = 'home-services'
  and not exists (select 1 from public.listings l where l.shop_id = s.id and l.title = 'Plumber — Home Service');

insert into public.listings (shop_id, type, title, description, category_id, price, stock, images, status)
select s.id, 'product', 'Palm Oil (5 litres)',
       'Freshly pressed, no additives. Bring your own keg or add ₦500 for one.',
       c.id, 9500, 15,
       to_jsonb(array['https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&q=70']), 'live'
from public.shops s, public.categories c
where s.slug = 'mama-nkechi-foods' and c.slug = 'food-groceries'
  and not exists (select 1 from public.listings l where l.shop_id = s.id and l.title like 'Palm Oil%');

-- ---------------------------------------------------------------------
-- Seller scores (collected from day one; ranking stays simple)
-- ---------------------------------------------------------------------
insert into public.seller_scores (shop_id, response_time_score, completion_rate, rating_score, on_time_score, activity_score)
select s.id, 80, 95, (s.rating_avg / 5 * 100)::int, 90, 70
from public.shops s
where s.is_demo
on conflict (shop_id) do nothing;

-- ---------------------------------------------------------------------
-- Sample order + chat, so no page is empty on a fresh install.
-- NOTE: buyer_id must be a real auth user. Until you claim this demo
-- order, it belongs to the demo shop only and stays invisible to buyers
-- (RLS). See README → "Making the demo order yours".
-- ---------------------------------------------------------------------
do $$
declare
  v_shop uuid;
  v_order uuid;
  v_listing uuid;
  v_chat uuid;
begin
  select id into v_shop from public.shops where slug = 'techhub-abeokuta';
  if v_shop is null then return; end if;

  if not exists (select 1 from public.orders where reference = 'NM-8F3K2A') then
    select id into v_listing from public.listings where shop_id = v_shop and title = 'Wireless Earbuds Pro';

    insert into public.orders (buyer_id, shop_id, reference, status, fulfilment, subtotal, delivery_fee, total,
                               commission_rate, commission_amount, payout_amount, payout_status, address, is_demo)
    values (null, v_shop, 'NM-8F3K2A', 'paid', 'delivery', 10000, 500, 10500,
            0.05, 525, 9975, 'held', '12 Kuto Road, Abeokuta South', true)
    returning id into v_order;

    insert into public.order_items (order_id, listing_id, title, unit_price, quantity, line_total)
    values (v_order, v_listing, 'Wireless Earbuds Pro', 8000, 1, 8000),
           (v_order, null, 'Phone Case (clear)', 2000, 1, 2000);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Admin bootstrap: add your own account after signing up.
--   insert into admin_users (user_id, email)
--   select id, email from auth.users where email = 'you@example.com';
-- ---------------------------------------------------------------------
