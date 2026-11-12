-- 0018_revert_ai.sql
--
-- Removes every database object created by 0017_ai_features.sql.
--
-- The AI features were reverted in code (commit reverting 6c16cfa). This
-- migration brings the database back to the same state, so no AI tables,
-- views, functions or settings are left behind.
--
-- Order matters: the view depends on payment_accounts, and the functions
-- reference the tables, so drop dependants first.
--
-- Safe to re-run: every statement is IF EXISTS.

begin;

-- ---------------------------------------------------------------------------
-- 1. Functions (they reference the tables below)
-- ---------------------------------------------------------------------------
drop function if exists public.ai_apply_identity_verdict(uuid, boolean, text);
drop function if exists public.ai_auto_approve_payment(uuid, uuid);
drop function if exists public.ai_claim_reference(text, uuid, uuid, uuid, text, numeric);
drop function if exists public.ai_cache_put(text, text, jsonb, interval);
drop function if exists public.ai_cache_get(text);
drop function if exists public.ai_consume_rate_limit(text, text, int, interval);

-- ---------------------------------------------------------------------------
-- 2. View
-- ---------------------------------------------------------------------------
drop view if exists public.admin_payment_accounts;

-- ---------------------------------------------------------------------------
-- 3. Tables (policies and indexes go with them)
-- ---------------------------------------------------------------------------
drop table if exists public.search_gaps;
drop table if exists public.ai_suggestions;
drop table if exists public.ai_rate_limits;
drop table if exists public.ai_cache;
drop table if exists public.ai_action_log;
drop table if exists public.seller_verification;
drop table if exists public.used_transaction_references;
drop table if exists public.payment_receipts;

-- ---------------------------------------------------------------------------
-- 4. Settings columns added to platform_settings
-- ---------------------------------------------------------------------------
alter table public.platform_settings drop column if exists ai_auto_approve_max;
alter table public.platform_settings drop column if exists receipt_window_minutes;
alter table public.platform_settings drop column if exists ai_min_confidence;

commit;
