-- ---------------------------------------------------------------------
-- 0008 — let the service role through the shops guard
--
-- Bug: "Approve seller" did nothing.
--
-- `tg_shops_guard` (0002_rls.sql) reverts status / verified / review_note
-- whenever `public.is_admin()` is false. `is_admin()` is
-- `exists (select 1 from admin_users where user_id = auth.uid())`.
--
-- The admin console now writes through the service-role key, and a
-- service-role request carries no end-user JWT, so `auth.uid()` is NULL and
-- `is_admin()` is false. The trigger therefore silently rewrote every admin
-- write back to its old value: PostgREST returned HTTP 200 with the *old*
-- row, the Server Action saw no error, and the UI refreshed to an unchanged
-- page. Nothing was logged anywhere.
--
-- The guard's intent is "a seller must not approve themselves". The service
-- role is not a seller — it is the trusted server credential, and it already
-- bypasses RLS entirely. So it must bypass this trigger too, otherwise the
-- trigger is stricter than RLS and the admin console cannot work at all.
--
-- `auth.role()` reads the `role` claim of the request JWT, which is
-- 'service_role' for the service key and 'authenticated' / 'anon' otherwise.
-- Checking it keeps the seller-facing protection fully intact: a seller
-- calling the REST API with their own token still cannot touch these columns.
-- ---------------------------------------------------------------------

create or replace function public.tg_shops_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Trusted server credential: RLS is already bypassed, so honour the write.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    new.status      := old.status;
    new.verified    := old.verified;
    new.review_note := old.review_note;
    new.rating_avg  := old.rating_avg;
    new.rating_count := old.rating_count;
    new.subscription_status := old.subscription_status;
    new.subscription_expires_at := old.subscription_expires_at;
    new.first_payment_deducted := old.first_payment_deducted;
  end if;
  return new;
end $$;

-- Same reasoning for profiles: the admin console bans buyers and edits
-- profile state through the service role, and `tg_profiles_guard` has the
-- identical `is_admin()` shape.
create or replace function public.tg_profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    new.role       := old.role;
    new.is_banned  := old.is_banned;
    new.ban_reason := old.ban_reason;
  end if;
  return new;
end $$;
