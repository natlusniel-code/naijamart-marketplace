-- =====================================================================
-- 0010 — signup: safe role assignment + working email confirmation
--
-- Two production bugs, both rooted in this file's territory.
--
-- ── Bug 1: a new seller was created as a BUYER ────────────────────────
--
-- `handle_new_user()` (0001) did:
--
--     coalesce(new.raw_user_meta_data->>'role', 'buyer')
--
-- `raw_user_meta_data` is written by the CLIENT — `supabase.auth.signUp({
-- options: { data: { role } } })` puts it there verbatim. Two consequences:
--
--   a) It is an unvalidated passthrough. Anyone could POST
--      `data: { role: "admin" }` and the trigger would insert an
--      `admin_users`-adjacent `profiles.role = 'admin'` row. `is_admin()`
--      reads `admin_users`, so this was not full admin access — but it is
--      still a privilege the client must never be able to name, and any
--      future code that trusts `profiles.role` would have been owned.
--
--   b) More importantly for the reported bug, the value was only as
--      reliable as the caller. The seller signup path passes `role` in
--      metadata, but the Google/OAuth path and any retry that dropped the
--      field fell back to 'buyer'. A seller then had `profiles.role =
--      'buyer'`, no `shops` row (that is created in onboarding step 1), and
--      `postAuthDestination()` — which only looked at `shops` — sent them to
--      the storefront. That is exactly the reported symptom: "drops the user
--      straight onto the homepage as a buyer account".
--
-- Fix: whitelist the value. Only 'buyer' and 'seller' may be self-assigned;
-- anything else (including 'admin', NULL, or junk) becomes 'buyer'. Admin is
-- granted only through `admin_users` / `claim_first_admin()`, never by a
-- signup payload.
--
-- ── Bug 2: `tg_profiles_guard` blocked the seller role write ──────────
--
-- The guard (0002, re-issued in 0008) reverts `new.role := old.role` for any
-- non-admin. That is right for protecting `admin` and for stopping a ban
-- from being cleared, but it also silently reverted the legitimate
-- buyer → seller upgrade that `/auth/callback` performs for an OAuth seller
-- signup. The update returned HTTP 200 with the OLD row, so the app believed
-- it had promoted the user when it had not.
--
-- Fix: allow a user to move themselves between 'buyer' and 'seller' (both are
-- ordinary, self-service states — "you can always add a shop later" is
-- literally the copy on the role picker). Everything else stays locked:
-- 'admin' can never be self-assigned, and an existing admin can never be
-- demoted by a non-admin.
--
-- ── Email confirmation ────────────────────────────────────────────────
--
-- No SQL is involved in sending mail; this section documents the config that
-- this migration assumes, because the two are deployed together.
--
-- The project's custom SMTP pointed at `smtp.resend.com` with a Resend API
-- key that is dead — verified two ways:
--
--   SMTP  smtp.resend.com:465  → 535 Authentication credentials invalid
--   API   GET api.resend.com/domains → 400 {"message":"API key is invalid"}
--
-- With `mailer_autoconfirm = false`, Supabase tried to send the confirmation
-- inside `auth.signUp`, the send failed, and the whole request 500'd with
-- "Error sending confirmation email" — creating no user at all. The previous
-- commit worked around it by turning `mailer_autoconfirm` ON, which silently
-- disabled verification for everyone.
--
-- The dead SMTP block has been removed, so Supabase falls back to its own
-- built-in mailer, which is healthy: a signup now logs
-- `{"event":"mail.send","mail_type":"confirmation"}` and returns 200 with the
-- user created and `email_confirmed_at` NULL. `mailer_autoconfirm` is back to
-- false, so confirmation is genuinely required again.
--
-- To move to a real transactional provider later, set a VALID key in
-- Supabase → Authentication → Emails → SMTP Settings and send a test before
-- flipping anything. Do not re-enable a custom SMTP host without a passing
-- test — that is what broke signup in the first place.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. handle_new_user: whitelist the self-assignable role
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requested_role text;
begin
  -- Only 'buyer' and 'seller' may come from the client. Anything else —
  -- 'admin', NULL, an empty string, a typo — is a buyer. Admin is granted
  -- exclusively through public.admin_users / claim_first_admin().
  requested_role := lower(coalesce(new.raw_user_meta_data->>'role', ''));
  if requested_role not in ('buyer', 'seller') then
    requested_role := 'buyer';
  end if;

  insert into public.profiles (id, email, full_name, avatar_url, phone, state, city, role)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'state',
    new.raw_user_meta_data->>'city',
    requested_role
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- The trigger itself is unchanged; re-created so this file is idempotent and
-- can be pasted on its own.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. tg_profiles_guard: allow buyer <-> seller, never admin
-- ---------------------------------------------------------------------
create or replace function public.tg_profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Trusted server credential (admin console, service actions): RLS is
  -- already bypassed, so honour the write.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    -- A user may move themselves between the two ordinary roles. This is the
    -- buyer → seller upgrade that /auth/callback performs for an OAuth
    -- seller signup, and it must not be silently reverted.
    if new.role is distinct from old.role then
      if old.role in ('buyer', 'seller') and new.role in ('buyer', 'seller') then
        -- allowed
        null;
      else
        new.role := old.role;
      end if;
    end if;

    -- Bans are admin-only, always.
    new.is_banned  := old.is_banned;
    new.ban_reason := old.ban_reason;
  end if;
  return new;
end $$;

drop trigger if exists t_profiles_guard on public.profiles;
create trigger t_profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ---------------------------------------------------------------------
-- 3. Backfill: repair sellers who were created as buyers
--
-- A seller signup wrote `role: 'seller'` into `auth.users.raw_user_meta_data`
-- but the profile could still end up 'buyer' (OAuth path, or a retry that
-- dropped the field). Any account whose metadata says seller but whose
-- profile says buyer is a mis-assigned seller — promote it. This is safe and
-- idempotent: it only ever moves buyer → seller, never touches admins, and
-- only where the user's own signup metadata asked for seller.
-- ---------------------------------------------------------------------
update public.profiles p
   set role = 'seller'
  from auth.users u
 where u.id = p.id
   and p.role = 'buyer'
   and lower(coalesce(u.raw_user_meta_data->>'role', '')) = 'seller';

-- ---------------------------------------------------------------------
-- 4. Verification (read-only; run manually to confirm)
-- ---------------------------------------------------------------------
-- select p.role, count(*)
--   from public.profiles p
--   join auth.users u on u.id = p.id
--  where lower(coalesce(u.raw_user_meta_data->>'role','')) = 'seller'
--  group by p.role;
--   → expect a single row: seller | N   (no 'buyer' row)
