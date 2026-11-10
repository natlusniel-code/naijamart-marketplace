drop function if exists public.is_admin(uuid);

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_admin'
  ) then
    raise exception 'public.is_admin() is missing — run 0002_rls.sql first.';
  end if;
end $$;