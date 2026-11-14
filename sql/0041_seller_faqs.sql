-- ---------------------------------------------------------------------
-- 0041 — Seller FAQs, used to condition the AI buyer reply
--
-- ── The problem this solves ──────────────────────────────────────────
-- The AI reply is given the shop's facts (delivery fee, listings, the
-- recent thread) and told to answer only from them. That is enough for
-- "how much is delivery", but it cannot know the things a seller answers
-- over and over in their own words: "do you deliver to Ibadan", "can I
-- pay on delivery", "how long does a custom order take". Today the AI
-- either guesses or says it will check.
--
-- A Premium seller can now write those answers down once, as FAQs, and
-- the reply prompt is given them as the seller's own words. The AI then
-- answers the way the seller would.
--
-- ── Why a table and not a jsonb column on `shops` ────────────────────
-- An FAQ is a list of rows a seller adds, edits and deletes one at a
-- time. A jsonb array on `shops` would mean read-modify-write on the
-- whole shop row for every edit, and would make "which FAQ answered
-- this" impossible to index later. A table is the honest shape.
--
-- ── Who may read and write ───────────────────────────────────────────
--   • the owning seller: full control of their own shop's FAQs
--   • admins: read, for support
--   • the AI reply runs on the SERVER with the seller's session, so the
--     owner policy is what lets it read the rows. No service role needed.
--
-- Nothing here changes an existing table or row. It is purely additive.
-- ---------------------------------------------------------------------

create table if not exists public.seller_faqs (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  question    text not null,
  answer      text not null,
  -- Display order in the seller's editor. Lower first.
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- An empty question or answer is not an FAQ; the UI trims, and this is
  -- the backstop so a bad client cannot store a blank row.
  constraint seller_faqs_question_check check (length(btrim(question)) > 0),
  constraint seller_faqs_answer_check   check (length(btrim(answer))   > 0)
);

create index if not exists seller_faqs_shop_idx
  on public.seller_faqs(shop_id, sort_order, created_at);

-- Keep `updated_at` honest without the app having to remember.
create or replace function public.touch_seller_faq()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists seller_faqs_touch on public.seller_faqs;
create trigger seller_faqs_touch
  before update on public.seller_faqs
  for each row execute function public.touch_seller_faq();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.seller_faqs enable row level security;

-- The owning seller reads their own FAQs; admins read any.
drop policy if exists seller_faqs_owner_read on public.seller_faqs;
create policy seller_faqs_owner_read on public.seller_faqs
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.shops s
       where s.id = seller_faqs.shop_id and s.owner_id = auth.uid()
    )
  );

-- The owning seller adds FAQs to their own shop. The `with check` is what
-- stops a seller writing a row against someone else's shop id.
drop policy if exists seller_faqs_owner_insert on public.seller_faqs;
create policy seller_faqs_owner_insert on public.seller_faqs
  for insert with check (
    public.is_admin()
    or exists (
      select 1 from public.shops s
       where s.id = seller_faqs.shop_id and s.owner_id = auth.uid()
    )
  );

-- The owning seller edits their own FAQs.
drop policy if exists seller_faqs_owner_update on public.seller_faqs;
create policy seller_faqs_owner_update on public.seller_faqs
  for update using (
    public.is_admin()
    or exists (
      select 1 from public.shops s
       where s.id = seller_faqs.shop_id and s.owner_id = auth.uid()
    )
  ) with check (
    public.is_admin()
    or exists (
      select 1 from public.shops s
       where s.id = seller_faqs.shop_id and s.owner_id = auth.uid()
    )
  );

-- The owning seller deletes their own FAQs.
drop policy if exists seller_faqs_owner_delete on public.seller_faqs;
create policy seller_faqs_owner_delete on public.seller_faqs
  for delete using (
    public.is_admin()
    or exists (
      select 1 from public.shops s
       where s.id = seller_faqs.shop_id and s.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- The FAQs the AI reply should be given, as one text block.
--
-- Returns the shop's FAQs formatted for a prompt, newest ordering by
-- `sort_order`. Returns an empty string when the shop has none, so the
-- caller can append it unconditionally.
--
-- SECURITY DEFINER so the reply path reads the same rows regardless of
-- which session triggered it, and so the formatting lives in one place
-- rather than being re-derived in TypeScript.
-- ---------------------------------------------------------------------
create or replace function public.shop_faq_prompt(p_shop_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    string_agg(
      'Q: ' || btrim(f.question) || E'\nA: ' || btrim(f.answer),
      E'\n\n'
      order by f.sort_order, f.created_at
    ),
    ''
  )
  from public.seller_faqs f
  where f.shop_id = p_shop_id;
$$;

grant execute on function public.shop_faq_prompt(uuid) to authenticated;
