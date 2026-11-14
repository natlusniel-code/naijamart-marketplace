-- =====================================================================
-- 0035 — SELLER SUBSCRIPTION PLANS + THE AI LAYER
-- =====================================================================
-- This migration adds two things that did not exist before:
--
--   1. SELLER PLANS. Until now a seller subscription was one flat price
--      (`platform_settings.subscription_price`) with no tiers, and every
--      seller feature was free. Now there are two plans — Basic and
--      Premium — each with its own price and its own feature list, and
--      every seller-only feature is gated on an ACTIVE subscription.
--
--   2. THE AI LAYER. Tables for AI recommendations, trust & safety
--      reports, review/seller-quality analysis, seller AI insights,
--      search queries (voice + image), admin copilot threads, and the
--      AI reply queue that answers buyers when the seller is offline.
--
-- ── Why the plan is a table and not two columns ──────────────────────
-- The admin must be able to edit the Premium price, and the seller must
-- be shown what each plan includes. Both of those are data, not code:
-- a `seller_plans` row carries the price AND the feature list, so the
-- admin edits one row and the seller's comparison screen, the checkout
-- amount and the gate all read the same source. Hardcoding "7500" in a
-- component would make the admin's edit a lie.
--
-- ── Why `shops.plan` is separate from `subscription_status` ──────────
-- `subscription_status` answers "is the subscription paid and current?"
-- and `plan` answers "which tier did they buy?". A shop can be `active`
-- on Basic or `active` on Premium, and an expired Premium shop must not
-- silently keep Premium features — so the gate checks BOTH.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SELLER PLANS
-- ---------------------------------------------------------------------
create table if not exists public.seller_plans (
  id            text primary key check (id in ('basic','premium')),
  name          text not null,
  tagline       text,
  price         numeric(12,2) not null default 0 check (price >= 0),
  -- The feature list the seller is shown on the comparison screen. Stored
  -- as jsonb so the admin can edit it without a migration, and so each
  -- line can carry its own "included / not included" flag.
  features      jsonb not null default '[]'::jsonb,
  -- Which plan is highlighted as the recommended one on the comparison.
  recommended   boolean not null default false,
  active        boolean not null default true,
  sort_order    int not null default 0,
  updated_at    timestamptz not null default now()
);

insert into public.seller_plans (id, name, tagline, price, features, recommended, sort_order)
values
  (
    'basic',
    'Basic',
    'Everything you need to start selling',
    0,
    '[
      {"key":"listings","label":"Up to 20 live listings","included":true},
      {"key":"orders","label":"Unlimited orders","included":true},
      {"key":"chat","label":"Buyer chat","included":true},
      {"key":"analytics","label":"Standard analytics (views, clicks, orders)","included":true},
      {"key":"payouts","label":"Payouts 4 days after delivery","included":true},
      {"key":"aiListing","label":"AI product listing assistant","included":false},
      {"key":"aiInsights","label":"AI seller analytics & insights","included":false},
      {"key":"aiReply","label":"AI auto-reply when you are offline","included":false},
      {"key":"priority","label":"Priority placement in search","included":false},
      {"key":"badge","label":"Verified Premium badge","included":false}
    ]'::jsonb,
    false,
    0
  ),
  (
    'premium',
    'Premium',
    'Every seller feature, including all the AI tools',
    7500,
    '[
      {"key":"listings","label":"Unlimited live listings","included":true},
      {"key":"orders","label":"Unlimited orders","included":true},
      {"key":"chat","label":"Buyer chat","included":true},
      {"key":"analytics","label":"Advanced analytics + AI seller insights","included":true},
      {"key":"payouts","label":"Payouts 4 days after delivery","included":true},
      {"key":"aiListing","label":"AI product listing assistant","included":true},
      {"key":"aiInsights","label":"AI seller analytics & insights","included":true},
      {"key":"aiReply","label":"AI auto-reply and suggested replies","included":true},
      {"key":"priority","label":"Priority placement in search","included":true},
      {"key":"badge","label":"Verified Premium badge","included":true}
    ]'::jsonb,
    true,
    1
  )
on conflict (id) do nothing;

-- The shop's chosen tier. `basic` is the default so an existing shop that
-- was paying the old flat price keeps working; the gate still requires an
-- active subscription, so this does not hand out free access.
alter table public.shops
  add column if not exists plan text not null default 'basic';

-- Add the FK separately: `add column ... references` would fail on a
-- re-run, and this migration must be idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shops_plan_fkey'
  ) then
    alter table public.shops
      add constraint shops_plan_fkey
      foreign key (plan) references public.seller_plans(id);
  end if;
end $$;

-- The old flat price stays for backwards compatibility with any code that
-- still reads it, but it is now derived from the Premium plan so the two
-- can never disagree. The admin edits `seller_plans.price`.
update public.platform_settings
   set subscription_price = (select price from public.seller_plans where id = 'premium')
 where id = 1
   and exists (select 1 from public.seller_plans where id = 'premium');

-- ---------------------------------------------------------------------
-- 2. THE SELLER FEATURE GATE
-- ---------------------------------------------------------------------
-- One function, so the app never re-derives "is this seller allowed?".
--
-- A seller feature is allowed only when ALL of these hold:
--   • the shop is approved and identity-verified (the existing gate)
--   • `subscription_status = 'active'`
--   • the subscription has not lapsed (`subscription_expires_at` is null
--     or in the future)
--   • the plan they hold actually includes the feature
--
-- The last point is what makes Basic vs Premium real: a Basic seller is
-- a paying, approved seller who still cannot use the AI tools.
create or replace function public.seller_has_feature(
  p_shop_id uuid,
  p_feature text
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop  public.shops;
  v_plan  public.seller_plans;
  v_feat  jsonb;
begin
  select * into v_shop from public.shops where id = p_shop_id;
  if not found then return false; end if;

  -- Approved + verified, the same rule as src/lib/seller-gate.ts.
  if v_shop.status <> 'approved' or v_shop.verified is not true then
    return false;
  end if;

  -- Paid and current.
  if v_shop.subscription_status <> 'active' then return false; end if;
  if v_shop.subscription_expires_at is not null
     and v_shop.subscription_expires_at < now() then
    return false;
  end if;

  select * into v_plan from public.seller_plans where id = v_shop.plan;
  if not found then return false; end if;

  -- The feature must be present AND marked included on that plan.
  --
  -- Matched on the stable `key`, never on the display `label`: an admin
  -- rewording "AI seller analytics & insights" must not silently switch a
  -- paid feature off. `label` is presentation only.
  select f into v_feat
    from jsonb_array_elements(v_plan.features) f
   where f->>'key' = p_feature
     and coalesce((f->>'included')::boolean, false)
   limit 1;

  return v_feat is not null;
end $$;

-- A convenience wrapper for the signed-in seller, used by RLS policies.
create or replace function public.my_shop_has_feature(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.seller_has_feature(
      (select id from public.shops where owner_id = auth.uid() limit 1),
      p_feature
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------
-- 3. AI RECOMMENDATIONS
-- ---------------------------------------------------------------------
-- One row per (buyer, listing) recommendation, with the reason it was
-- made. Storing the reason is what lets the UI say "because you viewed
-- this" instead of showing an unexplained grid.
create table if not exists public.ai_recommendations (
  id          uuid primary key default gen_random_uuid(),
  buyer_id    uuid not null references auth.users(id) on delete cascade,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  score       numeric(6,4) not null default 0,
  reason      text,
  -- Which signal produced it: browse | search | cart | location | budget | history
  source      text not null default 'browse',
  created_at  timestamptz not null default now(),
  unique (buyer_id, listing_id)
);
create index if not exists ai_recommendations_buyer_idx
  on public.ai_recommendations(buyer_id, score desc);

-- ---------------------------------------------------------------------
-- 4. AI TRUST & SAFETY REPORTS
-- ---------------------------------------------------------------------
create table if not exists public.ai_safety_reports (
  id           uuid primary key default gen_random_uuid(),
  -- What was analysed: a listing, a shop, a review, a chat, a user.
  subject_type text not null check (subject_type in ('listing','shop','review','chat','user')),
  subject_id   uuid not null,
  risk_level   text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  score        int not null default 0 check (score between 0 and 100),
  summary      text,
  findings     jsonb not null default '[]'::jsonb,
  -- Admin workflow: open → reviewed → actioned / dismissed
  status       text not null default 'open' check (status in ('open','reviewed','actioned','dismissed')),
  reviewed_by  uuid references auth.users(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists ai_safety_reports_status_idx
  on public.ai_safety_reports(status, risk_level, created_at desc);

-- ---------------------------------------------------------------------
-- 5. AI REVIEW + SELLER QUALITY ANALYSIS
-- ---------------------------------------------------------------------
create table if not exists public.ai_quality_analyses (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  -- 0-100, higher is better. The components are kept so the seller can
  -- see WHY the score moved rather than just the number.
  score       int not null default 0 check (score between 0 and 100),
  components  jsonb not null default '{}'::jsonb,
  summary     text,
  strengths   jsonb not null default '[]'::jsonb,
  risks       jsonb not null default '[]'::jsonb,
  actions     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists ai_quality_analyses_shop_idx
  on public.ai_quality_analyses(shop_id, created_at desc);

-- ---------------------------------------------------------------------
-- 6. SELLER AI INSIGHTS (the AI half of seller analytics)
-- ---------------------------------------------------------------------
create table if not exists public.ai_seller_insights (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  kind        text not null default 'insight'
              check (kind in ('insight','forecast','pricing','content','alert')),
  title       text not null,
  body        text,
  -- The numbers the insight was derived from, so it is auditable.
  evidence    jsonb not null default '{}'::jsonb,
  priority    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists ai_seller_insights_shop_idx
  on public.ai_seller_insights(shop_id, priority desc, created_at desc);

-- ---------------------------------------------------------------------
-- 7. AI SEARCH (voice + image)
-- ---------------------------------------------------------------------
-- Every search is logged with the modality and how long it took, so the
-- "must be very fast" requirement is measurable rather than a claim.
create table if not exists public.ai_search_queries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  modality     text not null default 'text' check (modality in ('text','voice','image')),
  query_text   text,
  -- The interpreted intent, so a bad result can be traced to a bad parse.
  parsed       jsonb not null default '{}'::jsonb,
  result_count int not null default 0,
  latency_ms   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists ai_search_queries_user_idx
  on public.ai_search_queries(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- 8. AI ADMIN COPILOT
-- ---------------------------------------------------------------------
create table if not exists public.ai_copilot_threads (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'New conversation',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.ai_copilot_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.ai_copilot_threads(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  body        text not null,
  -- Any tool call the copilot made (a query it ran, a number it read).
  tool_calls  jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists ai_copilot_messages_thread_idx
  on public.ai_copilot_messages(thread_id, created_at);

-- ---------------------------------------------------------------------
-- 9. AI SELLER REPLY
-- ---------------------------------------------------------------------
-- `shops.ai_reply_enabled` is the seller's switch. When it is on and the
-- seller is offline, the AI answers; when the seller is online, the AI
-- only SUGGESTS and the seller sends.
alter table public.shops
  add column if not exists ai_reply_enabled boolean not null default true,
  add column if not exists last_seen_at timestamptz;

-- A suggestion the seller can accept, edit or dismiss.
create table if not exists public.ai_reply_suggestions (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats(id) on delete cascade,
  -- The buyer message this answers.
  message_id  uuid references public.messages(id) on delete cascade,
  shop_id     uuid not null references public.shops(id) on delete cascade,
  body        text not null,
  -- auto = sent by the AI while the seller was offline
  -- suggested = waiting for the seller to send it
  mode        text not null default 'suggested' check (mode in ('auto','suggested')),
  status      text not null default 'pending'
              check (status in ('pending','sent','dismissed','superseded')),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists ai_reply_suggestions_chat_idx
  on public.ai_reply_suggestions(chat_id, status, created_at desc);

-- Mark an AI-sent message so the thread can label it honestly.
alter table public.messages
  add column if not exists ai_generated boolean not null default false;

-- ---------------------------------------------------------------------
-- 10. RLS
-- ---------------------------------------------------------------------
alter table public.seller_plans          enable row level security;
alter table public.ai_recommendations    enable row level security;
alter table public.ai_safety_reports     enable row level security;
alter table public.ai_quality_analyses   enable row level security;
alter table public.ai_seller_insights    enable row level security;
alter table public.ai_search_queries     enable row level security;
alter table public.ai_copilot_threads    enable row level security;
alter table public.ai_copilot_messages   enable row level security;
alter table public.ai_reply_suggestions  enable row level security;

-- Plans are public: the comparison screen is shown to every seller.
drop policy if exists seller_plans_read on public.seller_plans;
create policy seller_plans_read on public.seller_plans
  for select using (true);

-- A buyer sees only their own recommendations.
drop policy if exists ai_recommendations_own on public.ai_recommendations;
create policy ai_recommendations_own on public.ai_recommendations
  for select using (buyer_id = auth.uid());

-- Safety reports are admin-only. No seller or buyer may read them.
drop policy if exists ai_safety_reports_admin on public.ai_safety_reports;
create policy ai_safety_reports_admin on public.ai_safety_reports
  for all using (public.is_admin()) with check (public.is_admin());

-- Quality analysis: the shop's owner and admins.
drop policy if exists ai_quality_analyses_owner on public.ai_quality_analyses;
create policy ai_quality_analyses_owner on public.ai_quality_analyses
  for select using (
    public.is_admin()
    or exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  );

-- Seller insights: the shop's owner and admins.
drop policy if exists ai_seller_insights_owner on public.ai_seller_insights;
create policy ai_seller_insights_owner on public.ai_seller_insights
  for select using (
    public.is_admin()
    or exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  );

-- Search log: your own rows, admins see all.
drop policy if exists ai_search_queries_own on public.ai_search_queries;
create policy ai_search_queries_own on public.ai_search_queries
  for select using (user_id = auth.uid() or public.is_admin());

-- Copilot: strictly the admin who owns the thread.
drop policy if exists ai_copilot_threads_own on public.ai_copilot_threads;
create policy ai_copilot_threads_own on public.ai_copilot_threads
  for all using (admin_id = auth.uid()) with check (admin_id = auth.uid());

drop policy if exists ai_copilot_messages_own on public.ai_copilot_messages;
create policy ai_copilot_messages_own on public.ai_copilot_messages
  for all using (
    exists (
      select 1 from public.ai_copilot_threads t
       where t.id = thread_id and t.admin_id = auth.uid()
    )
  );

-- Reply suggestions: the shop's owner and admins. The AI writes them with
-- the service role, so no INSERT policy is needed for the client.
drop policy if exists ai_reply_suggestions_owner on public.ai_reply_suggestions;
create policy ai_reply_suggestions_owner on public.ai_reply_suggestions
  for select using (
    public.is_admin()
    or exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 11. ADMIN: EDIT A PLAN
-- ---------------------------------------------------------------------
-- The admin console edits the Premium price through this. It is a
-- function rather than a direct UPDATE so the price can be validated and
-- the old flat `subscription_price` kept in step in one transaction.
create or replace function public.admin_update_seller_plan(
  p_id       text,
  p_price    numeric,
  p_features jsonb default null,
  p_tagline  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'A plan price cannot be negative.';
  end if;

  update public.seller_plans
     set price      = p_price,
         features   = coalesce(p_features, features),
         tagline    = coalesce(p_tagline, tagline),
         updated_at = now()
   where id = p_id;

  if not found then
    raise exception 'No plan with id %', p_id;
  end if;

  -- Keep the legacy flat price pointing at Premium.
  if p_id = 'premium' then
    update public.platform_settings set subscription_price = p_price where id = 1;
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'price', p_price);
end $$;

-- ---------------------------------------------------------------------
-- 12. SELLER: CHOOSE A PLAN
-- ---------------------------------------------------------------------
-- Records the tier the seller picked and puts the shop into `pending` so
-- the existing receipt-upload flow verifies the payment. The amount is
-- read from the plan row, never from the client.
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

-- ---------------------------------------------------------------------
-- 13. SELLER PRESENCE
-- ---------------------------------------------------------------------
-- The AI reply needs to know whether the seller is online. A heartbeat
-- from the seller's shell is cheaper and more reliable than trying to
-- infer it from message reads.
create or replace function public.touch_seller_presence()
returns void
language sql
security definer
set search_path = public
as $$
  update public.shops
     set last_seen_at = now()
   where owner_id = auth.uid();
$$;

-- "Online" = seen in the last 3 minutes. Long enough to survive a page
-- navigation, short enough that a closed laptop counts as offline.
create or replace function public.seller_is_online(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select last_seen_at > now() - interval '3 minutes'
       from public.shops where id = p_shop_id),
    false
  );
$$;

-- ---------------------------------------------------------------------
-- 14. AI REPLY QUEUE
-- ---------------------------------------------------------------------
-- Called by the app after a buyer message lands. It decides auto vs
-- suggest and records the row. The actual text is generated in the app
-- (it needs the model), so this only stores the decision.
create or replace function public.queue_ai_reply(
  p_chat_id    uuid,
  p_message_id uuid,
  p_body       text,
  p_mode       text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat public.chats;
  v_id   uuid;
begin
  select * into v_chat from public.chats where id = p_chat_id;
  if not found then raise exception 'No such chat.'; end if;

  -- Supersede any suggestion still waiting on this chat: the buyer has
  -- said something newer, so an older draft is no longer the right reply.
  update public.ai_reply_suggestions
     set status = 'superseded'
   where chat_id = p_chat_id and status = 'pending';

  insert into public.ai_reply_suggestions (chat_id, message_id, shop_id, body, mode)
  values (p_chat_id, p_message_id, v_chat.shop_id, p_body, p_mode)
  returning id into v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 15. GRANTS
-- ---------------------------------------------------------------------
grant execute on function public.seller_has_feature(uuid, text)   to authenticated;
grant execute on function public.my_shop_has_feature(text)        to authenticated;
grant execute on function public.choose_seller_plan(text)         to authenticated;
grant execute on function public.touch_seller_presence()          to authenticated;
grant execute on function public.seller_is_online(uuid)           to authenticated;
grant execute on function public.queue_ai_reply(uuid, uuid, text, text) to authenticated;
grant execute on function public.admin_update_seller_plan(text, numeric, jsonb, text) to authenticated;
