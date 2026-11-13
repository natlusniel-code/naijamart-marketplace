-- 0032 — analytics actually records, and a denied receipt ends the order
--
-- Two separate bugs, both of which made the seller dashboard lie.
--
-- 1. ANALYTICS NEVER RECORDED ANYTHING.
--    `listings.views` and `listings.clicks` exist and the analytics pages read
--    them, but nothing ever wrote to them:
--      - `track_listing_click()` was defined in 0028 and never called from the
--        app, so clicks stayed at 0 forever.
--      - No view counter existed at all. The comment in 0028 said "views are
--        counted server-side when the page renders" — but no code did it.
--    A seller opening their dashboard saw 0 views / 0 clicks on a gig that had
--    been looked at dozens of times, which reads as "analytics is broken".
--
--    Fix: one RPC that counts a view, and the listing page calls it. The
--    seller's own visits are not counted — a seller refreshing their own page
--    is not demand, and counting it would inflate every number they see.
--
-- 2. A DENIED RECEIPT LEFT THE ORDER ALIVE.
--    `verifyPayment(approve: false)` set `payments.status = 'rejected'` and
--    stopped. The order stayed `pending_payment`, so the buyer's tracking page
--    still offered "upload receipt", the seller still saw a live order, and the
--    admin queue still listed it. Three views, three different stories.
--    The app now cancels the order; this migration adds the guard so a
--    cancelled order can never be paid or advanced afterwards.

-- ---------------------------------------------------------------------
-- 1. Count a view
-- ---------------------------------------------------------------------
-- Called from the listing page on every render. `p_viewer_id` is the signed-in
-- user (or null for a guest). The seller's own views are skipped.
create or replace function public.track_listing_view(
  p_listing_id uuid,
  p_viewer_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select s.owner_id into v_owner
    from public.listings l
    join public.shops s on s.id = l.shop_id
   where l.id = p_listing_id;

  -- Unknown listing: nothing to count.
  if v_owner is null then
    return;
  end if;

  -- The seller looking at their own gig is not a view.
  if p_viewer_id is not null and p_viewer_id = v_owner then
    return;
  end if;

  update public.listings
     set views = coalesce(views, 0) + 1
   where id = p_listing_id;
end $$;

grant execute on function public.track_listing_view(uuid, uuid) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 2. A cancelled order is final
-- ---------------------------------------------------------------------
-- Belt and braces: the app cancels the order when a receipt is denied, but a
-- cancelled order must also refuse to be paid or moved forward if anything
-- else tries. Without this, a stale admin tab could still verify a payment on
-- an order the buyer has already been told is dead.
create or replace function public.guard_cancelled_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'Order % is cancelled and cannot be advanced.', old.reference
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists t_guard_cancelled_order on public.orders;
create trigger t_guard_cancelled_order
  before update on public.orders
  for each row execute function public.guard_cancelled_order();

-- ---------------------------------------------------------------------
-- 3. Backfill: orders whose only payment was rejected
-- ---------------------------------------------------------------------
-- Any order still sitting in `pending_payment` with a rejected receipt is in
-- the broken state this migration fixes. Close them so the buyer's tracking
-- page stops asking for a receipt that was already refused.
update public.orders o
   set status = 'cancelled',
       decline_reason = coalesce(
         (select p.reject_reason from public.payments p
           where p.order_id = o.id and p.status = 'rejected'
           order by p.created_at desc limit 1),
         'Payment could not be verified.'
       ),
       payout_status = 'held'
 where o.status = 'pending_payment'
   and exists (
     select 1 from public.payments p
      where p.order_id = o.id and p.status = 'rejected'
   )
   and not exists (
     select 1 from public.payments p
      where p.order_id = o.id and p.status in ('pending', 'verified')
   );

notify pgrst, 'reload schema';
