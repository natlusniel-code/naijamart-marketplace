-- ---------------------------------------------------------------------
-- 0027 — the composer's own plan message must not be flagged
-- ---------------------------------------------------------------------
-- THE BUG
--   "Continue" on a plan opens the chat with a pre-filled message built by
--   `composePlanMessage()`:
--
--       I want this plan
--       ₦15,000
--       ✓ Unlimited revisions
--       ✓ 2-day delivery
--       Basic
--
--   The buyer presses Send and the guard refuses it. The screenshot shows
--   exactly that: "Message not sent" over a plan the app itself wrote.
--
--   The cause is that the guard cannot tell WHO wrote the text. It sees a
--   string and checks it against the block list. A seller is free to name a
--   plan feature "DM design pack", "IG post design" or "WhatsApp sticker
--   pack" — all ordinary service names — and `dm`, `ig`, `snap` and
--   `whatsapp` are app rules. So the app blocks its own message.
--
--   Verified against the live guard before this fix:
--       feature_dm        → blocked by `dm`
--       feature_ig        → blocked by `ig`
--       feature_snap      → blocked by `snap`
--       feature_whatsapp  → blocked by `whatsapp`
--
-- WHY NOT JUST EXEMPT THE CLIENT
--   A flag the browser sends ("this is a draft, skip the check") is a
--   bypass: anyone can set it and then type a phone number. The exemption
--   has to be something the client cannot forge.
--
-- THE FIX
--   The server composes the plan text itself, from the package ids. The
--   buyer's message is then split in two:
--
--       [ canonical plan text, built by nm_plan_draft() ]   ← exempt
--       [ anything the buyer typed after it ]               ← still checked
--
--   `send_chat_message` rebuilds the canonical text from the database and
--   requires the message to START WITH IT, byte for byte. A buyer cannot
--   forge that prefix, because they do not get to choose it — it is derived
--   from `gig_packages` at send time. And because only the prefix is
--   exempt, a buyer who appends "call me on 0803…" is still blocked.
--
--   The trigger gets the same treatment through a transaction-local flag
--   that only `send_chat_message` sets. `set_config(..., true)` is scoped to
--   the transaction, so it cannot leak into the next request, and PostgREST
--   does not expose `set_config` to clients.
-- ---------------------------------------------------------------------

-- 1. the canonical plan text -------------------------------------------
--    One function, so the gig page, the cart and the server all produce
--    the SAME bytes. If the client formatted it and the server re-derived
--    it, a stray space would break the prefix match and re-block the
--    message — the bug we are fixing, one layer down.
create or replace function public.nm_plan_draft(p_package_ids uuid[])
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pkg    record;
  v_lines  text[] := '{}';
  v_n      int;
  v_money  text;
  v_feat   text;
  v_label  text;
begin
  if p_package_ids is null or array_length(p_package_ids, 1) is null then
    return null;
  end if;

  v_n := array_length(p_package_ids, 1);

  -- ── one plan ────────────────────────────────────────────────────────
  if v_n = 1 then
    select * into v_pkg from public.gig_packages where id = p_package_ids[1];
    if not found then
      return null;
    end if;

    -- The discounted figure, not the list price: this is what the buyer
    -- will actually be asked to pay, so it is what the seller must see.
    v_money := '₦' || to_char(
      coalesce(v_pkg.effective_price, v_pkg.price), 'FM999,999,999,999'
    );

    v_lines := array['I want this plan', v_money];

    if v_pkg.features is not null and jsonb_typeof(v_pkg.features) = 'array' then
      for v_feat in select jsonb_array_elements_text(v_pkg.features) loop
        if btrim(coalesce(v_feat, '')) <> '' then
          v_lines := v_lines || ('✓ ' || btrim(v_feat));
        end if;
      end loop;
    end if;

    if v_pkg.delivery_days is not null then
      v_lines := v_lines || ('✓ ' || v_pkg.delivery_days || '-day delivery');
    end if;

    v_label := btrim(coalesce(v_pkg.name, ''));
    if v_label <> '' then
      v_lines := v_lines || v_label;
    end if;

    return array_to_string(v_lines, E'\n');
  end if;

  -- ── several plans (a cart holding more than one service line) ───────
  v_lines := array['I want these plans'];
  for v_pkg in
    select * from public.gig_packages
     where id = any(p_package_ids)
     order by array_position(p_package_ids, id)
  loop
    v_money := '₦' || to_char(
      coalesce(v_pkg.effective_price, v_pkg.price), 'FM999,999,999,999'
    );
    v_lines := v_lines || ('• ' || btrim(coalesce(v_pkg.name, 'Plan')) || ' — ' || v_money);
  end loop;

  return array_to_string(v_lines, E'\n');
end $$;

grant execute on function public.nm_plan_draft(uuid[]) to authenticated, anon;

-- 2. send_chat_message: exempt the canonical prefix only ----------------
--    The 3-argument version is dropped first: adding a defaulted 4th
--    argument would otherwise leave two overloads and make every call
--    ambiguous.
drop function if exists public.send_chat_message(uuid, text, text);

create or replace function public.send_chat_message(
  p_chat_id     uuid,
  p_body        text default null,
  p_image_url   text default null,
  p_package_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_chat     public.chats;
  v_receiver uuid;
  v_rule     record;
  v_msg      public.messages;
  v_body     text := nullif(btrim(coalesce(p_body, '')), '');
  v_image    text := nullif(btrim(coalesce(p_image_url, '')), '');
  v_canon    text;
  v_check    text;
  v_exempt   boolean := false;
  v_warning  text := 'This message was not sent because it contains restricted contact, payment, or external platform information. Please keep all communication and payment inside the platform.';
begin
  if v_uid is null then
    raise exception 'Sign in to send a message.';
  end if;

  select * into v_chat from public.chats where id = p_chat_id;
  if not found then
    raise exception 'Chat not found.';
  end if;
  if v_chat.buyer_id <> v_uid and v_chat.seller_id <> v_uid then
    raise exception 'This chat is not yours.';
  end if;

  v_receiver := case when v_chat.buyer_id = v_uid then v_chat.seller_id else v_chat.buyer_id end;

  if v_body is null and v_image is null then
    raise exception 'Type a message first.';
  end if;

  if v_body is not null then
    v_check := v_body;

    -- Rebuild the plan text from the database and require the message to
    -- begin with it. `left(...) = v_canon` is an exact byte comparison, so
    -- a buyer cannot hand-type a near-miss and have it treated as exempt.
    if p_package_ids is not null then
      v_canon := public.nm_plan_draft(p_package_ids);
      if v_canon is not null and left(v_body, length(v_canon)) = v_canon then
        v_exempt := true;
        -- Only what the buyer added AFTER the plan is checked.
        v_check := btrim(substr(v_body, length(v_canon) + 1));
      end if;
    end if;

    if v_check is not null and btrim(v_check) <> '' then
      select * into v_rule from public.nm_check_message(v_check) limit 1;
      if found then
        insert into public.blocked_messages
          (chat_id, sender_id, receiver_id, body, rule_group, rule_pattern, matched_text)
        values
          (p_chat_id, v_uid, v_receiver, v_body, v_rule.rule_group, v_rule.pattern, v_rule.matched);

        -- Nothing is inserted into `messages`: the receiver never sees it,
        -- and no partial or masked copy is sent.
        return jsonb_build_object('blocked', true, 'warning', v_warning);
      end if;
    end if;
  end if;

  -- Tell the trigger this row's prefix is the app's own text. Transaction
  -- local, so it dies with this call and cannot affect the next message.
  perform set_config('nm.plan_exempt', case when v_exempt then 'on' else 'off' end, true);

  insert into public.messages (chat_id, sender_id, body, image_url)
  values (p_chat_id, v_uid, v_body, v_image)
  returning * into v_msg;

  return jsonb_build_object('blocked', false, 'message', to_jsonb(v_msg));
end $$;

grant execute on function public.send_chat_message(uuid, text, text, uuid[]) to authenticated;

-- 3. the trigger honours the same flag ---------------------------------
create or replace function public.tg_messages_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule record;
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.body is null or btrim(new.body) = '' then
    return new;
  end if;

  -- Set only by send_chat_message(), and only after it has verified the
  -- message starts with the server-built plan text. A direct insert by a
  -- client never has this set, so the trigger still guards it.
  if current_setting('nm.plan_exempt', true) = 'on' then
    return new;
  end if;

  select * into v_rule from public.nm_check_message(new.body) limit 1;
  if found then
    raise exception 'This message was not sent because it contains restricted contact, payment, or external platform information. Please keep all communication and payment inside the platform.';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
