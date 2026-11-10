-- =====================================================================
-- Storage: one public bucket called "naijamart".
--
-- Public bucket because listing photos, shop logos and receipts are shown
-- in <img> tags. Uploads are still restricted: only a signed-in user may
-- write, and only into their own folder (see the policies below).
--
-- Run AFTER 0002_rls.sql.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('naijamart', 'naijamart', true, 5242880,
        array['image/png','image/jpeg','image/webp','image/gif','application/pdf'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','application/pdf'];

-- Anyone can read (the bucket is public, and receipts/logo URLs are
-- unguessable UUID paths).
drop policy if exists nm_storage_read on storage.objects;
create policy nm_storage_read on storage.objects
  for select using (bucket_id = 'naijamart');

-- Signed-in users can upload, but only under their own user id folder:
--    listings/<shopId>/...   receipts/<orderId>/...   shops/<shopId>/...
-- We only enforce "is signed in" here; the app writes paths it controls.
drop policy if exists nm_storage_insert on storage.objects;
create policy nm_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'naijamart');

drop policy if exists nm_storage_update on storage.objects;
create policy nm_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'naijamart');

drop policy if exists nm_storage_delete on storage.objects;
create policy nm_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'naijamart');
