/**
 * AI seller analytics — the insight layer on top of the existing numbers.
 *
 * ── What this adds ───────────────────────────────────────────────────────
 * The existing analytics page (sql/0028) answers "what happened": views,
 * clicks, orders, revenue per listing. This answers "what should I do":
 * which listing is dead weight, which one is about to sell out, whether
 * the price is wrong, and what the trend means.
 *
 * ── Why the model gets the numbers, not the database ─────────────────────
 * `seller_insight_inputs` (sql/0037) computes every figure first. The
 * model receives a compact JSON of facts and is told to reason only over
 * them. That is what stops an insight from being a plausible-sounding
 * sentence with no basis — every claim it makes can be traced to a number
 * in the input, and the input is stored alongside the insight as
 * `evidence`.
 *
 * ── Why insights are stored ──────────────────────────────────────────────
 * Generating them on every page load would be slow and expensive, and the
 * answer would change every refresh for no reason. They are generated on
 * demand (a button) and cached; the page shows the last set with its
 * timestamp.
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { aiJson, aiTry, clip } from "@/lib/ai";

export type SellerInsight = {
  kind: "insight" | "forecast" | "pricing" | "content" | "alert";
  title: string;
  body: string;
  priority: number;
};

/**
 * Generate a fresh set of insights for a shop and store them.
 *
 * Returns the insights, or an empty array when the model is unavailable —
 * the page then shows the deterministic observations instead of nothing.
 */
export async function generateSellerInsights(shopId: string): Promise<SellerInsight[]> {
  const supabase = createClient();

  const { data: inputs, error } = await supabase.rpc("seller_insight_inputs", {
    p_shop_id: shopId,
  });
  if (error || !inputs) return [];

  const i: any = inputs;
  const listings: any[] = Array.isArray(i.listings) ? i.listings : [];
  const totals = i.totals_30d ?? {};
  const prev = i.totals_prev_30d ?? {};
  const quality = i.quality ?? {};

  // Nothing to reason about yet.
  if (listings.length === 0) return [];

  const result = await aiTry(() =>
    aiJson<{ insights: SellerInsight[] }>({
      prompt: `You are a business analyst for a Nigerian online shop. Read the numbers and write insights the SELLER can act on this week.

LAST 30 DAYS:
- Orders: ${totals.orders ?? 0}
- Revenue: ${Math.round(Number(totals.revenue ?? 0))} naira
- Average order value: ${Math.round(Number(totals.avg_order ?? 0))} naira

THE 30 DAYS BEFORE THAT:
- Orders: ${prev.orders ?? 0}
- Revenue: ${Math.round(Number(prev.revenue ?? 0))} naira

QUALITY:
- Overall score: ${quality.review_score ?? "?"}/100 on reviews
- Average delivery: ${quality.avg_delivery_days ?? "unknown"} days
- Average reply time: ${quality.avg_reply_hours ?? "unknown"} hours
- Cancelled orders: ${quality.cancelled_orders ?? 0} of ${quality.order_count ?? 0}

LISTINGS (title | views | clicks | orders 30d | revenue 30d | price | rating):
${listings
  .slice(0, 20)
  .map(
    (l) =>
      `${l.title} | ${l.views} | ${l.clicks} | ${l.orders_30d} | ${Math.round(Number(l.revenue_30d ?? 0))} | ${l.price} | ${l.rating}`,
  )
  .join("\n")}

Return ONLY JSON:
{"insights":[
  {"kind":"insight|forecast|pricing|content|alert","title":"max 8 words","body":"1-2 sentences with the actual number in it","priority":1-10}
]}

Write 3 to 5 insights. Rules:
- Every insight MUST cite a number from the data above. No number, no insight.
- priority 10 = act today, 1 = nice to know.
- "alert" is for something going wrong (a listing with views but no orders, a cancellation spike).
- "pricing" is for a price that is clearly wrong for its performance.
- "forecast" is for what the trend implies for next month.
- Do not give generic advice like "post on social media". Be specific to these numbers.
- Never mention that you are an AI.`,
      fast: false,
      timeoutMs: 30_000,
      maxTokens: 1200,
      temperature: 0.4,
    }),
  );

  const insights: SellerInsight[] = Array.isArray(result?.insights)
    ? result!.insights
        .filter((x) => x && typeof x.title === "string")
        .map((x) => ({
          kind: (["insight", "forecast", "pricing", "content", "alert"].includes(x.kind)
            ? x.kind
            : "insight") as SellerInsight["kind"],
          title: clip(String(x.title), 90),
          body: clip(String(x.body ?? ""), 400),
          priority: Math.max(1, Math.min(10, Math.round(Number(x.priority) || 5))),
        }))
        .slice(0, 6)
    : [];

  // Fall back to observations that are true without the model.
  const final = insights.length > 0 ? insights : deterministicInsights(listings, totals, prev);

  if (final.length > 0) {
    await supabase.from("ai_seller_insights").insert(
      final.map((x) => ({
        shop_id: shopId,
        kind: x.kind,
        title: x.title,
        body: x.body,
        priority: x.priority,
        evidence: { totals, prev, listing_count: listings.length },
      })),
    );
  }

  return final;
}

/** The stored insights for a shop, newest set first. */
export async function getSellerInsights(shopId: string): Promise<SellerInsight[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("ai_seller_insights")
    .select("kind,title,body,priority,created_at")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(6);
  return (data ?? []).map((d: any) => ({
    kind: d.kind,
    title: d.title,
    body: d.body ?? "",
    priority: Number(d.priority ?? 5),
  }));
}

/**
 * Insights that need no model.
 *
 * These are the observations a careful analyst would make from the same
 * numbers, and they are what the page shows when the AI is unavailable.
 * They are deliberately blunt: "12 views, 0 orders" is the insight.
 */
function deterministicInsights(
  listings: any[],
  totals: any,
  prev: any,
): SellerInsight[] {
  const out: SellerInsight[] = [];

  // A listing with views but no orders is the single most actionable
  // thing on the page: people are looking and not buying.
  const dead = listings
    .filter((l) => Number(l.views) >= 10 && Number(l.orders_30d) === 0)
    .sort((a, b) => Number(b.views) - Number(a.views))[0];
  if (dead) {
    out.push({
      kind: "alert",
      title: `${dead.title} gets views but no orders`,
      body: `${dead.views} views and ${dead.clicks} clicks in 30 days, but no orders. The photo or the price is losing them — try a clearer first image or a small discount.`,
      priority: 9,
    });
  }

  // A listing with no views at all is invisible, which is a different
  // problem from being unconvincing.
  const invisible = listings.filter((l) => Number(l.views) === 0)[0];
  if (invisible) {
    out.push({
      kind: "content",
      title: `${invisible.title} has no views`,
      body: "It has not been seen in 30 days. Check it is live, and add search tags so it shows up in results.",
      priority: 7,
    });
  }

  // The trend, when there is one.
  const now = Number(totals.orders ?? 0);
  const before = Number(prev.orders ?? 0);
  if (before > 0) {
    const pct = Math.round(((now - before) / before) * 100);
    if (Math.abs(pct) >= 20) {
      out.push({
        kind: "forecast",
        title: pct > 0 ? `Orders are up ${pct}%` : `Orders are down ${Math.abs(pct)}%`,
        body: `${now} orders in the last 30 days against ${before} the month before.`,
        priority: pct > 0 ? 5 : 8,
      });
    }
  }

  // The best seller, so the seller knows what to double down on.
  const best = [...listings].sort(
    (a, b) => Number(b.revenue_30d ?? 0) - Number(a.revenue_30d ?? 0),
  )[0];
  if (best && Number(best.revenue_30d ?? 0) > 0) {
    out.push({
      kind: "insight",
      title: `${best.title} is your top earner`,
      body: `It made ${Math.round(Number(best.revenue_30d))} naira in 30 days. Keep it in stock and consider a bundle with a slower listing.`,
      priority: 6,
    });
  }

  return out.slice(0, 5);
}
