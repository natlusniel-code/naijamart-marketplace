-- =====================================================================
-- 0009 — offers RLS, offer images, read receipts, realtime, location
-- =====================================================================
--
-- This migration fixes the two faults that made the app unusable:
--
--   1. `public.offers` had RLS enabled with a SELECT policy and NOTHING
--      else. Every INSERT was therefore denied, which is why sending an
--      offer came back as:
--          new row violates row-level security policy for table "offers"
--      A seller could also never update their own offer.
--
--   2. The `supabase_realtime` publication was EMPTY — no table was
--      streaming. Every `postgres_changes` subscription in the chat
--      (messages, offers) was silently dead, so a sent message only
--      appeared after a full page reload and the unread badge never
--      updated on its own.
--
-- It also adds the columns the new chat UI needs:
--   offers.image_url          buyer/seller attachment on an offer
--   messages.delivered_at     single tick (sent) vs double tick (seen)
--   messages.read_at
--
-- Idempotent: safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. offers — allow the seller to send a quote, and answer it
-- ---------------------------------------------------------------------
-- Who may insert: the seller named on the row, who must own the shop the
-- chat belongs to, and who must actually be a member of that chat. The
-- buyer_id is constrained to the chat's real buyer so a seller cannot
-- invent one, and the price must be positive.
drop policy if exists offers_insert on public.offers;
create policy offers_insert on public.offers for insert
  with check (
    seller_id = auth.uid()
    and price > 0
    and public.is_chat_member(chat_id)
    and exists (
      select 1 from public.chats c
      where c.id = chat_id
        and c.seller_id = auth.uid()
        and c.buyer_id = offers.buyer_id
    )
  );

-- Who may update: the seller may edit/withdraw a pending quote; the buyer
-- may mark it accepted/declined. `accept_offer()` is SECURITY DEFINER and
-- does its own status check, so the RPC keeps working either way.
drop policy if exists offers_update on public.offers;
create policy offers_update on public.offers for update
  using (
    (seller_id = auth.uid() and public.is_chat_member(chat_id))
    or (buyer_id = auth.uid() and public.can_see_chat(chat_id))
  )
  with check (
    (seller_id = auth.uid() and public.is_chat_member(chat_id))
    or (buyer_id = auth.uid() and public.can_see_chat(chat_id))
  );

-- Optional image/attachment on an offer (item 7).
alter table public.offers add column if not exists image_url text;

-- ---------------------------------------------------------------------
-- 2. messages — read receipts (item 4)
-- ---------------------------------------------------------------------
alter table public.messages add column if not exists read_at      timestamptz;
alter table public.messages add column if not exists delivered_at timestamptz;

create index if not exists messages_unread_idx
  on public.messages(chat_id) where read_at is null;

-- The recipient marks everything not their own as seen. SECURITY DEFINER
-- so it is a single round trip and cannot be pointed at someone else's
-- chat: membership is re-checked in SQL, not trusted from the client.
create or replace function public.mark_chat_read(p_chat_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n int := 0; v_uid uuid := auth.uid();
begin
  if v_uid is null then return 0; end if;
  if not public.is_chat_member(p_chat_id) then return 0; end if;

  update public.messages
     set read_at      = coalesce(read_at, now()),
         delivered_at = coalesce(delivered_at, now())
   where chat_id = p_chat_id
     and sender_id <> v_uid
     and read_at is null;
  get diagnostics v_n = row_count;

  -- Everything the other side sent is now delivered too, even if it was
  -- already read (older rows that predate the column).
  update public.messages
     set delivered_at = coalesce(delivered_at, now())
   where chat_id = p_chat_id
     and sender_id <> v_uid
     and delivered_at is null;

  return v_n;
end $$;

grant execute on function public.mark_chat_read(uuid) to authenticated, anon;

-- Number of unread messages for the signed-in user, across all chats
-- (item 6 — the tab badge must be a real unread count, not a chat count).
create or replace function public.unread_message_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(*), 0)::int
  from public.messages m
  join public.chats c on c.id = m.chat_id
  where (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    and m.sender_id <> auth.uid()
    and m.read_at is null;
$$;

grant execute on function public.unread_message_count() to authenticated, anon;

-- ---------------------------------------------------------------------
-- 3. Realtime — actually publish the tables the chat subscribes to
-- ---------------------------------------------------------------------
-- Without this the client `.on("postgres_changes", …)` handlers never
-- fire. RLS still applies to the stream, so a subscriber only receives
-- rows it may select.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['messages', 'offers', 'chats'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- REPLICA IDENTITY FULL so UPDATE payloads carry the old row too; the
-- client uses that to patch the right message when a receipt arrives.
alter table public.messages replica identity full;
alter table public.offers   replica identity full;

-- ---------------------------------------------------------------------
-- 4. Location browsing (item 1) — a readable city/state index
-- ---------------------------------------------------------------------
-- Lets the home page and search build a real city list instead of
-- hardcoding one, and keeps "browse all cities" cheap.
create or replace view public.shop_locations as
  select city, state, count(*)::int as shop_count
  from public.shops
  where status = 'approved' and city is not null
  group by city, state
  order by count(*) desc;

grant select on public.shop_locations to anon, authenticated;
