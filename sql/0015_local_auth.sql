-- =====================================================================
-- 0015 — NaijaMart's own sign-in
--
-- Supabase Auth is no longer the thing that decides whether a password is
-- correct. This file adds the app's own credential store, and the app mints a
-- Supabase session only AFTER it has verified the password itself.
--
-- ── Why keep Supabase sessions at all ────────────────────────────────
-- Every table in this project is protected by Row Level Security keyed on
-- `auth.uid()`. There are ~170 `.from(...)` calls in the app that rely on it.
-- Ripping out Supabase sessions would mean rewriting all of them and
-- re-implementing RLS by hand. So the split is:
--
--   * WHO you are        → `public.account_credentials` (this file)
--   * WHAT you may read  → Supabase RLS, unchanged
--
-- The server verifies the password here, then mints a real Supabase session
-- for that user (admin generate_link → verifyOtp). RLS keeps working, and no
-- page or query had to change.
--
-- ── Why the password never reaches the browser ───────────────────────
-- Hashing happens in Postgres (`crypt`/`gen_salt` from pgcrypto, bcrypt cost
-- 10). The plaintext travels once, over TLS, from the sign-in form to a Server
-- Action. It is never stored, never logged, and never returned.
--
-- ── Why these functions are service-role only ────────────────────────
-- `nm_login` is the password oracle. If the anon key could call it, anyone
-- could brute-force passwords straight against the database, bypassing the
-- app's rate limiting. EXECUTE is therefore revoked from anon/authenticated
-- and granted only to service_role, which exists only on the server.
-- =====================================================================

-- ---------------------------------------------------------------------
-- credential store
-- ---------------------------------------------------------------------
create table if not exists public.account_credentials (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  -- Lower-cased. The unique index below is what makes "one email, one
  -- account" true at the database level, not just in the form.
  email           text not null,
  password_hash   text not null,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists account_credentials_email_key
  on public.account_credentials (lower(email));

-- RLS on, and deliberately NO policies: nothing but the service role may read
-- this table. A password hash must never be reachable with the anon key.
alter table public.account_credentials enable row level security;

drop trigger if exists account_credentials_touch on public.account_credentials;
create trigger account_credentials_touch
  before update on public.account_credentials
  for each row execute function public.tg_touch_updated_at();

-- ---------------------------------------------------------------------
-- one-time codes (signup confirmation + password reset)
--
-- The brief: a new account must not receive an email. Instead a code appears
-- on screen and the user retypes it. The code ROTATES — every failed attempt
-- issues a fresh one — and it expires.
-- ---------------------------------------------------------------------
create table if not exists public.one_time_codes (
  email       text not null,
  purpose     text not null check (purpose in ('signup', 'reset')),
  code        text not null,
  attempts    int  not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  primary key (email, purpose)
);

alter table public.one_time_codes enable row level security;

-- ---------------------------------------------------------------------
-- nm_set_password — create or replace a credential row
--
-- Also the migration path for accounts that predate this table: the first
-- time such a user signs in successfully through the old Supabase check, the
-- server calls this with the password they just proved they know, so they are
-- moved onto the new store without ever being asked to reset.
-- ---------------------------------------------------------------------
create or replace function public.nm_set_password(
  p_user_id uuid,
  p_email   text,
  p_password text
) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters.' using errcode = '22023';
  end if;

  insert into public.account_credentials (user_id, email, password_hash)
  values (p_user_id, lower(trim(p_email)), crypt(p_password, gen_salt('bf', 10)))
  on conflict (user_id) do update
    set email = excluded.email,
        password_hash = excluded.password_hash,
        failed_attempts = 0,
        locked_until = null,
        updated_at = now();
end $$;

-- ---------------------------------------------------------------------
-- nm_login — the password check
--
-- Returns a jsonb verdict rather than raising, so the caller can tell
-- "wrong password" (retry) from "no credentials yet" (migrate) from
-- "locked" (wait) without parsing error strings.
-- ---------------------------------------------------------------------
create or replace function public.nm_login(
  p_email    text,
  p_password text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_row   public.account_credentials%rowtype;
  v_role  text;
  v_banned boolean;
begin
  select * into v_row
  from public.account_credentials
  where lower(email) = lower(trim(p_email));

  if not found then
    -- No credential row. Either the email is unknown, or this is an account
    -- created before this table existed. The caller distinguishes the two by
    -- asking auth.users; here we only report the fact.
    return jsonb_build_object('ok', false, 'error', 'no_credentials');
  end if;

  -- A backfilled row (see the end of this file) has no usable hash. Report it
  -- as "no credentials yet" so the caller takes the one-time migration path
  -- instead of counting it as a wrong password.
  if v_row.password_hash = '!unmigrated' then
    return jsonb_build_object('ok', false, 'error', 'no_credentials');
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
      'ok', false, 'error', 'locked',
      'retry_after_seconds', ceil(extract(epoch from (v_row.locked_until - now())))
    );
  end if;

  if v_row.password_hash <> crypt(p_password, v_row.password_hash) then
    update public.account_credentials
       set failed_attempts = failed_attempts + 1,
           -- Eight wrong guesses locks the account for 15 minutes. Slow enough
           -- to make guessing pointless, short enough that a real user who
           -- fat-fingered it is not locked out for the day.
           locked_until = case
             when failed_attempts + 1 >= 8 then now() + interval '15 minutes'
             else locked_until
           end
     where user_id = v_row.user_id;

    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select role, is_banned into v_role, v_banned
  from public.profiles where id = v_row.user_id;

  if coalesce(v_banned, false) then
    return jsonb_build_object('ok', false, 'error', 'banned');
  end if;

  update public.account_credentials
     set failed_attempts = 0, locked_until = null, last_login_at = now()
   where user_id = v_row.user_id;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_row.user_id,
    'email', v_row.email,
    'role', coalesce(v_role, 'buyer')
  );
end $$;

-- ---------------------------------------------------------------------
-- nm_issue_code — mint a fresh 6-digit code
-- ---------------------------------------------------------------------
create or replace function public.nm_issue_code(
  p_email   text,
  p_purpose text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  -- 100000–999999, so it is always six digits and never has a leading zero
  -- that a user might drop when retyping.
  v_code := (100000 + floor(random() * 900000))::int::text;

  insert into public.one_time_codes (email, purpose, code, attempts, expires_at)
  values (lower(trim(p_email)), p_purpose, v_code, 0, now() + interval '10 minutes')
  on conflict (email, purpose) do update
    set code = excluded.code,
        attempts = 0,
        expires_at = excluded.expires_at,
        created_at = now();

  return v_code;
end $$;

-- ---------------------------------------------------------------------
-- nm_verify_code — check a retyped code
--
-- On a wrong code the code ROTATES: a new one is issued and returned, so the
-- user is always looking at a code that is currently valid. Three wrong
-- attempts burn the code entirely and the user must request a new one.
-- ---------------------------------------------------------------------
create or replace function public.nm_verify_code(
  p_email   text,
  p_code    text,
  p_purpose text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.one_time_codes%rowtype;
  v_new text;
begin
  select * into v_row
  from public.one_time_codes
  where email = lower(trim(p_email)) and purpose = p_purpose;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_code');
  end if;

  if v_row.expires_at < now() then
    delete from public.one_time_codes
     where email = v_row.email and purpose = v_row.purpose;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if v_row.attempts >= 3 then
    delete from public.one_time_codes
     where email = v_row.email and purpose = v_row.purpose;
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;

  if v_row.code <> trim(p_code) then
    v_new := (100000 + floor(random() * 900000))::int::text;
    update public.one_time_codes
       set attempts = attempts + 1,
           code = v_new,
           expires_at = now() + interval '10 minutes'
     where email = v_row.email and purpose = v_row.purpose;
    return jsonb_build_object(
      'ok', false, 'error', 'mismatch',
      'rotated_code', v_new,
      'attempts_left', 2 - v_row.attempts
    );
  end if;

  delete from public.one_time_codes
   where email = v_row.email and purpose = v_row.purpose;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- nm_email_taken — is this address already an account?
--
-- Checks BOTH stores: the credential table (new accounts) and auth.users
-- (accounts that predate it). Without the second check, someone could sign up
-- again with an existing address and end up with two auth users for one email.
-- ---------------------------------------------------------------------
create or replace function public.nm_email_taken(p_email text)
returns boolean
language sql security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.account_credentials where lower(email) = lower(trim(p_email))
  ) or exists (
    select 1 from auth.users where lower(email) = lower(trim(p_email))
  );
$$;

-- ---------------------------------------------------------------------
-- nm_phone_matches — second factor for a password reset
--
-- With no email in the loop, "reset my password" would otherwise be open to
-- anyone who knows an address. Requiring the phone number already on the
-- account means a reset needs two recorded details, not one.
-- ---------------------------------------------------------------------
create or replace function public.nm_phone_matches(p_email text, p_phone text)
returns boolean
language sql security definer set search_path = public, auth as $$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where lower(u.email) = lower(trim(p_email))
      and regexp_replace(coalesce(p.phone, ''), '\s', '', 'g')
          = regexp_replace(coalesce(p_phone, ''), '\s', '', 'g')
      and length(regexp_replace(coalesce(p.phone, ''), '\s', '', 'g')) >= 10
  );
$$;

-- ---------------------------------------------------------------------
-- nm_account_has_phone — does this account have a phone on record?
--
-- The reset flow uses this to decide whether the phone is a required field.
-- An account created before phone numbers were collected must not be locked
-- out of resetting its own password.
-- ---------------------------------------------------------------------
create or replace function public.nm_account_has_phone(p_email text)
returns boolean
language sql security definer set search_path = public, auth as $$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where lower(u.email) = lower(trim(p_email))
      and length(regexp_replace(coalesce(p.phone, ''), '\s', '', 'g')) >= 10
  );
$$;

-- ---------------------------------------------------------------------
-- privileges: service role only
-- ---------------------------------------------------------------------
revoke all on function public.nm_set_password(uuid, text, text) from public, anon, authenticated;
revoke all on function public.nm_login(text, text) from public, anon, authenticated;
revoke all on function public.nm_issue_code(text, text) from public, anon, authenticated;
revoke all on function public.nm_verify_code(text, text, text) from public, anon, authenticated;
revoke all on function public.nm_email_taken(text) from public, anon, authenticated;
revoke all on function public.nm_phone_matches(text, text) from public, anon, authenticated;
revoke all on function public.nm_account_has_phone(text) from public, anon, authenticated;

grant execute on function public.nm_set_password(uuid, text, text) to service_role;
grant execute on function public.nm_login(text, text) to service_role;
grant execute on function public.nm_issue_code(text, text) to service_role;
grant execute on function public.nm_verify_code(text, text, text) to service_role;
grant execute on function public.nm_email_taken(text) to service_role;
grant execute on function public.nm_phone_matches(text, text) to service_role;
grant execute on function public.nm_account_has_phone(text) to service_role;

-- ---------------------------------------------------------------------
-- backfill: give every existing account a credential row it can be reset
-- from, without inventing a password.
--
-- We cannot read an existing Supabase password (it is a bcrypt hash we do not
-- have the plaintext for), so these rows start with a hash that matches
-- nothing. `nm_login` reports `no_credentials` for them, and the server then
-- falls back to the old Supabase check once — on success it calls
-- nm_set_password with the password the user just proved, and from then on the
-- account is on the new store. A user who never signs in again is unaffected.
-- ---------------------------------------------------------------------
insert into public.account_credentials (user_id, email, password_hash)
select u.id, lower(u.email), '!unmigrated'
from auth.users u
where u.email is not null
on conflict (user_id) do nothing;
