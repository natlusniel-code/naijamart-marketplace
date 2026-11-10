-- =====================================================================
-- NaijaMart — 0001 schema
-- Paste this file into Supabase → SQL Editor → Run.
-- No extensions beyond pgcrypto (already enabled on Supabase).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- shared helpers
-- ---------------------------------------------------------------------
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- order references: NM-XXXXXX
create or replace function public.gen_reference()
returns text language sql volatile as $$
  select 'NM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'buyer' check (role in ('buyer','seller','admin')),
  full_name   text not null default '',
  email       text,
  phone       text,
  avatar_url  text,
  state       text,
  city        text,
  is_banned   boolean not null default false,
  ban_reason  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles(role);

-- ---------------------------------------------------------------------
-- admin_users  (a row here = full admin access)
-- ---------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  icon        text not null default '📦',
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Reference data: every category the app offers. Kept here (not in the seed)
-- because a published app cannot open without them.
insert into public.categories (name, slug, icon, sort_order) values
  ('Electronics',            'electronics',          '💻', 10),
  ('Fashion',                'fashion',              '👗', 20),
  ('Home & Furniture',       'home-furniture',       '🛋️', 30),
  ('Food & Groceries',       'food-groceries',       '🥘', 40),
  ('Beauty',                 'beauty',               '💅', 50),
  ('Phones & Accessories',   'phones-accessories',   '📱', 60),
  ('Building Materials',     'building-materials',   '🧱', 70),
  ('Auto Parts',             'auto-parts',           '🚗', 80),
  ('Home Services',          'home-services',        '🔧', 90),
  ('Professional Services',  'professional-services','💼',100),
  ('Events',                 'events',               '🎉',110)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- platform settings (single row, id = 1)
-- ---------------------------------------------------------------------
create table if not exists public.platform_settings (
  id                      int primary key default 1 check (id = 1),
  commission_rate         numeric(5,4) not null default 0.05,
  subscription_price      numeric(12,2) not null default 5000,
  free_delivery_default   numeric(12,2) not null default 20000,
  default_delivery_fee    numeric(12,2) not null default 500,
  bank_name               text not null default 'SmartCash',
  bank_account_number     text not null default '9111356510',
  bank_account_name       text not null default 'Anifowose Mutiu Ayinde',
  support_whatsapp        text not null default '2348012345678',
  terms_text              text not null default 'NaijaMart holds every payment in escrow until the buyer confirms delivery. Refunds are issued if an order is not delivered.',
  updated_at              timestamptz not null default now()
);
insert into public.platform_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- shops
-- ---------------------------------------------------------------------
create table if not exists public.shops (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid references auth.users(id) on delete set null, -- null = demo/unclaimed shop
  is_demo                   boolean not null default false,
  name                      text not null,
  slug                      text not null unique,
  description               text,
  logo_url                  text,
  banner_url                text,
  category                  text,
  kind                      text not null default 'both' check (kind in ('goods','services','both')),
  state                     text,
  city                      text,
  status                    text not null default 'pending' check (status in ('pending','approved','suspended','rejected')),
  verified                  boolean not null default false,
  review_note               text,
  rating_avg                numeric(3,2) not null default 0,
  rating_count              int not null default 0,
  delivery_fee              numeric(12,2) not null default 500,
  free_delivery_threshold   numeric(12,2) not null default 20000,
  pickup_available          boolean not null default true,
  bank_name                 text,
  bank_account_number       text,
  bank_account_name         text,
  nin_or_cac                 text,
  documents                 jsonb not null default '[]'::jsonb,
  subscription_status       text not null default 'none' check (subscription_status in ('none','pending','active','expired')),
  subscription_expires_at   timestamptz,
  first_payment_deducted    boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists shops_city_idx on public.shops(city);
create index if not exists shops_owner_idx on public.shops(owner_id);
create index if not exists shops_status_idx on public.shops(status);

-- ---------------------------------------------------------------------
-- listings
-- ---------------------------------------------------------------------
create table if not exists public.listings (
  id                        uuid primary key default gen_random_uuid(),
  shop_id                   uuid not null references public.shops(id) on delete cascade,
  type                      text not null default 'product' check (type in ('product','service')),
  title                     text not null,
  description               text,
  category_id               uuid references public.categories(id) on delete set null,
  price                     numeric(12,2) not null default 0 check (price >= 0),
  stock                     int not null default 0,
  images                    jsonb not null default '[]'::jsonb,
  delivery_fee_override     numeric(12,2),
  free_delivery_threshold   numeric(12,2),
  service_area              text,
  needs_home_visit          boolean not null default false,
  status                    text not null default 'draft' check (status in ('draft','live','hidden','out_of_stock')),
  views                     int not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists listings_shop_idx on public.listings(shop_id);
create index if not exists listings_cat_idx on public.listings(category_id);
create index if not exists listings_status_idx on public.listings(status);

-- ---------------------------------------------------------------------
-- addresses
-- ---------------------------------------------------------------------
create table if not exists public.addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null default 'Home',
  line1       text not null,
  city        text,
  state       text,
  phone       text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists addresses_user_idx on public.addresses(user_id);

-- ---------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique default public.gen_reference(),
  buyer_id        uuid references auth.users(id) on delete set null,  -- null only for demo rows
  shop_id         uuid not null references public.shops(id) on delete cascade,
  is_demo         boolean not null default false,
  status          text not null default 'pending_payment'
    check (status in ('pending_payment','paid','accepted','processing','shipped','ready_for_pickup','delivered','completed','cancelled','disputed')),
  fulfilment      text not null default 'delivery' check (fulfilment in ('delivery','pickup')),
  subtotal        numeric(12,2) not null default 0,
  delivery_fee    numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  commission_rate numeric(5,4) not null default 0.05,
  commission_amount numeric(12,2) not null default 0,
  payout_amount   numeric(12,2) not null default 0,
  payout_status   text not null default 'held' check (payout_status in ('held','released','paid')),
  receipt_url     text,
  buyer_note      text,
  address         text,
  decline_reason  text,
  accepted_at     timestamptz,
  shipped_at      timestamptz,
  delivered_at    timestamptz,
  completed_at    timestamptz,
  auto_cancel_at  timestamptz,
  auto_confirm_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists orders_buyer_idx on public.orders(buyer_id);
create index if not exists orders_shop_idx on public.orders(shop_id);
create index if not exists orders_status_idx on public.orders(status);

-- ---------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------
create table if not exists public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  listing_id  uuid references public.listings(id) on delete set null,
  title       text not null,
  unit_price  numeric(12,2) not null default 0,
  quantity    int not null default 1 check (quantity > 0),
  line_total  numeric(12,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists order_items_order_idx on public.order_items(order_id);

-- ---------------------------------------------------------------------
-- enquiries (service "request a quote")
-- ---------------------------------------------------------------------
create table if not exists public.enquiries (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id) on delete cascade,
  listing_id    uuid references public.listings(id) on delete set null,
  buyer_id      uuid not null references auth.users(id) on delete cascade,
  description   text not null,
  preferred_date date,
  address       text,
  budget_min    numeric(12,2),
  budget_max    numeric(12,2),
  status        text not null default 'open' check (status in ('open','quoted','accepted','closed')),
  created_at    timestamptz not null default now()
);
create index if not exists enquiries_shop_idx on public.enquiries(shop_id);

-- ---------------------------------------------------------------------
-- chats / messages / offers
-- ---------------------------------------------------------------------
create table if not exists public.chats (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references public.orders(id) on delete cascade,
  enquiry_id  uuid references public.enquiries(id) on delete cascade,
  buyer_id    uuid not null references auth.users(id) on delete cascade,
  seller_id   uuid not null references auth.users(id) on delete cascade,
  shop_id     uuid references public.shops(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists chats_buyer_idx on public.chats(buyer_id);
create index if not exists chats_seller_idx on public.chats(seller_id);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats(id) on delete cascade,
  sender_id   uuid not null references auth.users(id) on delete cascade,
  body        text,
  image_url   text,
  created_at  timestamptz not null default now()
);
create index if not exists messages_chat_idx on public.messages(chat_id, created_at);

create table if not exists public.offers (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats(id) on delete cascade,
  seller_id   uuid not null references auth.users(id) on delete cascade,
  buyer_id    uuid not null references auth.users(id) on delete cascade,
  price       numeric(12,2) not null,
  scope       text,
  timeline    text,
  status      text not null default 'pending' check (status in ('pending','accepted','declined')),
  order_id    uuid references public.orders(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists offers_chat_idx on public.offers(chat_id);

-- ---------------------------------------------------------------------
-- payments (order receipts, seller subscriptions)
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references public.orders(id) on delete cascade,
  shop_id       uuid references public.shops(id) on delete cascade,
  type          text not null check (type in ('order','subscription')),
  amount        numeric(12,2) not null,
  reference     text not null,
  receipt_url   text,
  status        text not null default 'pending' check (status in ('pending','verified','rejected')),
  reject_reason text,
  verified_by   uuid references auth.users(id) on delete set null,
  verified_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists payments_status_idx on public.payments(status);
create index if not exists payments_order_idx on public.payments(order_id);
create index if not exists payments_shop_idx on public.payments(shop_id);

-- ---------------------------------------------------------------------
-- payouts
-- ---------------------------------------------------------------------
create table if not exists public.payouts (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete set null,
  amount        numeric(12,2) not null,
  gross_amount  numeric(12,2),
  commission_amount numeric(12,2),
  kind          text not null default 'order' check (kind in ('order','manual')),
  status        text not null default 'queued' check (status in ('queued','paid')),
  available_at  timestamptz default now(),
  requested_at  timestamptz,
  paid_at       timestamptz,
  reference     text,
  created_at    timestamptz not null default now()
);
create index if not exists payouts_shop_idx on public.payouts(shop_id);
create index if not exists payouts_status_idx on public.payouts(status);

-- ---------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------
create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references public.orders(id) on delete set null,
  buyer_id      uuid not null references auth.users(id) on delete cascade,
  shop_id       uuid not null references public.shops(id) on delete cascade,
  rating        int not null check (rating between 1 and 5),
  body          text,
  images        jsonb not null default '[]'::jsonb,
  seller_reply  text,
  flagged       boolean not null default false,
  status        text not null default 'published' check (status in ('published','hidden')),
  created_at    timestamptz not null default now()
);
create index if not exists reviews_shop_idx on public.reviews(shop_id);

-- ---------------------------------------------------------------------
-- disputes
-- ---------------------------------------------------------------------
create table if not exists public.disputes (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  raised_by       uuid not null references auth.users(id) on delete cascade,
  reason          text not null,
  status          text not null default 'open' check (status in ('open','resolved_buyer','resolved_seller')),
  resolution_note text,
  resolved_by     uuid references auth.users(id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists disputes_status_idx on public.disputes(status);

-- ---------------------------------------------------------------------
-- seller_scores
-- ---------------------------------------------------------------------
create table if not exists public.seller_scores (
  shop_id             uuid primary key references public.shops(id) on delete cascade,
  response_time_score numeric(6,2) not null default 0,
  completion_rate     numeric(6,2) not null default 0,
  rating_score        numeric(6,2) not null default 0,
  on_time_score       numeric(6,2) not null default 0,
  activity_score      numeric(6,2) not null default 0,
  total_score         numeric(6,2) not null default 0,
  new_seller_boost_until timestamptz,
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- shop_followers
-- ---------------------------------------------------------------------
create table if not exists public.shop_followers (
  shop_id    uuid not null references public.shops(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
drop trigger if exists t_profiles on public.profiles;
create trigger t_profiles before update on public.profiles
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists t_shops on public.shops;
create trigger t_shops before update on public.shops
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists t_listings on public.listings;
create trigger t_listings before update on public.listings
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists t_orders on public.orders;
create trigger t_orders before update on public.orders
  for each row execute function public.tg_touch_updated_at();

-- ---------------------------------------------------------------------
-- new auth user → profile row
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, phone, state, city, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email,''), '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'state',
    new.raw_user_meta_data->>'city',
    coalesce(new.raw_user_meta_data->>'role', 'buyer')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- shop rating rollup
-- ---------------------------------------------------------------------
create or replace function public.tg_refresh_shop_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  sid := coalesce(new.shop_id, old.shop_id);
  update public.shops s set
    rating_avg = coalesce((select round(avg(r.rating)::numeric, 2) from public.reviews r
                            where r.shop_id = sid and r.status = 'published'), 0),
    rating_count = coalesce((select count(*) from public.reviews r
                              where r.shop_id = sid and r.status = 'published'), 0)
  where s.id = sid;
  return null;
end $$;

drop trigger if exists t_review_rating on public.reviews;
create trigger t_review_rating after insert or update or delete on public.reviews
  for each row execute function public.tg_refresh_shop_rating();
