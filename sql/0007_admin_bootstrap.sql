-- 0007_admin_bootstrap.sql
--
-- Admin sign-up needs a way to create the FIRST admin, because `admin_users`
-- is the only source of admin truth and a brand-new project has zero rows.
--
-- `claim_first_admin()` is SECURITY DEFINER so it can insert into
-- `admin_users` (which has no INSERT policy for normal users), but it is
-- deliberately narrow:
--
--   * it only ever acts on `auth.uid()` — you cannot make someone else admin
--   * it only fires while `admin_users` is EMPTY, so it is a one-shot
--     bootstrap and cannot be used to escalate later
--   * it is idempotent — calling it again as the existing admin is a no-op
--
-- After the first admin exists, further admins must be added by an existing
-- admin (see README §5).

create or replace function public.claim_first_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_count integer;
begin
  if v_uid is null then
    return false;
  end if;

  -- Already an admin? Nothing to do.
  if exists (select 1 from public.admin_users a where a.user_id = v_uid) then
    return true;
  end if;

  -- Bootstrap only: refuse once any admin exists.
  select count(*) into v_count from public.admin_users;
  if v_count > 0 then
    return false;
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.admin_users (user_id, email)
  values (v_uid, v_email)
  on conflict (user_id) do nothing;

  return true;
end;
$$;

revoke all on function public.claim_first_admin() from public;
grant execute on function public.claim_first_admin() to authenticated;

comment on function public.claim_first_admin() is
  'One-shot bootstrap: makes the calling user an admin ONLY while admin_users is empty.';
