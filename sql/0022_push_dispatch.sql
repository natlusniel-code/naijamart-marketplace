-- 0022 — Web Push dispatch
--
-- notification rows were being written correctly but nothing ever DELIVERED
-- them: the client could only raise an OS notification while the tab was open,
-- and push_subscriptions was empty because no VAPID key existed.
--
-- Fix: one polling path. Every notification (order, chat, broadcast) is a row
-- in public.notifications; a server route claims the un-pushed rows, sends them
-- via Web Push and stamps pushed_at. That covers buyer, seller and admin with
-- no new trigger per feature, and cannot double-send.
--
-- Not a DB trigger that calls out: this project has no pg_net/http extension
-- (only pg_cron), so a trigger cannot make an outbound request.

-- 1. Delivery bookkeeping -------------------------------------------------
alter table public.notifications add column if not exists pushed_at timestamptz;

-- The dispatcher only looks for un-pushed rows; a partial index keeps it cheap.
create index if not exists notifications_unpushed_idx
  on public.notifications(created_at)
  where pushed_at is null;

-- 2. Chat notifications ---------------------------------------------------
-- A message used to bump a badge and nothing else: a seller with the app
-- closed never learned a buyer had written.
create or replace function public.tg_notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid; v_seller uuid; v_recipient uuid;
  v_name text;  v_shop text;
begin
  if coalesce(new.body, '') = '' and new.image_url is null then
    return new;
  end if;

  select c.buyer_id, c.seller_id into v_buyer, v_seller
    from public.chats c where c.id = new.chat_id;
  if v_buyer is null then return new; end if;

  -- Notify the party who did NOT send it.
  v_recipient := case when new.sender_id = v_buyer then v_seller else v_buyer end;
  if v_recipient is null or v_recipient = new.sender_id then return new; end if;

  select p.full_name into v_name from public.profiles p where p.id = new.sender_id;
  select s.name into v_shop from public.shops s where s.owner_id = new.sender_id limit 1;

  insert into public.notifications (user_id, kind, title, body, href)
  values (
    v_recipient,
    'chat',
    coalesce(v_shop, v_name, 'New message'),
    case when coalesce(new.body,'') <> '' then left(new.body, 140)
         else 'Sent you a photo' end,
    '/chats/' || new.chat_id
  );
  return new;
end $$;

drop trigger if exists t_notify_new_message on public.messages;
create trigger t_notify_new_message
  after insert on public.messages
  for each row execute function public.tg_notify_new_message();

-- 3. Allow the new kind (a chat row would have been rejected) -------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('order', 'chat', 'broadcast', 'system'));

-- 4. Claim un-pushed rows ------------------------------------------------
-- SECURITY DEFINER + service-role only: the dispatcher must see every user's
-- rows, which RLS would hide. Stamping pushed_at in the same statement is what
-- makes a second concurrent poll skip them instead of sending twice.
create or replace function public.claim_unpushed_notifications(p_limit int default 50)
returns table (id uuid, user_id uuid, kind text, title text, body text, href text)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select n.id from public.notifications n
     where n.pushed_at is null
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  )
  update public.notifications n
     set pushed_at = now()
    from claimed c
   where n.id = c.id
  returning n.id, n.user_id, n.kind, n.title, n.body, n.href;
$$;

revoke all on function public.claim_unpushed_notifications(int) from public;
revoke all on function public.claim_unpushed_notifications(int) from anon;
revoke all on function public.claim_unpushed_notifications(int) from authenticated;

-- 5. Prune dead subscriptions -------------------------------------------
create or replace function public.prune_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

revoke all on function public.prune_push_subscription(text) from public;
revoke all on function public.prune_push_subscription(text) from anon;
revoke all on function public.prune_push_subscription(text) from authenticated;

-- 6. Realtime for the new rows ------------------------------------------
-- The bell subscribes to INSERTs; the table is in the publication from 0013.
-- Re-asserting covers a project where that block was skipped.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'
          and tablename = 'notifications')
  then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

notify pgrst, 'reload schema';
