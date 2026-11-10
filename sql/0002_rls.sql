-- =====================================================================
-- NaijaMart — 0002 Row Level Security
-- Run AFTER 0001_schema.sql.
--
-- Model:
--   * buyers   → their own orders, chats, payments, addresses
--   * sellers  → their own shop and everything attached to it
--   * admins   → everything (a row in public.admin_users)
--   * public   → approved shops, live listings, categories, published reviews
-- =====================================================================

-- ---------------------------------------------------------------------
-- helper functions (security definer so policies never recurse)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated, anon;

create or replace function public.owns_shop(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shops s where s.id = sid and s.owner_id = auth.uid());
$$;

create or replace function public.can_see_order(oid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o
    where o.id = oid
      and (o.buyer_id = auth.uid() or public.owns_shop(o.shop_id) or public.is_admin())
  );
$$;

create or replace function public.can_see_chat(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chats c
    where c.id = cid
      and (c.buyer_id = auth.uid() or c.seller_id = auth.uid() or public.is_admin())
  );
$$;

create or replace function public.is_chat_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chats c
    where c.id = cid and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
  );
$$;

-- readable-by-anyone projection of profiles (no email / phone)
create or replace view public.profiles_public as
  select id, full_name, avatar_url, state, city, role, created_at
  from public.profiles;
grant select on public.profiles_public to anon, authenticated;

-- ---------------------------------------------------------------------
-- enable RLS everywhere
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.admin_users     enable row level security;
alter table public.categories      enable row level security;
alter table public.platform_settings enable row level security;
alter table public.shops           enable row level security;
alter table public.listings        enable row level security;
alter table public.addresses       enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.enquiries       enable row level security;
alter table public.chats           enable row level security;
alter table public.messages        enable row level security;
alter table public.offers          enable row level security;
alter table public.payments        enable row level security;
alter table public.payouts         enable row level security;
alter table public.reviews         enable row level security;
alter table public.disputes        enable row level security;
alter table public.seller_scores   enable row level security;
alter table public.shop_followers  enable row level security;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- stop a non-admin from promoting themselves or clearing a ban
create or replace function public.tg_profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.is_banned := old.is_banned;
    new.ban_reason := old.ban_reason;
  end if;
  return new;
end $$;

drop trigger if exists t_profiles_guard on public.profiles;
create trigger t_profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ---------------------------------------------------------------------
-- admin_users  (you can only see your own row — that's the admin check)
-- ---------------------------------------------------------------------
drop policy if exists admin_users_self on public.admin_users;
create policy admin_users_self on public.admin_users for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- categories / settings
-- ---------------------------------------------------------------------
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select using (true);

drop policy if exists categories_admin on public.categories;
create policy categories_admin on public.categories for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_read on public.platform_settings;
create policy settings_read on public.platform_settings for select using (true);

drop policy if exists settings_admin on public.platform_settings;
create policy settings_admin on public.platform_settings for update
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- shops
-- ---------------------------------------------------------------------
drop policy if exists shops_select on public.shops;
create policy shops_select on public.shops for select
  using (status = 'approved' or owner_id = auth.uid() or public.is_admin());

drop policy if exists shops_insert on public.shops;
create policy shops_insert on public.shops for insert
  with check (owner_id = auth.uid() and public.is_admin() = false);

drop policy if exists shops_update on public.shops;
create policy shops_update on public.shops for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- sellers may not approve themselves, change verification, or rewrite plan state
create or replace function public.tg_shops_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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

drop trigger if exists t_shops_guard on public.shops;
create trigger t_shops_guard before update on public.shops
  for each row execute function public.tg_shops_guard();

-- ---------------------------------------------------------------------
-- listings
-- ---------------------------------------------------------------------
drop policy if exists listings_select on public.listings;
create policy listings_select on public.listings for select
  using (
    (status = 'live' and exists (select 1 from public.shops s
       where s.id = shop_id and s.status = 'approved'))
    or public.owns_shop(shop_id)
    or public.is_admin()
  );

drop policy if exists listings_write on public.listings;
create policy listings_write on public.listings for insert
  with check (public.owns_shop(shop_id));

drop policy if exists listings_update on public.listings;
create policy listings_update on public.listings for update
  using (public.owns_shop(shop_id) or public.is_admin())
  with check (public.owns_shop(shop_id) or public.is_admin());

drop policy if exists listings_delete on public.listings;
create policy listings_delete on public.listings for delete
  using (public.owns_shop(shop_id) or public.is_admin());

-- ---------------------------------------------------------------------
-- addresses
-- ---------------------------------------------------------------------
drop policy if exists addresses_all on public.addresses;
create policy addresses_all on public.addresses for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- orders / order_items
-- ---------------------------------------------------------------------
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select
  using (buyer_id = auth.uid() or public.owns_shop(shop_id) or public.is_admin());

-- writes happen through the RPCs in 0003 (place_order, confirm_delivery, …)

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select
  using (public.can_see_order(order_id));

-- ---------------------------------------------------------------------
-- enquiries
-- ---------------------------------------------------------------------
drop policy if exists enquiries_select on public.enquiries;
create policy enquiries_select on public.enquiries for select
  using (buyer_id = auth.uid() or public.owns_shop(shop_id) or public.is_admin());

-- ---------------------------------------------------------------------
-- chats / messages / offers
-- ---------------------------------------------------------------------
drop policy if exists chats_select on public.chats;
create policy chats_select on public.chats for select
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.is_admin());

drop policy if exists chats_insert on public.chats;
create policy chats_insert on public.chats for insert
  with check (buyer_id = auth.uid() or seller_id = auth.uid());

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using (public.can_see_chat(chat_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check (sender_id = auth.uid() and public.is_chat_member(chat_id));

drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers for select
  using (public.can_see_chat(chat_id));

-- ---------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (
    public.is_admin()
    or (order_id is not null and public.can_see_order(order_id))
    or (shop_id is not null and public.owns_shop(shop_id))
  );

-- buyers and sellers file receipts directly; the status stays 'pending'
-- until an admin verifies it (RPC admin_verify_payment).
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert
  with check (
    (order_id is not null and public.can_see_order(order_id))
    or (shop_id is not null and public.owns_shop(shop_id))
  );

-- ---------------------------------------------------------------------
-- payouts
-- ---------------------------------------------------------------------
drop policy if exists payouts_select on public.payouts;
create policy payouts_select on public.payouts for select
  using (public.owns_shop(shop_id) or public.is_admin());

-- ---------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select
  using (status = 'published' or buyer_id = auth.uid() or public.owns_shop(shop_id) or public.is_admin());

-- ---------------------------------------------------------------------
-- disputes
-- ---------------------------------------------------------------------
drop policy if exists disputes_select on public.disputes;
create policy disputes_select on public.disputes for select
  using (
    raised_by = auth.uid() or public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and public.owns_shop(o.shop_id))
  );

-- ---------------------------------------------------------------------
-- seller_scores (public ranking info) and follows
-- ---------------------------------------------------------------------
drop policy if exists seller_scores_read on public.seller_scores;
create policy seller_scores_read on public.seller_scores for select using (true);

drop policy if exists followers_read on public.shop_followers;
create policy followers_read on public.shop_followers for select using (true);

drop policy if exists followers_write on public.shop_followers;
create policy followers_write on public.shop_followers for insert
  with check (user_id = auth.uid());

drop policy if exists followers_delete on public.shop_followers;
create policy followers_delete on public.shop_followers for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- storage: public bucket for payment receipts & listing photos
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('naijamart', 'naijamart', true)
on conflict (id) do update set public = true;

drop policy if exists nm_storage_read on storage.objects;
create policy nm_storage_read on storage.objects for select
  using (bucket_id = 'naijamart');

drop policy if exists nm_storage_write on storage.objects;
create policy nm_storage_write on storage.objects for insert
  with check (bucket_id = 'naijamart' and auth.uid() is not null);

drop policy if exists nm_storage_update on storage.objects;
create policy nm_storage_update on storage.objects for update
  using (bucket_id = 'naijamart' and auth.uid() is not null);
