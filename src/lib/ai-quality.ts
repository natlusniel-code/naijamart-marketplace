/**
 * AI review analysis and seller-quality scoring.
 *
 * ── What this answers ────────────────────────────────────────────────────
 * A seller's star rating is one number that hides everything: a shop with
 * 4.6 stars might be excellent at delivery and terrible at replying, or
 * the reverse. This module reads the actual reviews and the actual
 * behaviour (reply time, delivery time, cancellation rate, dispute rate)
 * and produces a score with its components exposed, so the seller can see
 * WHY it moved and the admin can see who needs help.
 *
 * ── Why the components are computed in SQL, not by the model ─────────────
 * Reply time, delivery time and cancellation rate are facts. Asking a
 * model to estimate them would make the score unfalsifiable. So the
 * numbers come from `seller_quality_metrics` (sql/0037) and the model only
 * does the part it is good at: reading the review text and writing the
 * summary, the strengths, the risks and the actions.
 *
 * ── Why the score is a weighted sum, not the model's opinion ─────────────
 * A score that changes because the model felt different today is useless
 * for ranking or for a seller trying to improve. The weights are fixed and
 * visible; the model's contribution is the qualitative half.
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { aiJson, aiTry, clip } from "@/lib/ai";

export type QualityComponents = {
  /** 0-100 each. */
  reviews: number;
  delivery: number;
  response: number;
  reliability: number;
  /** How many reviews the score is based on — a 100 from 2 reviews is noise. */
  sample: number;
};

export type QualityAnalysis = {
  score: number;
  components: QualityComponents;
  summary: string;
  strengths: string[];
  risks: string[];
  actions: string[];
};

/**
 * The weights. They sum to 1.
 *
 * Reviews carry the most because they are what a buyer actually reads;
 * reliability (cancellations, disputes) carries the second most because a
 * shop that cancels orders costs the platform real money.
 */
const WEIGHTS = {
  reviews: 0.35,
  delivery: 0.2,
  response: 0.2,
  reliability: 0.25,
} as const;

/**
 * Analyse one shop and store the result.
 *
 * Returns null when the shop has no data at all — a brand-new shop with no
 * reviews and no orders should not be given a score of 0, which would read
 * as "bad" rather than "unknown".
 */
export async function analyseShopQuality(shopId: string): Promise<QualityAnalysis | null> {
  const supabase = createClient();

  const { data: metrics, error } = await supabase.rpc("seller_quality_metrics", {
    p_shop_id: shopId,
  });
  if (error || !metrics) return null;

  const m: any = metrics;
  const sample = Number(m.review_count ?? 0);

  // No reviews and no orders: nothing to score yet.
  if (sample === 0 && Number(m.order_count ?? 0) === 0) return null;

  const components: QualityComponents = {
    reviews: clamp(Number(m.review_score ?? 0)),
    delivery: clamp(Number(m.delivery_score ?? 0)),
    response: clamp(Number(m.response_score ?? 0)),
    reliability: clamp(Number(m.reliability_score ?? 0)),
    sample,
  };

  // The deterministic score. This is what is stored and ranked on.
  const score = Math.round(
    components.reviews * WEIGHTS.reviews +
      components.delivery * WEIGHTS.delivery +
      components.response * WEIGHTS.response +
      components.reliability * WEIGHTS.reliability,
  );

  // ── The qualitative half ────────────────────────────────────────────
  const reviews: { rating: number; body: string | null }[] = Array.isArray(m.recent_reviews)
    ? m.recent_reviews
    : [];

  const reviewText = reviews
    .filter((r) => r.body && r.body.trim())
    .slice(0, 20)
    .map((r) => `${r.rating}/5 — ${clip(r.body ?? "", 300)}`)
    .join("\n");

  const qualitative = await aiTry(() =>
    aiJson<{
      summary: string;
      strengths: string[];
      risks: string[];
      actions: string[];
    }>({
      prompt: `You are a marketplace quality analyst. Read this Nigerian shop's recent reviews and its operating numbers, then write a short, honest assessment for the SELLER.

OPERATING NUMBERS:
- Overall score: ${score}/100
- Reviews: ${components.reviews}/100 from ${sample} reviews
- Delivery: ${components.delivery}/100 (average ${m.avg_delivery_days ?? "unknown"} days)
- Response: ${components.response}/100 (average reply ${m.avg_reply_hours ?? "unknown"} hours)
- Reliability: ${components.reliability}/100 (${m.cancelled_orders ?? 0} cancelled, ${m.disputed_orders ?? 0} disputed of ${m.order_count ?? 0} orders)

RECENT REVIEWS:
"""
${reviewText || "(no written reviews yet)"}
"""

Return ONLY JSON:
{
  "summary": "2 sentences, plain English, no jargon, addressed to the seller",
  "strengths": ["up to 3 concrete things they do well"],
  "risks": ["up to 3 concrete things that are costing them sales"],
  "actions": ["up to 3 specific things to do this week"]
}

Rules:
- Base every point on the numbers or the review text above. Do not invent.
- If there is not enough data for a point, say less rather than guessing.
- Be direct but not harsh. This is read by the person running the shop.
- Never mention that you are an AI.`,
      fast: false,
      timeoutMs: 25_000,
      maxTokens: 900,
      temperature: 0.3,
    }),
  );

  const analysis: QualityAnalysis = {
    score,
    components,
    summary:
      clip(String(qualitative?.summary ?? ""), 400) ||
      defaultSummary(score, components),
    strengths: toList(qualitative?.strengths, 3),
    risks: toList(qualitative?.risks, 3),
    actions: toList(qualitative?.actions, 3),
  };

  await supabase.from("ai_quality_analyses").insert({
    shop_id: shopId,
    score: analysis.score,
    components: analysis.components,
    summary: analysis.summary,
    strengths: analysis.strengths,
    risks: analysis.risks,
    actions: analysis.actions,
  });

  return analysis;
}

/** The latest stored analysis, or null. */
export async function getLatestQuality(shopId: string): Promise<QualityAnalysis | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("ai_quality_analyses")
    .select("score,components,summary,strengths,risks,actions")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const d: any = data;
  return {
    score: Number(d.score ?? 0),
    components: d.components ?? { reviews: 0, delivery: 0, response: 0, reliability: 0, sample: 0 },
    summary: d.summary ?? "",
    strengths: Array.isArray(d.strengths) ? d.strengths : [],
    risks: Array.isArray(d.risks) ? d.risks : [],
    actions: Array.isArray(d.actions) ? d.actions : [],
  };
}

/* ------------------------------------------------------------------ utils */

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => clip(String(x ?? ""), 200))
    .filter(Boolean)
    .slice(0, max);
}

/** A summary that is true without the model. */
function defaultSummary(score: number, c: QualityComponents): string {
  if (score >= 80) return "Your shop is performing well across reviews, delivery and response time.";
  if (score >= 60) return "Your shop is solid, with one or two areas holding it back.";
  if (score >= 40) return "Your shop is underperforming on several measures buyers care about.";
  return "Your shop is struggling. The actions below are the fastest way to recover.";
}
