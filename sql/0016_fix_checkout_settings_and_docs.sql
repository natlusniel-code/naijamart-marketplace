-- 0016 — Fix the checkout "I have paid" failure, and make seller documents
--        compulsory at the database level.
--
-- ── The bug this fixes ──────────────────────────────────────────────────────
-- `place_order()` (and `checkout_range()`) read
-- `platform_settings.cross_lga_min_total`:
--
--     v_min := coalesce(v_cfg.cross_lga_min_total, 20000);
--
-- sql/0011 was supposed to add that column:
--
--     alter table public.platform_settings
--       add column if not exists cross_lga_min_total numeric(12,2) not null default 20000;
--
-- but on the live project the column is NOT there — `platform_settings` has
-- only 11 columns and none of them is `cross_lga_min_total`. The functions
-- were created, the ALTER was not (or was rolled back), so every call to
-- `place_order` died at that line with:
--
--     ERROR 42703: column v_cfg.cross_lga_min_total does not exist
--
-- PostgREST surfaces that as a 400 with a `code` field, which is exactly the
-- "error code message" the buyer saw when tapping "I have paid". Nothing was
-- wrong with the cart, the receipt upload or the RLS — the order could never
-- be inserted because the function threw before it got that far.
--
-- This migration is idempotent: it adds the column only if it is missing, and
-- re-creates the two functions from sql/0011 unchanged so a project that has
-- the column but an older function body is brought up to date too.
--
-- ── Documents ───────────────────────────────────────────────────────────────
-- Seller verification documents (NIN / ID / driver's licence / voter's card)
-- are now compulsory. The app enforces it in the onboarding form; this adds a
-- database guard so a shop cannot be marked `approved` with no document on
-- file, whatever path wrote the row.

-- ── 1. The missing column ───────────────────────────────────────────────────
alter table public.platform_settings
  add column if not exists cross_lga_min_total numeric(12,2) not null default 20000;

-- Backfill the single settings row if it somehow ended up null.
update public.platform_settings
   set cross_lga_min_total = 20000
 where cross_lga_min_total is null;

comment on column public.platform_settings.cross_lga_min_total is
  'Order total above which a buyer may order from any LGA in their own state. At or below it, the seller must be in the buyer''s own LGA. Read by place_order() and checkout_range().';

-- ── 2. Re-create the two functions that read it ────────────────────────────
-- Bodies are copied verbatim from sql/0011 so this file is the single place to
-- look when the checkout rules change. `create or replace` keeps the existing
-- grants and ownership.

create or replace function public.checkout_range(p_shop_id uuid)
returns table (
  same_state boolean,
  same_lga   boolean,
  min_total  numeric,
  allowed    boolean,
  reason     text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_shop  public.shops;
  v_buyer public.profiles;
  v_min   numeric(12,2);
  v_same_state boolean;
  v_same_lga   boolean;
begin
  select * into v_shop from public.shops where id = p_shop_id;
  if not found then
    return query select false, false, 0::numeric, false, 'That shop no longer exists.'::text;
    return;
  end if;

  select * into v_buyer from public.profiles where id = v_uid;

  select coalesce(cross_lga_min_total, 20000) into v_min
    from public.platform_settings where id = 1;
  if v_min is null then v_min := 20000; end if;

  v_same_state := (v_buyer.state is null or v_shop.state is null
                   or lower(btrim(v_buyer.state)) = lower(btrim(v_shop.state)));
  v_same_lga   := (v_buyer.city is null or v_shop.city is null
                   or lower(btrim(v_buyer.city)) = lower(btrim(v_shop.city)));

  return query select
    v_same_state,
    v_same_lga,
    v_min,
    (v_same_state and v_same_lga),
    case
      when v_same_state and v_same_lga then null
      when v_same_state then format(
        'This seller is in %s, outside your LGA (%s). Orders under %s can only be placed with sellers in your own LGA.',
        coalesce(v_shop.city, v_shop.state, 'another area'),
        coalesce(v_buyer.city, 'not set'),
        to_char(v_min, 'FM999,999,999'))
      else format(
        'This seller is in %s state. Orders over %s can be delivered to any LGA in your own state (%s), but not outside it.',
        coalesce(v_shop.state, 'another'),
        to_char(v_min, 'FM999,999,999'),
        coalesce(v_buyer.state, 'your state'))
    end;
end $function$;

-- ── 3. Documents must exist before a shop can be approved ──────────────────
-- A CHECK constraint would fail on the two existing approved shops, which have
-- no documents on file (they were onboarded before this rule). A trigger that
-- only fires on the transition into `approved` leaves those rows alone and
-- blocks every future approval without a document.
create or replace function public.tg_shops_require_documents()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'approved'
     and (old.status is distinct from 'approved')
     and coalesce(jsonb_array_length(coalesce(new.documents, '[]'::jsonb)), 0) = 0 then
    raise exception
      'A shop needs at least one verification document (NIN, ID, driver''s licence or voter''s card) before it can be approved.'
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;

drop trigger if exists shops_require_documents on public.shops;
create trigger shops_require_documents
  before update of status on public.shops
  for each row execute function public.tg_shops_require_documents();

-- ── 4. Verify ──────────────────────────────────────────────────────────────
-- Run this after applying; both rows should come back true.
--
--   select
--     exists (select 1 from information_schema.columns
--              where table_schema='public' and table_name='platform_settings'
--                and column_name='cross_lga_min_total')            as has_column,
--     (select cross_lga_min_total from public.platform_settings
--       where id=1) is not null                                    as has_value;
