-- =====================================================================
-- 0037 — SELLER QUALITY METRICS + AI INSIGHT INPUTS
-- =====================================================================
-- The numbers behind the AI quality score and the AI seller insights.
--
-- ── Why these are SQL and not model output ───────────────────────────
-- Reply time, delivery time, cancellation rate and dispute rate are
-- facts. A model asked to "estimate" them would produce a number nobody
-- can check, and a seller told "your delivery is slow" with no figure
-- behind it has no way to act. So the facts are computed here, and the
-- model only writes the sentences around them.
--
-- ── Why one function returns everything ──────────────────────────────
-- The quality page and the insights page need the same numbers. Two
-- functions would drift; one function with a stable shape means the score
-- and the insight can never disagree about how many orders a shop had.
-- =====================================================================

create or replace function public.seller_quality_metrics(p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_orders        int := 0;
  v_delivered     int := 0;
  v_cancelled     int := 0;
  v_disputed      int := 0;
  v_review_count  int := 0;
  v_rating_avg    numeric := 0;
  v_avg_delivery  numeric;
  v_avg_reply     numeric;
  v_recent        jsonb;
  v_review_score  numeric := 0;
  v_delivery_score numeric := 0;
  v_response_score numeric := 0;
  v_reliability   numeric := 0;
begin
  -- ── order counts ──────────────────────────────────────────────────
  select
    count(*),
    count(*) filter (where status in ('delivered','completed')),
    count(*) filter (where status = 'cancelled'),
    count(*) filter (where status = 'disputed')
  into v_orders, v_delivered, v_cancelled, v_disputed
  from public.orders
  where shop_id = p_shop_id;

  -- ── reviews ───────────────────────────────────────────────────────
  select count(*), coalesce(avg(rating), 0)
  into v_review_count, v_rating_avg
  from public.reviews
  where shop_id = p_shop_id
    and status = 'published';

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_recent
  from (
    select rating, body, created_at
      from public.reviews
     where shop_id = p_shop_id
       and status = 'published'
     order by created_at desc
     limit 20
  ) x;

  -- ── average delivery time ─────────────────────────────────────────
  -- From acceptance to delivery, in days. Only delivered orders count:
  -- an order still in flight has no delivery time yet.
  select avg(extract(epoch from (delivered_at - accepted_at)) / 86400.0)
  into v_avg_delivery
  from public.orders
  where shop_id = p_shop_id
    and delivered_at is not null
    and accepted_at is not null;

  -- ── average reply time ────────────────────────────────────────────
  -- For each buyer message, how long until the seller's next message in
  -- the same chat. This is the number that actually predicts a sale.
  select avg(extract(epoch from (reply_at - msg_at)) / 3600.0)
  into v_avg_reply
  from (
    select
      m.created_at as msg_at,
      (
        select min(s.created_at)
          from public.messages s
         where s.chat_id = m.chat_id
           and s.sender_id <> m.sender_id
           and s.created_at > m.created_at
      ) as reply_at
    from public.messages m
    join public.chats c on c.id = m.chat_id
    where c.shop_id = p_shop_id
      and m.sender_id = c.buyer_id
  ) t
  where reply_at is not null;

  -- ── the four component scores, 0-100 ──────────────────────────────
  -- Reviews: the star average, scaled. 4.5 stars = 90.
  v_review_score := least(100, greatest(0, (v_rating_avg / 5.0) * 100));

  -- Delivery: 1 day = 100, 7 days = 40, 14+ days = 0.
  v_delivery_score := case
    when v_avg_delivery is null then 60          -- no data: neutral, not zero
    when v_avg_delivery <= 1 then 100
    when v_avg_delivery >= 14 then 0
    else 100 - ((v_avg_delivery - 1) / 13.0 * 100)
  end;

  -- Response: under 1 hour = 100, 24 hours = 40, 72+ hours = 0.
  v_response_score := case
    when v_avg_reply is null then 60             -- no data: neutral
    when v_avg_reply <= 1 then 100
    when v_avg_reply >= 72 then 0
    else 100 - ((v_avg_reply - 1) / 71.0 * 100)
  end;

  -- Reliability: start at 100, subtract for cancellations and disputes.
  v_reliability := case
    when v_orders = 0 then 60                    -- no data: neutral
    else greatest(0, 100
      - (v_cancelled::numeric / v_orders * 100)
      - (v_disputed::numeric / v_orders * 150))
  end;

  return jsonb_build_object(
    'order_count',      v_orders,
    'delivered_orders', v_delivered,
    'cancelled_orders', v_cancelled,
    'disputed_orders',  v_disputed,
    'review_count',     v_review_count,
    'rating_avg',       round(v_rating_avg, 2),
    'avg_delivery_days', round(v_avg_delivery, 1),
    'avg_reply_hours',   round(v_avg_reply, 1),
    'review_score',      round(v_review_score),
    'delivery_score',    round(v_delivery_score),
    'response_score',    round(v_response_score),
    'reliability_score', round(v_reliability),
    'recent_reviews',    v_recent
  );
end $$;

grant execute on function public.seller_quality_metrics(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- SELLER AI INSIGHT INPUTS
-- ---------------------------------------------------------------------
-- The numbers the AI seller analytics reasons over. Deliberately the same
-- shape as `seller_analytics` (sql/0028) plus the trend and the quality
-- metrics, so an insight can say "views are up 40% but orders are flat"
-- and be right.
create or replace function public.seller_insight_inputs(p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_listings   jsonb;
  v_totals     jsonb;
  v_prev       jsonb;
  v_quality    jsonb;
  v_top_cats   jsonb;
begin
  -- Per-listing performance, last 30 days.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_listings
  from (
    select
      l.id,
      l.title,
      l.type,
      l.price,
      l.status,
      coalesce(l.views, 0) as views,
      coalesce(l.clicks, 0) as clicks,
      coalesce(l.rating_avg, 0) as rating,
      coalesce(l.rating_count, 0) as rating_count,
      (select count(*) from public.order_items oi
        join public.orders o on o.id = oi.order_id
       where oi.listing_id = l.id
         and o.created_at > now() - interval '30 days') as orders_30d,
      (select coalesce(sum(oi.line_total), 0) from public.order_items oi
        join public.orders o on o.id = oi.order_id
       where oi.listing_id = l.id
         and o.status in ('delivered','completed')
         and o.created_at > now() - interval '30 days') as revenue_30d
    from public.listings l
    where l.shop_id = p_shop_id
    order by l.views desc
    limit 30
  ) x;

  -- Shop totals, last 30 days.
  select jsonb_build_object(
    'orders',   count(*),
    'revenue',  coalesce(sum(total) filter (where status in ('delivered','completed')), 0),
    'avg_order', coalesce(avg(total), 0)
  ) into v_totals
  from public.orders
  where shop_id = p_shop_id
    and created_at > now() - interval '30 days';

  -- The same totals for the 30 days before, so a trend is possible.
  select jsonb_build_object(
    'orders',  count(*),
    'revenue', coalesce(sum(total) filter (where status in ('delivered','completed')), 0)
  ) into v_prev
  from public.orders
  where shop_id = p_shop_id
    and created_at between now() - interval '60 days' and now() - interval '30 days';

  v_quality := public.seller_quality_metrics(p_shop_id);

  -- What buyers actually search for that this shop could serve.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_top_cats
  from (
    select c.name, count(*) as n
      from public.listings l
      join public.categories c on c.id = l.category_id
     where l.shop_id = p_shop_id
     group by c.name
     order by n desc
     limit 5
  ) x;

  return jsonb_build_object(
    'listings', v_listings,
    'totals_30d', v_totals,
    'totals_prev_30d', v_prev,
    'quality', v_quality,
    'categories', v_top_cats
  );
end $$;

grant execute on function public.seller_insight_inputs(uuid) to authenticated;
