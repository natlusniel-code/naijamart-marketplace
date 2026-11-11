-- =====================================================================
-- Harness for 0015: stubs only what Supabase provides, then the REAL
-- 0001 schema, 0013 and 0015 run unmodified.
-- =====================================================================
\set ON_ERROR_STOP on

create schema if not exists auth;
create schema if not exists public;

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

-- `raw_user_meta_data` is read by handle_new_user() in 0001, so the stub
-- must carry it or every insert into auth.users fails.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Supabase's is_admin()/owns_shop() live in 0004; 0002 needs them to exist.
create or replace function public.is_admin() returns boolean
language sql stable as $$ select false $$;

create or replace function public.owns_shop(p_shop uuid) returns boolean
language sql stable as $$ select false $$;
