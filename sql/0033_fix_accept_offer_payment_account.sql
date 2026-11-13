-- ---------------------------------------------------------------------
-- 0033 — fix: "Accept offer" failed with `column a.created_at does not exist`
--
-- WHAT WAS BROKEN
-- ---------------
-- sql/0031 redeclared `accept_offer` and, while adding the chat→order link,
-- replaced the canonical account lookup
--
--     v_acct := public.my_payment_account();
--
-- with a hand-rolled join:
--
--     select pa.* into v_acct
--       from public.payment_account_assignments a
--       join public.payment_accounts pa on pa.id = a.account_id
--      where a.buyer_id = auth.uid() and a.order_id is null
--      order by a.created_at desc
--      limit 1;
--
-- `payment_account_assignments` (sql/0011) has no `created_at` column — its
-- timestamp is `assigned_at`. Postgres therefore raised 42703 on the ORDER BY
-- before the function could create the order, so every "Accept offer" click
-- failed and no order was ever written.
--
-- THE FIX
-- -------
-- Restore `public.my_payment_account()`, which is what `place_order` uses and
-- what the 0028 body of this same function used. It already does the right
-- thing: it prefers a live reservation (`expires_at > now()`) ordered by
-- `assigned_at desc`, and otherwise assigns a fresh account — so checkout and
-- offer acceptance agree on the account the buyer was told to pay into.
--
-- Everything else in the 0031 body is kept byte-for-byte, including the
-- chat→order link that 0031 introduced.
-- ---------------------------------------------------------------------
create or replace function public.accept_offer(p_offer_id uuid)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_offer    public.offers;
  v_shop     uuid;
  v_cfg      public.platform_settings;
  v_acct     public.payment_accounts;
  v_order    public.orders;
  v_promised timestamptz;
begin
  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then raise exception 'Offer not found.'; end if;
  if v_offer.status <> 'pending' then raise exception 'That offer is no longer open.'; end if;

  -- Only the buyer in this conversation may accept.
  if not exists (
    select 1 from public.chats c
     where c.id = v_offer.chat_id and c.buyer_id = auth.uid()
  ) then
    raise exception 'This is not your offer to accept.';
  end if;

  select c.shop_id into v_shop from public.chats c where c.id = v_offer.chat_id;
  if v_shop is null then raise exception 'This conversation has no shop.'; end if;

  select * into v_cfg from public.platform_settings limit 1;

  -- THE FIX: the canonical lookup. `payment_account_assignments` has
  -- `assigned_at`, not `created_at`, and this helper also assigns an account
  -- when the buyer has no live reservation — exactly as `place_order` does.
  v_acct := public.my_payment_account();

  -- The promise the seller made when quoting. A date in the past is not a
  -- promise, so it is floored at one day from now.
  v_promised := case
    when v_offer.delivery_date is not null
      then greatest(v_offer.delivery_date::timestamptz, now() + interval '1 day')
    else null
  end;

  insert into public.orders (
    buyer_id, shop_id, status, fulfilment, subtotal, delivery_fee, total,
    commission_rate, commission_amount, payout_amount, payout_status, buyer_note,
    payment_account_id, is_service, promised_delivery_at, delivery_days
  ) values (
    auth.uid(), v_shop, 'pending_payment', 'pickup', v_offer.price, 0, v_offer.price,
    v_cfg.commission_rate, round(v_offer.price * v_cfg.commission_rate, 2),
    round(v_offer.price * (1 - v_cfg.commission_rate), 2), 'held',
    'Service: ' || coalesce(v_offer.scope, 'Quoted job'), v_acct.id,
    true, v_promised, v_offer.delivery_days
  ) returning * into v_order;

  insert into public.order_items (order_id, title, unit_price, quantity, line_total)
  values (v_order.id, 'Service — ' || coalesce(v_offer.scope, 'Quoted job'),
          v_offer.price, 1, v_offer.price);

  update public.offers set status = 'accepted', order_id = v_order.id where id = p_offer_id;
  update public.offers set status = 'declined'
   where chat_id = v_offer.chat_id and id <> p_offer_id and status = 'pending';
  update public.enquiries set status = 'accepted'
   where id = (select enquiry_id from public.chats where id = v_offer.chat_id);

  -- The thread must know which order it is about, or the seller's Deliver tab
  -- and Deliver button have nothing to act on (added in 0031).
  update public.chats set order_id = v_order.id where id = v_offer.chat_id;

  insert into public.payments (order_id, type, amount, reference, payment_account_id)
  values (v_order.id, 'order', v_order.total, v_order.reference, v_acct.id);

  update public.payment_account_assignments
     set order_id = v_order.id, expires_at = now()
   where buyer_id = auth.uid() and account_id = v_acct.id and order_id is null;

  return v_order;
end $$;

revoke all on function public.accept_offer(uuid) from public;
revoke all on function public.accept_offer(uuid) from anon;
grant execute on function public.accept_offer(uuid) to authenticated;
