-- =====================================================================
-- Supabase stub — just enough of the platform to run the real migrations.
-- =====================================================================
-- The migrations reference `auth.users`, `auth.uid()`, the `authenticated`
-- / `anon` roles and `storage`. None of that exists in a bare Postgres, so
-- this file creates the minimum that lets the real SQL run unmodified.
--
-- This is a TEST harness. It is not part of the app and is never deployed.

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

do $$ begin
  create role anon noinherit;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated noinherit;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role noinherit bypassrls;
exception when duplicate_object then null; end $$;

create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);

-- `auth.uid()` reads a session GUC, exactly like Supabase does.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

-- gen_random_uuid is built in on PG13+, but the migrations call it
-- unqualified and some also use `uuid_generate_v4`.
create extension if not exists pgcrypto;

-- Storage buckets, referenced by the avatar/listing upload code.
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default true,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);
