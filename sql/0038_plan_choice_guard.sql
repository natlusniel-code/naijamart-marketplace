-- =====================================================================
-- 0038 — let a seller choose a plan, without letting them grant it
-- =====================================================================
-- 0035 added `choose_seller_plan()`, which a seller calls to pick Basic or
-- Premium. It writes `shops.plan` and sets `subscription_status = 'pending'`
-- so an admin can confirm the transfer.
--
-- Two problems surfaced when the function was actually run:
--
--   1. `tg_shops_guard` (0008) reverts `subscription_status` for anyone who
--      is not an admin. So the seller's own call was silently undone: the
--      function returned ok, the row still said 'active', and the UI showed
--      a plan that had never been recorded. Same class of bug as 0008.
--
--   2. Worse, `plan` was NOT guarded at all. A seller could therefore set
--      `plan = 'premium'` and leave `subscription_status` at its existing
--      'active' — and `seller_has_feature` only checks that the status is
--      active and the plan includes the feature. That is free Premium for
--      anyone who can call the REST API with their own token.
--
-- The rule this migration enforces:
--
--   * A seller may move their OWN shop to a different plan, but only
--     together with `subscription_status = 'pending'`. Choosing a plan is
--     a request, not a grant.
--   * A seller may never set `subscription_status` to 'active', and may
--     never extend `subscription_expires_at`. Only an admin (or the
--     service role) can do that, after the money has actually arrived.
--   * Everything 0008 already protected stays protected.
-- =====================================================================

create or replace function public.tg_shops_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Trusted server credential: RLS is already bypassed, so honour the write.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  -- ── Not an admin, not the service role: a seller (or a stranger) ──
  new.status      := old.status;
  new.verified    := old.verified;
  new.review_note := old.review_note;
  new.rating_avg  := old.rating_avg;
  new.rating_count := old.rating_count;
  new.first_payment_deducted := old.first_payment_deducted;

  -- The one legitimate self-service transition: choosing a plan.
  --
  -- Allowed only when the row is the caller's own shop AND the write is
  -- asking for verification ('pending'). Anything else — 'active',
  -- 'expired', 'cancelled' — is reverted, so a seller cannot activate
  -- themselves.
  if old.owner_id = auth.uid()
     and new.subscription_status = 'pending'
     and new.plan is distinct from old.plan then
    -- Honour the plan change; the status is already 'pending'.
    new.subscription_expires_at := old.subscription_expires_at;
  else
    new.plan := old.plan;
    new.subscription_status := old.subscription_status;
    new.subscription_expires_at := old.subscription_expires_at;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- `choose_seller_plan` must also refuse to run for a shop that is already
-- pending, so a seller cannot spam the admin queue, and must not let a
-- seller "choose" the plan they are already on.
-- ---------------------------------------------------------------------
create or replace function public.choose_seller_plan(p_plan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop public.shops;
  v_plan public.seller_plans;
begin
  select * into v_shop from public.shops where owner_id = auth.uid() limit 1;
  if not found then raise exception 'No shop for this account.'; end if;

  select * into v_plan from public.seller_plans where id = p_plan and active;
  if not found then raise exception 'Unknown plan: %', p_plan; end if;

  if v_shop.subscription_status = 'pending' then
    raise exception 'Your plan change is already waiting for confirmation.';
  end if;

  if v_shop.plan = v_plan.id and v_shop.subscription_status = 'active' then
    raise exception 'You are already on the % plan.', v_plan.name;
  end if;

  update public.shops
     set plan = v_plan.id,
         subscription_status = 'pending',
         updated_at = now()
   where id = v_shop.id;

  return jsonb_build_object(
    'ok', true,
    'plan', v_plan.id,
    'price', v_plan.price,
    'reference', 'SUB-' || upper(substr(v_shop.id::text, 1, 6))
  );
end $$;

grant execute on function public.choose_seller_plan(text) to authenticated;

-- ---------------------------------------------------------------------
-- Admin confirmation. This is the only path that sets 'active', and it is
-- what the admin console calls once the transfer has been seen.
-- ---------------------------------------------------------------------
create or replace function public.admin_confirm_subscription(
  p_shop_id uuid,
  p_days    int default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop public.shops;
begin
  if not public.is_admin() then
    raise exception 'Admins only.';
  end if;
  if p_days is null or p_days < 1 or p_days > 366 then
    raise exception 'A subscription period must be between 1 and 366 days.';
  end if;

  select * into v_shop from public.shops where id = p_shop_id;
  if not found then raise exception 'No shop %', p_shop_id; end if;

  update public.shops
     set subscription_status     = 'active',
         subscription_expires_at = now() + make_interval(days => p_days),
         updated_at              = now()
   where id = p_shop_id;

  return jsonb_build_object(
    'ok', true,
    'shop', p_shop_id,
    'plan', v_shop.plan,
    'expires_at', now() + make_interval(days => p_days)
  );
end $$;

grant execute on function public.admin_confirm_subscription(uuid, int) to authenticated;
