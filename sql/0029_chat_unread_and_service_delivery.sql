-- 0029 — per-chat unread counts, and delivery confined to service shops.
--
-- Two separate problems, both about the chat surface telling the truth.
--
-- 1. The chat list showed a single global unread number on the tab bar, so a
--    seller with three threads could not tell WHICH one had the new message.
--    `chat_unread_counts()` returns one row per chat with the count of the
--    other side's unread messages, which the list renders as a badge.
--
-- 2. `seller_send_delivery` accepted any order. A goods seller could open the
--    Deliver tab and hand over a "delivery" for a parcel that still had to be
--    shipped — two conflicting ways to finish one order. Delivery in chat is
--    a service-only action now, enforced here rather than only in the UI.

-- ── 1. per-chat unread ────────────────────────────────────────────────────
create or replace function public.chat_unread_counts()
returns table (chat_id uuid, unread integer)
language sql
stable
security definer
set search_path = public
as $$
  select m.chat_id, count(*)::int as unread
    from public.messages m
    join public.chats c on c.id = m.chat_id
   where m.read_at is null
     and m.sender_id <> auth.uid()
     and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
   group by m.chat_id;
$$;

grant execute on function public.chat_unread_counts() to authenticated;

-- ── 2. delivery is a service-only action ──────────────────────────────────
create or replace function public.seller_send_delivery(
  p_order_id uuid,
  p_note text default null,
  p_files jsonb default '[]'::jsonb
)
returns public.deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_del public.deliveries;
  v_chat uuid;
  v_item jsonb;
  v_kind text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.owns_shop(v_order.shop_id) then
    raise exception 'This is not your order.';
  end if;

  -- A service is performed and handed over here. A parcel is shipped and
  -- confirmed on the order page, so a delivery record for it would be a
  -- second, conflicting way to close the same order.
  select s.kind into v_kind from public.shops s where s.id = v_order.shop_id;
  if coalesce(v_kind, 'goods') <> 'services' then
    raise exception 'Deliveries are sent in chat for service orders only. Mark this order shipped instead.';
  end if;

  if v_order.status not in ('paid','accepted','processing','shipped','ready_for_pickup') then
    raise exception 'This order cannot be delivered from its current state.';
  end if;

  select c.id into v_chat from public.chats c where c.order_id = v_order.id limit 1;

  insert into public.deliveries (order_id, chat_id, seller_id, note)
  values (v_order.id, v_chat, auth.uid(), nullif(btrim(coalesce(p_note,'')),''))
  returning * into v_del;

  for v_item in select * from jsonb_array_elements(coalesce(p_files,'[]'::jsonb)) loop
    if coalesce(v_item->>'url','') = '' then continue; end if;
    insert into public.delivery_files (delivery_id, kind, url, name, size_bytes)
    values (v_del.id,
            case when v_item->>'kind' = 'link' then 'link' else 'file' end,
            v_item->>'url',
            nullif(v_item->>'name',''),
            nullif(v_item->>'size','')::bigint);
  end loop;

  update public.orders
     set status = case when status in ('paid','accepted') then 'processing' else status end
   where id = v_order.id;

  insert into public.notifications (user_id, kind, title, body, href, order_id)
  values (v_order.buyer_id, 'delivery', 'Delivery received',
    format('%s — the seller has sent your delivery. Review it and accept to release payment.', v_order.reference),
    '/chats/' || coalesce(v_chat::text,''), v_order.id);

  perform public.nm_notify_admin('Delivery submitted',
    format('%s — seller submitted a delivery.', v_order.reference),
    '/admin-fuckliving/orders', 'delivery');

  return v_del;
end $$;

grant execute on function public.seller_send_delivery(uuid, text, jsonb) to authenticated;

-- ── 3. a service order never enters the shipping states ───────────────────
-- `seller_advance_order` allowed 'shipped' and 'ready_for_pickup' on any
-- order, which is how a service ended up offering "Mark ready for pickup".
-- Those two steps are now refused for a service; its only forward move is
-- the delivery in chat.
create or replace function public.seller_advance_order(p_order_id uuid, p_next text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_order public.orders; v_kind text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.owns_shop(v_order.shop_id) then raise exception 'Not your order.'; end if;

  select s.kind into v_kind from public.shops s where s.id = v_order.shop_id;

  if p_next = 'processing' and v_order.status in ('paid','accepted') then
    update public.orders set status = 'processing',
      accepted_at = coalesce(accepted_at, now()), auto_cancel_at = null
     where id = p_order_id;

  elsif p_next = 'shipped' and v_order.status = 'processing' then
    if coalesce(v_kind,'goods') = 'services' or v_order.is_service then
      raise exception 'A service is not shipped — send the delivery in the chat instead.';
    end if;
    if v_order.fulfilment <> 'delivery' then raise exception 'This order is pickup.'; end if;
    update public.orders set status = 'shipped', shipped_at = now() where id = p_order_id;

  elsif p_next = 'ready_for_pickup' and v_order.status = 'processing' then
    if coalesce(v_kind,'goods') = 'services' or v_order.is_service then
      raise exception 'A service has nothing to collect — send the delivery in the chat instead.';
    end if;
    update public.orders set status = 'ready_for_pickup', shipped_at = now() where id = p_order_id;

  else
    raise exception 'That step is not allowed from %.', v_order.status;
  end if;
end $$;

grant execute on function public.seller_advance_order(uuid, text) to authenticated;

notify pgrst, 'reload schema';
