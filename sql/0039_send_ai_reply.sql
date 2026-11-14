-- =====================================================================
-- 0039 — send an AI reply AS THE SELLER
-- =====================================================================
-- 0035's `handleBuyerMessage` called `send_chat_message` to deliver the
-- auto-reply. That function derives the sender from `auth.uid()`, and the
-- caller is the BUYER's browser (the buyer is the one who just typed, and
-- the seller is offline by definition). So the "seller's" auto-reply would
-- have been inserted with `sender_id = buyer` — the buyer would have been
-- talking to themselves, and the seller would never have replied at all.
--
-- This function fixes that by taking the sender explicitly, and it is
-- deliberately narrow:
--
--   * it can only send as the shop's OWNER, never as an arbitrary user;
--   * it only runs when the shop has `ai_reply_enabled`;
--   * it runs the SAME chat guard (`nm_check_message`) as a human message,
--     and records a block in `blocked_messages` exactly as
--     `send_chat_message` does;
--   * it marks the row `ai_generated = true`, so the thread can say so.
--
-- It is `security definer` and granted to `authenticated`, because the
-- buyer's session is what calls it. The authorisation is the chat
-- membership check plus the shop-owner check below — not the caller's role.
-- =====================================================================

create or replace function public.send_ai_reply(
  p_chat_id uuid,
  p_body    text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_chat     public.chats;
  v_shop     public.shops;
  v_rule     record;
  v_msg      public.messages;
  v_body     text := nullif(btrim(coalesce(p_body, '')), '');
  v_receiver uuid;
  v_warning  text := 'This message was not sent because it contains restricted contact, payment, or external platform information. Please keep all communication and payment inside the platform.';
begin
  if v_uid is null then
    raise exception 'Sign in first.';
  end if;

  select * into v_chat from public.chats where id = p_chat_id;
  if not found then
    raise exception 'Chat not found.';
  end if;

  -- The caller must be a party to the chat. In practice this is the buyer
  -- (they just sent a message and the seller is away), but the check is
  -- written for either side so the seller's own tab can use it too.
  if v_chat.buyer_id <> v_uid and v_chat.seller_id <> v_uid then
    raise exception 'This chat is not yours.';
  end if;

  select * into v_shop from public.shops where id = v_chat.shop_id;
  if not found then
    raise exception 'This chat has no shop.';
  end if;

  -- The AI may only speak for a shop that has switched it on.
  if v_shop.ai_reply_enabled is not true then
    raise exception 'AI replies are switched off for this shop.';
  end if;

  if v_body is null then
    raise exception 'Nothing to send.';
  end if;

  -- ── the chat guard, identical to a human message ──────────────────
  select * into v_rule from public.nm_check_message(v_body) limit 1;
  if found then
    v_receiver := case when v_chat.buyer_id = v_shop.owner_id
                       then v_chat.seller_id else v_chat.buyer_id end;

    insert into public.blocked_messages
      (chat_id, sender_id, receiver_id, body, rule_group, rule_pattern, matched_text)
    values
      (p_chat_id, v_shop.owner_id, v_receiver, v_body,
       v_rule.rule_group, v_rule.pattern, v_rule.matched);

    return jsonb_build_object('blocked', true, 'warning', v_warning);
  end if;

  -- ── insert as the SELLER ──────────────────────────────────────────
  insert into public.messages (chat_id, sender_id, body, ai_generated)
  values (p_chat_id, v_shop.owner_id, v_body, true)
  returning * into v_msg;

  return jsonb_build_object('blocked', false, 'message', to_jsonb(v_msg));
end $$;

grant execute on function public.send_ai_reply(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- The suggestion the seller accepts must also be marked sent, and the
-- message it produced recorded, so the UI can stop showing it.
-- ---------------------------------------------------------------------
create or replace function public.mark_ai_suggestion_sent(
  p_suggestion_id uuid,
  p_message_id    uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sug public.ai_reply_suggestions;
  v_chat public.chats;
begin
  select * into v_sug from public.ai_reply_suggestions where id = p_suggestion_id;
  if not found then return; end if;

  select * into v_chat from public.chats where id = v_sug.chat_id;
  if not found then return; end if;

  -- Only a party to the chat may mark it.
  if auth.uid() is null
     or (v_chat.buyer_id <> auth.uid() and v_chat.seller_id <> auth.uid()) then
    raise exception 'This chat is not yours.';
  end if;

  update public.ai_reply_suggestions
     set status = 'sent',
         sent_at = now(),
         sent_message_id = p_message_id
   where id = p_suggestion_id;
end $$;

grant execute on function public.mark_ai_suggestion_sent(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Dismissing a suggestion (the seller does not want it).
-- ---------------------------------------------------------------------
create or replace function public.dismiss_ai_suggestion(p_suggestion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sug  public.ai_reply_suggestions;
  v_chat public.chats;
begin
  select * into v_sug from public.ai_reply_suggestions where id = p_suggestion_id;
  if not found then return; end if;

  select * into v_chat from public.chats where id = v_sug.chat_id;
  if not found then return; end if;

  if auth.uid() is null
     or (v_chat.buyer_id <> auth.uid() and v_chat.seller_id <> auth.uid()) then
    raise exception 'This chat is not yours.';
  end if;

  update public.ai_reply_suggestions
     set status = 'dismissed'
   where id = p_suggestion_id;
end $$;

grant execute on function public.dismiss_ai_suggestion(uuid) to authenticated;

notify pgrst, 'reload schema';
