-- =====================================================================
-- 0017 — AI features: receipt verification, seller identity, AI plumbing
-- =====================================================================
--
-- Design rule for this whole migration (and every AI feature built on it):
--
--     THE AI READS AND EXTRACTS. CODE DECIDES.
--
-- The AI returns structured fields with a confidence score per field. Every
-- comparison, threshold and approval below is applied by SQL/TypeScript against
-- rows in this database — never by the model. That is what makes a decision
-- testable, auditable and explainable to the buyer.
--
-- Nothing here is on the critical path of checkout, login, payment or order
-- creation. If the AI is down, slow, rate-limited or over quota, every table
-- below simply stays empty and the existing human review flow carries on.
--
-- Idempotent: safe to run twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Settings the rules engine reads
-- ---------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists ai_auto_approve_max numeric(12,2) not null default 100000;

alter table public.platform_settings
  add column if not exists receipt_window_minutes int not null default 30;

alter table public.platform_settings
  add column if not exists ai_min_confidence numeric(4,3) not null default 0.75;

comment on column public.platform_settings.ai_auto_approve_max is
  'Payments at or below this amount may be auto-approved by the rules engine. Above it, always admin review.';
comment on column public.platform_settings.receipt_window_minutes is
  'How far back a receipt timestamp may be and still auto-approve. Widen this first if the review queue fills with genuine slow-network payments.';
comment on column public.platform_settings.ai_min_confidence is
  'Every extracted field must reach this confidence for auto-approval. Below it the payment goes to admin review.';

-- ---------------------------------------------------------------------
-- 1. admin_payment_accounts
-- ---------------------------------------------------------------------
-- The spec names this table. The project ALREADY has `payment_accounts`
-- (sql/0011) which is wired into checkout: round-robin assignment, the
-- `orders.payment_account_id` column, and the admin "Payment accounts" screen.
--
-- Creating a second writable table would give us two lists that drift apart,
-- and the receipt check would then validate against an account the buyer was
-- never shown. So `admin_payment_accounts` is a VIEW over the one real table.
-- The spec's name exists, there is exactly one source of truth, and adding an
-- account in the admin console immediately affects receipt verification.
create or replace view public.admin_payment_accounts as
  select
    a.id,
    a.bank_name,
    a.account_name,
    a.account_number,
    a.active,
    a.label,
    a.sort_order,
    a.created_at
  from public.payment_accounts a;

comment on view public.admin_payment_accounts is
  'Read-only view of payment_accounts (sql/0011). The receipt rules engine matches a receipt''s bank + account name against the ACTIVE rows here. One source of truth: add accounts in the admin console, not here.';

-- ---------------------------------------------------------------------
-- 2. payment_receipts — one row per receipt image the AI read
-- ---------------------------------------------------------------------
create table if not exists public.payment_receipts (
  id                uuid primary key default gen_random_uuid(),
  payment_id        uuid references public.payments(id) on delete cascade,
  order_id          uuid references public.orders(id) on delete set null,
  shop_id           uuid references public.shops(id) on delete set null,
  kind              text not null default 'order' check (kind in ('order','subscription')),
  image_url         text not null,

  -- Extracted fields. Null means "the AI could not read it", which is itself
  -- a reason to send the payment to a human rather than guess.
  amount            numeric(12,2),
  txn_at            timestamptz,
  sender_name       text,
  bank_name         text,
  account_name      text,
  account_number    text,
  txn_reference     text,
  success_wording   text,

  -- Per-field confidence, 0..1. Shape: {"amount":0.98,"txn_at":0.91,...}
  field_confidence  jsonb not null default '{}'::jsonb,

  -- Editing signals the model noticed. A RISK SIGNAL, never a pass/fail on
  -- its own — a phone screenshot of a real receipt often looks "edited".
  tamper_signals    jsonb not null default '[]'::jsonb,
  tamper_score      numeric(4,3),

  -- The eight rule results, in order, each {rule, passed, detail}.
  rule_results      jsonb not null default '[]'::jsonb,
  rules_passed      boolean not null default false,
  failed_rule       text,

  outcome           text not null default 'awaiting_confirmation'
    check (outcome in ('auto_approved','awaiting_confirmation','admin_approved','admin_rejected')),
  outcome_reason    text,

  ai_model          text,
  ai_latency_ms     int,
  ai_available      boolean not null default true,

  created_at        timestamptz not null default now(),
  decided_at        timestamptz,
  decided_by        uuid references auth.users(id) on delete set null
);
create index if not exists payment_receipts_payment_idx on public.payment_receipts(payment_id);
create index if not exists payment_receipts_outcome_idx on public.payment_receipts(outcome, created_at desc);
create index if not exists payment_receipts_ref_idx on public.payment_receipts(txn_reference);

alter table public.payment_receipts enable row level security;

drop policy if exists payment_receipts_admin on public.payment_receipts;
create policy payment_receipts_admin on public.payment_receipts for all
  using (public.is_admin()) with check (public.is_admin());

-- A buyer may see the receipt rows for their own orders (so the order page can
-- say "we're confirming your payment"), but may not write them.
drop policy if exists payment_receipts_buyer_read on public.payment_receipts;
create policy payment_receipts_buyer_read on public.payment_receipts for select
  using (
    exists (
      select 1 from public.orders o
       where o.id = payment_receipts.order_id and o.buyer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- 3. used_transaction_references — every reference ever submitted
-- ---------------------------------------------------------------------
-- The unique constraint IS the duplicate check. A reference that has been seen
-- before cannot be inserted, so a replayed receipt fails at the database, not
-- at the model's discretion.
create table if not exists public.used_transaction_references (
  reference     text primary key,
  order_id      uuid references public.orders(id) on delete set null,
  payment_id    uuid references public.payments(id) on delete set null,
  shop_id       uuid references public.shops(id) on delete set null,
  kind          text not null default 'order' check (kind in ('order','subscription')),
  amount        numeric(12,2),
  first_seen_at timestamptz not null default now(),
  first_seen_by uuid references auth.users(id) on delete set null
);
create index if not exists used_refs_order_idx on public.used_transaction_references(order_id);

alter table public.used_transaction_references enable row level security;

drop policy if exists used_refs_admin on public.used_transaction_references;
create policy used_refs_admin on public.used_transaction_references for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 4. seller_verification — identity document checks
-- ---------------------------------------------------------------------
create table if not exists public.seller_verification (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops(id) on delete cascade,
  owner_id          uuid references auth.users(id) on delete set null,
  document_type     text not null default 'unknown'
    check (document_type in ('nin_slip','national_id','drivers_licence','passport','voters_card','cac','unknown')),
  image_url         text not null,

  -- What the AI concluded about the IMAGE, not about the person.
  is_identity_doc   boolean,
  detected_type     text,
  name_readable     boolean,
  number_readable   boolean,
  photo_present     boolean,
  tamper_signals    jsonb not null default '[]'::jsonb,
  confidence        numeric(4,3),
  ai_reason         text,

  status            text not null default 'pending'
    check (status in ('pending','ai_approved','needs_review','admin_approved','admin_rejected')),
  admin_decision    text,
  admin_note        text,
  decided_by        uuid references auth.users(id) on delete set null,
  decided_at        timestamptz,

  ai_model          text,
  ai_available      boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists seller_verification_shop_idx on public.seller_verification(shop_id, created_at desc);
create index if not exists seller_verification_status_idx on public.seller_verification(status);

alter table public.seller_verification enable row level security;

drop policy if exists seller_verification_admin on public.seller_verification;
create policy seller_verification_admin on public.seller_verification for all
  using (public.is_admin()) with check (public.is_admin());

-- A seller may see their own submissions (so the onboarding screen can show
-- "we're checking your ID") but cannot write the verdict.
drop policy if exists seller_verification_owner_read on public.seller_verification;
create policy seller_verification_owner_read on public.seller_verification for select
  using (public.owns_shop(shop_id));

-- ---------------------------------------------------------------------
-- 5. ai_action_log — every suggestion, and what a human did with it
-- ---------------------------------------------------------------------
create table if not exists public.ai_action_log (
  id             uuid primary key default gen_random_uuid(),
  feature        text not null,
  actor_id       uuid references auth.users(id) on delete set null,
  actor_role     text,
  input_ref      text,
  input_summary  text,
  ai_output      jsonb,
  ai_available   boolean not null default true,
  ai_model       text,
  latency_ms     int,
  cached         boolean not null default false,

  -- What the CODE decided, and separately what a HUMAN decided. Keeping them
  -- apart is the point: an audit can show "AI said X, code said Y, admin said Z".
  code_decision  text,
  code_reason    text,
  human_decision text,
  human_id       uuid references auth.users(id) on delete set null,
  human_at       timestamptz,

  created_at     timestamptz not null default now()
);
create index if not exists ai_action_log_feature_idx on public.ai_action_log(feature, created_at desc);
create index if not exists ai_action_log_actor_idx on public.ai_action_log(actor_id, created_at desc);

alter table public.ai_action_log enable row level security;

drop policy if exists ai_action_log_admin on public.ai_action_log;
create policy ai_action_log_admin on public.ai_action_log for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 6. ai_cache — repeated questions cost nothing
-- ---------------------------------------------------------------------
create table if not exists public.ai_cache (
  key         text primary key,
  feature     text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours'
);
create index if not exists ai_cache_expiry_idx on public.ai_cache(expires_at);

alter table public.ai_cache enable row level security;
-- No policies: only the service role (server-side) touches this table.

-- ---------------------------------------------------------------------
-- 7. ai_rate_limits — per user, per feature, per window
-- ---------------------------------------------------------------------
create table if not exists public.ai_rate_limits (
  actor_id    text not null,
  feature     text not null,
  window_start timestamptz not null,
  count       int not null default 0,
  primary key (actor_id, feature, window_start)
);
create index if not exists ai_rate_limits_window_idx on public.ai_rate_limits(window_start);

alter table public.ai_rate_limits enable row level security;
-- No policies: service role only.

-- ---------------------------------------------------------------------
-- 8. ai_suggestions — admin-facing flags awaiting a human decision
-- ---------------------------------------------------------------------
-- One row per thing the AI flagged. `status` is the ADMIN's decision, never
-- the AI's. Nothing here can ban, refund, approve or pay out on its own.
create table if not exists public.ai_suggestions (
  id            uuid primary key default gen_random_uuid(),
  feature       text not null,
  subject_type  text not null,
  subject_id    uuid,
  severity      text not null default 'info' check (severity in ('info','warn','high')),
  title         text not null,
  detail        text,
  evidence      jsonb not null default '{}'::jsonb,
  status        text not null default 'open' check (status in ('open','accepted','dismissed','actioned')),
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);
create index if not exists ai_suggestions_status_idx on public.ai_suggestions(status, severity, created_at desc);
create index if not exists ai_suggestions_subject_idx on public.ai_suggestions(subject_type, subject_id);

alter table public.ai_suggestions enable row level security;

drop policy if exists ai_suggestions_admin on public.ai_suggestions;
create policy ai_suggestions_admin on public.ai_suggestions for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 9. Rate-limit RPC — atomic, so two parallel requests cannot both pass
-- ---------------------------------------------------------------------
create or replace function public.ai_consume_rate_limit(
  p_actor   text,
  p_feature text,
  p_limit   int,
  p_window  interval default interval '1 hour'
) returns table (allowed boolean, used int, remaining int, resets_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz;
  v_count int;
begin
  -- Bucket the window so every caller in the same hour shares one row.
  v_start := date_trunc('hour', now())
             + (floor(extract(epoch from (now() - date_trunc('hour', now()))) / extract(epoch from p_window)) * p_window);

  insert into public.ai_rate_limits (actor_id, feature, window_start, count)
  values (p_actor, p_feature, v_start, 1)
  on conflict (actor_id, feature, window_start)
  do update set count = public.ai_rate_limits.count + 1
  returning count into v_count;

  return query select
    (v_count <= p_limit),
    v_count,
    greatest(p_limit - v_count, 0),
    v_start + p_window;
end $$;

grant execute on function public.ai_consume_rate_limit(text, text, int, interval) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 10. Cache RPCs
-- ---------------------------------------------------------------------
create or replace function public.ai_cache_get(p_key text)
returns jsonb language sql security definer set search_path = public as $$
  select payload from public.ai_cache
   where key = p_key and expires_at > now();
$$;

create or replace function public.ai_cache_put(
  p_key text, p_feature text, p_payload jsonb, p_ttl interval default interval '24 hours'
) returns void language sql security definer set search_path = public as $$
  insert into public.ai_cache (key, feature, payload, expires_at)
  values (p_key, p_feature, p_payload, now() + p_ttl)
  on conflict (key) do update
    set payload = excluded.payload,
        expires_at = excluded.expires_at,
        created_at = now();
$$;

grant execute on function public.ai_cache_get(text) to authenticated, anon;
grant execute on function public.ai_cache_put(text, text, jsonb, interval) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 11. Reference dedupe RPC
-- ---------------------------------------------------------------------
-- Returns true when the reference was NEW (and is now claimed). False means it
-- has been seen before — a replayed receipt.
create or replace function public.ai_claim_reference(
  p_reference text,
  p_order_id  uuid default null,
  p_payment_id uuid default null,
  p_shop_id   uuid default null,
  p_kind      text default 'order',
  p_amount    numeric default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_norm text;
begin
  v_norm := upper(regexp_replace(coalesce(p_reference, ''), '\s+', '', 'g'));
  if v_norm = '' then return false; end if;

  insert into public.used_transaction_references
    (reference, order_id, payment_id, shop_id, kind, amount, first_seen_by)
  values (v_norm, p_order_id, p_payment_id, p_shop_id, p_kind, p_amount, auth.uid())
  on conflict (reference) do nothing;

  return found;
end $$;

grant execute on function public.ai_claim_reference(text, uuid, uuid, uuid, text, numeric) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 12. Auto-approve RPC — the ONLY path that marks a payment paid from AI
-- ---------------------------------------------------------------------
-- Called by the server after the TypeScript rules engine has already passed
-- all eight checks. It re-verifies the two facts that must never be trusted
-- from the caller (amount and reference uniqueness) and refuses if the payment
-- is not in a state that may be approved.
--
-- Deliberately does NOT accept a "confidence" argument: confidence is a
-- property of the extraction, and the extraction row is the evidence.
create or replace function public.ai_auto_approve_payment(
  p_payment_id uuid,
  p_receipt_id uuid
) returns table (approved boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_pay   public.payments;
  v_rec   public.payment_receipts;
  v_order public.orders;
  v_shop  public.shops;
  v_cfg   public.platform_settings;
  v_first boolean := false;
begin
  select * into v_cfg from public.platform_settings where id = 1;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then return query select false, 'Payment not found.'; return; end if;
  if v_pay.status = 'verified' then return query select false, 'Already verified.'; return; end if;

  select * into v_rec from public.payment_receipts where id = p_receipt_id;
  if not found then return query select false, 'Receipt not found.'; return; end if;
  if v_rec.payment_id is distinct from p_payment_id then
    return query select false, 'Receipt does not belong to this payment.'; return;
  end if;
  if not v_rec.rules_passed then
    return query select false, coalesce(v_rec.failed_rule, 'Rules did not pass.'); return;
  end if;

  -- Re-check the amount against the payment row itself, not the receipt.
  if v_rec.amount is null or round(v_rec.amount, 2) <> round(v_pay.amount, 2) then
    return query select false, 'Amount does not match the payment.'; return;
  end if;

  -- Re-check the cap.
  if v_pay.amount > coalesce(v_cfg.ai_auto_approve_max, 100000) then
    return query select false, 'Above the auto-approval cap.'; return;
  end if;

  -- Claim the reference. If it was already used, this is a replay.
  v_first := public.ai_claim_reference(
    v_rec.txn_reference, v_pay.order_id, v_pay.id, v_pay.shop_id, v_pay.type, v_pay.amount
  );
  if not v_first then
    return query select false, 'Transaction reference has already been used.'; return;
  end if;

  update public.payments
     set status = 'verified', verified_at = now(), reject_reason = null
   where id = p_payment_id;

  if v_pay.type = 'order' and v_pay.order_id is not null then
    select * into v_order from public.orders where id = v_pay.order_id for update;
    if found and v_order.status = 'pending_payment' then
      -- Funds stay in escrow: payout_status remains 'held' until delivery.
      update public.orders set status = 'paid' where id = v_order.id;
    end if;
  elsif v_pay.type = 'subscription' and v_pay.shop_id is not null then
    select * into v_shop from public.shops where id = v_pay.shop_id for update;
    if found then
      update public.shops
         set subscription_status = 'active',
             subscription_expires_at = greatest(coalesce(subscription_expires_at, now()), now()) + interval '30 days'
       where id = v_shop.id;
    end if;
  end if;

  update public.payment_receipts
     set outcome = 'auto_approved', decided_at = now()
   where id = p_receipt_id;

  return query select true, 'All eight checks passed.';
end $$;

grant execute on function public.ai_auto_approve_payment(uuid, uuid) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 13. Seller identity verdict RPC
-- ---------------------------------------------------------------------
-- Applies the AI's document verdict. `verified` is a SEPARATE flag from
-- `subscription_status`: a seller can pay and still fail identity checks.
create or replace function public.ai_apply_identity_verdict(
  p_verification_id uuid,
  p_approve boolean,
  p_reason text default null
) returns table (applied boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare v_ver public.seller_verification;
begin
  select * into v_ver from public.seller_verification where id = p_verification_id for update;
  if not found then return query select false, 'Verification not found.'; return; end if;

  if p_approve then
    update public.seller_verification
       set status = 'ai_approved', ai_reason = coalesce(p_reason, ai_reason)
     where id = p_verification_id;
    -- Identity is confirmed; the shop still needs admin approval + payment.
    update public.shops set verified = true where id = v_ver.shop_id;
    return query select true, 'Identity document accepted.';
  else
    update public.seller_verification
       set status = 'needs_review', ai_reason = coalesce(p_reason, ai_reason)
     where id = p_verification_id;
    return query select true, 'Sent to admin review.';
  end if;
end $$;

grant execute on function public.ai_apply_identity_verdict(uuid, boolean, text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 14. Search-gap log — what buyers searched for and found nothing
-- ---------------------------------------------------------------------
create table if not exists public.search_gaps (
  id          uuid primary key default gen_random_uuid(),
  query       text not null,
  city        text,
  category    text,
  result_count int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists search_gaps_created_idx on public.search_gaps(created_at desc);

alter table public.search_gaps enable row level security;

drop policy if exists search_gaps_admin on public.search_gaps;
create policy search_gaps_admin on public.search_gaps for all
  using (public.is_admin()) with check (public.is_admin());

-- Anyone may record a gap (it is anonymous telemetry), nobody may read it
-- except an admin.
drop policy if exists search_gaps_insert on public.search_gaps;
create policy search_gaps_insert on public.search_gaps for insert
  with check (true);

-- ---------------------------------------------------------------------
-- 15. updated_at trigger for payment_receipts is not needed (append-only),
--     but keep the settings row touched consistently.
-- ---------------------------------------------------------------------
update public.platform_settings
   set ai_auto_approve_max = coalesce(ai_auto_approve_max, 100000),
       receipt_window_minutes = coalesce(receipt_window_minutes, 30),
       ai_min_confidence = coalesce(ai_min_confidence, 0.75)
 where id = 1;
