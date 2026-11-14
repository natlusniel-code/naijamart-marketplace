-- =====================================================================
-- 0042 — the AI may only speak while the seller is OFFLINE
-- =====================================================================
-- 0039 let `send_ai_reply` run whenever the shop had AI replies switched
-- on. The app decided auto-vs-suggest from presence, but the function
-- itself did not care: anything holding a buyer session could call it and
-- put words in the seller's mouth while the seller was sitting right
-- there, typing their own answer.
--
-- The rule is now enforced where the truth lives. `seller_is_online`
-- (sql/0035) reads the heartbeat the Seller Hub pings, so:
--
--   seller online  → the function refuses. The app has already stored the
--                    draft as a `suggested` row for the seller to use.
--   seller offline → the function sends, flagged `ai_generated`.
--
-- This is defence in depth, not a duplicate of the app check: the app
-- check decides which draft to write, this one decides whether the AI is
-- allowed to speak at all. A future caller that forgets the first check
-- still cannot break the rule.
--
-- The refusal is a normal return, not an exception: the buyer's message is
-- already saved and a raised error would surface as a broken chat.
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

  -- ── THE PRESENCE RULE ────────────────────────────────────────────────
  -- The seller is at their desk. The AI does not answer for them.
  -- Returned, not raised: the buyer's message is already saved, and this
  -- is a normal "the human is handling it" outcome, not a failure.
  if public.seller_is_online(v_chat.shop_id) then
    return jsonb_build_object('blocked', false, 'skipped', true, 'reason', 'seller_online');
  end if;

  if v_body is null then
    raise exception 'Nothing to send.';
  end if;

  -- ── the chat guard, identical to a human message ──────────────────────
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

  -- ── insert as the SELLER ─────────────────────────────────────────────
  insert into public.messages (chat_id, sender_id, body, ai_generated)
  values (p_chat_id, v_shop.owner_id, v_body, true)
  returning * into v_msg;

  return jsonb_build_object('blocked', false, 'message', to_jsonb(v_msg));
end $$;

grant execute on function public.send_ai_reply(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Realtime: the seller's own thread must see the AI reply land, and the
-- buyer must see it without a refresh. `messages` is already in the
-- publication (sql/0009); this only makes sure a database restored from
-- an older dump still has it.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

notify pgrst, 'reload schema';
