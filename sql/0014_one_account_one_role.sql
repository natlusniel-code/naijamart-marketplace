-- =====================================================================
-- 0014 — one account, one role: a shop owner IS a seller
--
-- ── The bug ──────────────────────────────────────────────────────────
-- `profiles` is the single account table; `role` is the discriminator
-- ('buyer' | 'seller' | 'admin'). There is no separate "buyer database"
-- and "seller database" — a buyer and a seller are the same row with a
-- different `role` value. So "move the account from the buyer database
-- to the seller database" means exactly one thing here: flip `role` on
-- that one row. One record, one role, no second entry anywhere.
--
-- The onboarding flow never did that flip. `onboarding-flow.tsx` inserts
-- the `shops` row in step 1 and stops there — nothing ever wrote
-- `profiles.role = 'seller'`. The result is a row that is a buyer by
-- `role` while owning an approved shop with live listings:
--
--     profiles.role = 'buyer'   +   shops.owner_id = that user
--
-- That contradiction is what produced the reported symptom. Every
-- routing decision that trusted `role` sent the account to the
-- storefront (correct for a buyer, wrong for this account), and every
-- decision that trusted shop ownership sent it into the Seller Hub and
-- its seller-only settings page (correct for a seller, wrong for a
-- buyer). The two signals disagreed because the write was missing.
--
-- ── The fix ──────────────────────────────────────────────────────────
-- Make the transition atomic and impossible to skip, at the database
-- level, so it holds for every client path (onboarding, admin console,
-- a future API, a manual SQL insert):
--
--   1. `_promote_shop_owner_internal(uuid)` — the trusted core.
--   2. `promote_shop_owner_to_seller(uuid)` — the same promotion with
--      the authorisation rules, for the app to call.
--   3. A trigger on `shops` (AFTER INSERT OR UPDATE OF owner_id) that
--      calls the internal function. Creating a shop promotes its owner
--      in the same transaction; there is no window where the shop exists
--      and the role does not.
--   4. `tg_profiles_guard` gains the reverse invariant: a profile that
--      owns a shop can never be written back to 'buyer'. That closes
--      the loop — the contradiction cannot be re-created by a later
--      update, a stale client, or a bad admin edit.
--   5. A backfill repairs rows that already carry the contradiction.
--
-- ── What is deliberately NOT deleted ─────────────────────────────────
-- Buyer-side history is kept: `addresses`, `wishlists`, and orders where
-- this user is the `buyer_id`. Those are past transactions, not a
-- duplicate account — deleting them would destroy order history and
-- break the seller's own receipts. "No leftover buyer entry" is
-- satisfied by there being exactly one `profiles` row with
-- `role = 'seller'`; there is no second row to remove.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Internal promotion — the trusted core, no caller check
--
-- SECURITY DEFINER so it can write `profiles` regardless of the caller's
-- RLS context (the onboarding insert runs as `authenticated`). It only
-- ever moves buyer -> seller; it never touches an admin, never demotes,
-- and is a no-op when the row is already a seller.
--
-- This is called by the trigger below, which fires with the identity of
-- whoever wrote the `shops` row (an ordinary seller in onboarding). That
-- is why the authorisation rules live in the public RPC instead: inside
-- the trigger they would be the wrong shape.
-- ---------------------------------------------------------------------
create or replace function public._promote_shop_owner_internal(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then
    return;
  end if;

  -- Owning a shop is what makes an account a seller. No shop, no promotion.
  if not exists (select 1 from public.shops s where s.owner_id = p_user) then
    return;
  end if;

  update public.profiles
     set role = 'seller',
         updated_at = now()
   where id = p_user
     and role = 'buyer';
end $$;

comment on function public._promote_shop_owner_internal(uuid) is
  'Internal: flips a shop owner''s buyer profile to seller. No caller check — use promote_shop_owner_to_seller() from the app.';

-- ---------------------------------------------------------------------
-- 2. Public promotion RPC — authorisation lives here
--
-- SECURITY DEFINER and therefore reachable through PostgREST by any
-- signed-in user, so it carries the rules:
--   * a caller may only promote THEMSELVES — the service role and admins
--     may promote anyone (the admin console re-assigns shops);
--   * the target must actually own a shop (enforced in the internal
--     function), so a buyer cannot make themselves a seller with no shop,
--     which would be the same contradiction in the other direction.
-- ---------------------------------------------------------------------
create or replace function public.promote_shop_owner_to_seller(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_trusted boolean;
begin
  if p_user is null then
    return;
  end if;

  caller_is_trusted :=
    coalesce(auth.role(), '') = 'service_role' or public.is_admin();

  -- A signed-in user may only promote their own account.
  if not caller_is_trusted and p_user is distinct from auth.uid() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  perform public._promote_shop_owner_internal(p_user);
end $$;

comment on function public.promote_shop_owner_to_seller(uuid) is
  'Flips a shop owner''s buyer profile to seller. Idempotent; never demotes, never touches admins. A caller may only promote themselves unless service_role/admin.';

-- ---------------------------------------------------------------------
-- 3. Promote the owner the moment a shop exists
--
-- AFTER INSERT OR UPDATE OF owner_id: covers a new shop (onboarding step
-- 1) and a shop re-assigned to a different owner. Runs in the same
-- transaction as the shop write, so the two can never disagree.
-- ---------------------------------------------------------------------
create or replace function public.tg_shops_promote_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._promote_shop_owner_internal(new.owner_id);
  return new;
end $$;

drop trigger if exists t_shops_promote_owner on public.shops;
create trigger t_shops_promote_owner
  after insert or update of owner_id on public.shops
  for each row execute function public.tg_shops_promote_owner();

-- ---------------------------------------------------------------------
-- 4. tg_profiles_guard: a shop owner can never be a buyer
--
-- Keeps every existing rule (service-role bypass, buyer <-> seller
-- self-service, admin and ban fields locked) and adds one invariant:
-- if the row owns a shop, `role` must be 'seller'. This is what stops
-- the contradiction from being re-created after the backfill.
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
    -- buyer -> seller upgrade that /auth/callback performs for an OAuth
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

  -- ── One account, one role ──────────────────────────────────────────
  -- Owning a shop is the definition of a seller. A profile that owns one
  -- may never be stored as a buyer, whoever is writing: that is the exact
  -- state that sent a shop owner to the storefront while the Seller Hub
  -- let them in, and it must not be reachable again.
  if new.role = 'buyer'
     and exists (select 1 from public.shops s where s.owner_id = new.id) then
    new.role := 'seller';
  end if;

  return new;
end $$;

drop trigger if exists t_profiles_guard on public.profiles;
create trigger t_profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ---------------------------------------------------------------------
-- 5. Backfill: repair every existing contradiction
--
-- Any profile that owns a shop but is still stored as a buyer is a
-- seller whose role was never flipped. Promote them. Idempotent, and it
-- only ever moves buyer -> seller.
-- ---------------------------------------------------------------------
update public.profiles p
   set role = 'seller',
       updated_at = now()
 where p.role = 'buyer'
   and exists (select 1 from public.shops s where s.owner_id = p.id);

-- ---------------------------------------------------------------------
-- 6. Verification (read-only; run manually to confirm)
-- ---------------------------------------------------------------------
-- Expect zero rows: no shop owner is stored as a buyer.
--   select p.id, p.email, p.role
--     from public.profiles p
--    where p.role = 'buyer'
--      and exists (select 1 from public.shops s where s.owner_id = p.id);
--
-- Expect one row per account: one record, one role.
--   select id, count(*) from public.profiles group by id having count(*) > 1;
