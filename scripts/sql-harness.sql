-- Minimal Supabase-shaped harness so sql/0013 can be executed for real.
-- Only the objects 0013 touches are stubbed; everything else is the real
-- Postgres behaviour we want to test (generated columns, triggers, RLS).

create schema if not exists auth;
create schema if not exists public;

-- Supabase ships these roles; the migrations grant to them.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Supabase's auth.uid() reads a GUC. Stub it the same way.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'buyer',
  full_name text not null default '',
  is_banned boolean not null default false
);

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null default 'Shop',
  status text not null default 'approved'
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  type text not null default 'product',
  title text not null,
  price numeric(12,2) not null default 0,
  stock int not null default 0,
  images text[] not null default '{}',
  status text not null default 'live'
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('NM' || substr(md5(random()::text), 1, 8)),
  buyer_id uuid references auth.users(id) on delete set null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  status text not null default 'pending_payment',
  total numeric(12,2) not null default 0,
  decline_reason text,
  created_at timestamptz not null default now()
);

-- 0013 publishes notifications to supabase_realtime; create the publication
-- so that block is exercised rather than skipped.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
