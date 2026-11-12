-- =====================================================================
-- 0020 — paginated gig storefront
-- =====================================================================
--
-- Run AFTER 0019. Idempotent: safe to run more than once.
--
-- WHY
--
-- The blueprint puts the service listing on its own sub page with
-- "Page 1 / Page 2 / Page 3 / >" pagination down the left margin. The
-- existing `storefront_feed` could only return the first N rows, so a
-- second page was impossible without re-ranking from scratch and hoping
-- the order was stable.
--
-- Two changes:
--
--   1. `storefront_feed` gains `p_offset`. The round-robin interleave is
--      computed over the whole eligible set and then sliced, so page 2 is
--      genuinely the next slice of the same ranking — not a fresh shuffle
--      that repeats page 1's cards.
--
--   2. `storefront_feed_count` returns how many listings are eligible, so
--      the UI can render the right number of page links without fetching
--      every row.
--
-- The ranking rules themselves are unchanged and still shared with
-- products: new (3-day window), rated, selling, popular, each jittered by
-- the daily seed so the feed rotates.
-- =====================================================================

-- The five-argument version is dropped rather than left behind: two
-- functions with the same name and different rules is how the UI and the
-- server drift apart.
drop function if exists public.storefront_feed(text, text, int, text, text);

create or replace function public.storefront_feed(
  p_city         text default null,
  p_type         text default 'product',
  p_limit        int  default 8,
  p_seed         text default null,
  p_service_mode text default null,
  p_offset       int  default 0
)
returns table (id uuid, bucket text, rank_score numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_seed text := coalesce(nullif(btrim(p_seed), ''), to_char(now(), 'YYYY-MM-DD'));
  v_lim  int  := greatest(coalesce(p_limit, 8), 1);
  v_off  int  := greatest(coalesce(p_offset, 0), 0);
  -- Each bucket must be able to fill everything up to the end of the
  -- requested page, otherwise page 2 would come back short.
  v_cap  int  := v_off + v_lim;
begin
  return query
  with eligible as (
    select
      l.id,
      l.created_at,
      l.views,
      coalesce(s.rating_avg, 0)     as rating_avg,
      coalesce(s.rating_count, 0)   as rating_count,
      coalesce(sales.units_sold, 0) as units_sold,
      (
        (('x' || substr(md5(l.id::text || v_seed), 1, 8))::bit(32)::int
          & 2147483647) % 1000
      ) / 1000.0 as jitter
    from public.listings l
    join public.shops s on s.id = l.shop_id
    left join public.listing_sales sales on sales.listing_id = l.id
    where l.status = 'live'
      and s.status = 'approved'
      and (p_type is null or l.type = p_type)
      and (p_service_mode is null or l.service_mode = p_service_mode)
      and (
        p_city is null
        or btrim(p_city) = ''
        or s.city = btrim(p_city)
        -- An online service has no coverage area, so a city filter must
        -- never hide it.
        or (l.type = 'service' and l.service_mode = 'online')
      )
  ),
  scored as (
    select e.id, 'new'::text as bucket,
           (case when e.created_at > now() - interval '3 days' then 10.0 else 0 end
            + e.jitter)::numeric as rank_score
      from eligible e
     where e.created_at > now() - interval '3 days'

    union all
    select e.id, 'rated'::text,
           (e.rating_avg * 2.0 + least(e.rating_count, 20) * 0.1 + e.jitter)::numeric
      from eligible e
     where e.rating_avg >= 4.0 and e.rating_count >= 1

    union all
    select e.id, 'selling'::text,
           (least(ln(1 + e.units_sold), 4.0) * 2.5 + e.jitter)::numeric
      from eligible e
     where e.units_sold > 0

    union all
    select e.id, 'popular'::text,
           (least(ln(1 + e.views), 5.0) + e.jitter)::numeric
      from eligible e
  ),
  -- One row per listing even if it qualifies for several buckets: the
  -- strongest bucket wins, so the round-robin cannot show it twice.
  best as (
    select distinct on (s.id) s.id, s.bucket, s.rank_score
      from scored s
     order by s.id, s.rank_score desc
  ),
  ranked as (
    select b.id, b.bucket, b.rank_score,
           row_number() over (
             partition by b.bucket
             order by b.rank_score desc, b.id
           ) as rn
      from best b
  )
  select r.id, r.bucket, r.rank_score
    from ranked r
   where r.rn <= v_cap
   order by
     r.rn,
     -- Rotate which bucket leads, so the first card is not always "new".
     ((case r.bucket when 'new' then 0 when 'rated' then 1
                     when 'selling' then 2 else 3 end)
       + (('x' || substr(md5(v_seed), 1, 8))::bit(32)::int & 3)) % 4
   limit v_lim
  offset v_off;
end $$;

grant execute on function public.storefront_feed(text, text, int, text, text, int)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- How many listings the feed could show, for the page links
-- ---------------------------------------------------------------------
-- Same eligibility rules as `storefront_feed`, so the page count can never
-- disagree with the rows. Kept as its own function rather than a second
-- return column because a count is needed before the first page is
-- fetched, and repeating it on every row would be wasteful.
create or replace function public.storefront_feed_count(
  p_city         text default null,
  p_type         text default 'product',
  p_service_mode text default null
)
returns int
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::int
    from public.listings l
    join public.shops s on s.id = l.shop_id
   where l.status = 'live'
     and s.status = 'approved'
     and (p_type is null or l.type = p_type)
     and (p_service_mode is null or l.service_mode = p_service_mode)
     and (
       p_city is null
       or btrim(p_city) = ''
       or s.city = btrim(p_city)
       or (l.type = 'service' and l.service_mode = 'online')
     );
$$;

grant execute on function public.storefront_feed_count(text, text, text)
  to anon, authenticated;
