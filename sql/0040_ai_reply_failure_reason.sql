-- ---------------------------------------------------------------------
-- 0040 — AI reply: record WHY a draft was not produced
--
-- ── The problem this solves ───────────────────────────────────────────
-- `ai_reply_suggestions.status` allowed only 'pending' | 'sent' |
-- 'dismissed' | 'superseded'. When the model call failed (rate limit, a
-- rejected key, a timeout, a dead network) `handleBuyerMessage` produced
-- no row at all — the failure existed only as one `[ai]` line in the
-- server log. The seller saw an empty space where a suggestion should be,
-- and the buyer saw silence. There was no way for either of them to tell
-- "the AI is broken" from "the AI had nothing to say".
--
-- Two changes, both additive:
--
--   1. `status` accepts 'failed', so a failed attempt is a first-class
--      row that the seller's thread can render as a readable message.
--   2. `error` holds that message (see `replyErrorMessage()` in
--      src/lib/ai-reply.ts). It is plain text for a person, NOT a stack
--      trace and not a model response.
--
-- `body` stays NOT NULL. A failed row carries an empty string, which is
-- honest: there is no draft. The UI keys off `status = 'failed'` and
-- shows `error`, never `body`.
--
-- Nothing here changes an existing row: every row already in the table
-- has a status from the old set and a non-empty body.
-- ---------------------------------------------------------------------

-- ── 1. Widen the status check ───────────────────────────────────────────
-- The original inline CHECK was declared with the column, so it carries a
-- generated name. Drop it by whatever it is called rather than assuming.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.ai_reply_suggestions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.ai_reply_suggestions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.ai_reply_suggestions
  add constraint ai_reply_suggestions_status_check
  check (status in ('pending', 'sent', 'dismissed', 'superseded', 'failed'));

-- A failed row has no body; every other status must have one. This keeps
-- the original intent (a real draft is never empty) while allowing the
-- failure record.
alter table public.ai_reply_suggestions
  add constraint ai_reply_suggestions_body_check
  check (status = 'failed' or length(btrim(body)) > 0);

-- ── 2. The readable reason ──────────────────────────────────────────────
alter table public.ai_reply_suggestions
  add column if not exists error text;

comment on column public.ai_reply_suggestions.error is
  'Human-readable reason a draft was not produced. Only set when status = failed.';

-- ── 3. Let the seller dismiss a failure too ─────────────────────────────
-- The seller-side component updates `status` directly, so the owner needs
-- UPDATE on these rows. 0035 granted SELECT via a policy; without a matching
-- UPDATE policy the dismiss button silently did nothing.
drop policy if exists ai_reply_suggestions_owner_update on public.ai_reply_suggestions;
create policy ai_reply_suggestions_owner_update on public.ai_reply_suggestions
  for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.shops s
       where s.id = ai_reply_suggestions.shop_id and s.owner_id = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.shops s
       where s.id = ai_reply_suggestions.shop_id and s.owner_id = auth.uid()
    )
  );

-- A failed row is noise once the seller has seen it, and it must never be
-- picked up as "the pending suggestion for this chat".
create index if not exists ai_reply_suggestions_pending_idx
  on public.ai_reply_suggestions (chat_id, created_at desc)
  where status = 'pending';
