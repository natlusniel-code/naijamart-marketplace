/**
 * AI product recommendations for buyers.
 *
 * ── The shape of the problem ─────────────────────────────────────────────
 * A recommendation is only as good as the signals behind it, and the
 * signals live in six different places: what the buyer viewed, what they
 * searched for, what is in their cart, where they are, what they can
 * afford, and what they have bought before. Gathering those in the browser
 * would mean six round trips and shipping other people's data to the
 * client. So the gathering happens in one SQL function
 * (`buyer_recommendation_signals`, sql/0035) and this module only ranks.
 *
 * ── Why the AI ranks and does not choose ─────────────────────────────────
 * The candidate set is already filtered to live listings the buyer can
 * actually receive (same state, or nationwide over the threshold). The
 * model's job is to order that set and say WHY each one is there — it is
 * never allowed to invent a listing id. Every id it returns is checked
 * against the candidate set before it is used, so a hallucinated id is
 * dropped rather than rendered as a broken card.
 *
 * ── Why there is a fallback ──────────────────────────────────────────────
 * If the model is down, rate limited or slow, the buyer still gets a
 * sensible grid: the candidates are already ordered by a deterministic
 * score (category affinity, price fit, rating, recency). The AI improves
 * the order; it is not required for the feature to work.
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { aiJson, aiTry, clip } from "@/lib/ai";
import type { Listing } from "@/lib/queries";

export type Recommendation = {
  listing: Listing;
  /** Why this is here, in the buyer's language. */
  reason: string;
  score: number;
};

type Candidate = {
  id: string;
  title: string;
  category: string | null;
  price: number;
  rating: number;
  city: string | null;
  state: string | null;
  type: string;
  /** Deterministic pre-score from SQL, 0-100. */
  base_score: number;
  /** Which signal put it in the set. */
  signal: string;
};

type Signals = {
  viewed: { title: string; category: string | null }[];
  searched: string[];
  cart: { title: string; category: string | null }[];
  bought: { title: string; category: string | null }[];
  city: string | null;
  state: string | null;
  /** Median price of what they have engaged with, or null. */
  budget: number | null;
  candidates: Candidate[];
};

/**
 * The buyer's signals plus a pre-scored candidate set.
 *
 * Returns null when the buyer is not signed in — an anonymous visitor has
 * no history to personalise from, and the storefront feed already handles
 * that case.
 */
export async function getRecommendationSignals(
  buyerId: string,
  cartIds: string[] = [],
): Promise<Signals | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("buyer_recommendation_signals", {
    p_buyer_id: buyerId,
    // The cart lives in localStorage, so the browser has to tell us. An
    // empty array is a valid signal ("nothing in the cart"), not a miss.
    p_cart_ids: cartIds,
    p_limit: 40,
  });
  if (error || !data) return null;
  return data as Signals;
}

/**
 * Rank the candidates with the model, then hydrate them into full listings.
 *
 * `limit` is small on purpose: a "picked for you" rail is 6-8 cards. Asking
 * for 40 and showing 8 wastes tokens and time.
 */
export async function getRecommendations(
  buyerId: string,
  limit = 8,
  cartIds: string[] = [],
): Promise<Recommendation[]> {
  const signals = await getRecommendationSignals(buyerId, cartIds);
  if (!signals || signals.candidates.length === 0) return [];

  const candidates = signals.candidates.slice(0, 30);
  const byId = new Map(candidates.map((c) => [c.id, c]));

  // ── Ask the model to order them ──────────────────────────────────────
  const ranked = await aiTry(async () => {
    const prompt = `You are a recommendation engine for NaijaMart, a Nigerian marketplace.

Buyer context:
- Location: ${[signals.city, signals.state].filter(Boolean).join(", ") || "unknown"}
- Recently viewed: ${signals.viewed.map((v) => v.title).slice(0, 6).join("; ") || "nothing yet"}
- Recent searches: ${signals.searched.slice(0, 6).join("; ") || "none"}
- In cart: ${signals.cart.map((c) => c.title).slice(0, 5).join("; ") || "empty"}
- Bought before: ${signals.bought.map((b) => b.title).slice(0, 5).join("; ") || "nothing yet"}
- Typical budget: ${signals.budget ? `about ${Math.round(signals.budget)} naira` : "unknown"}

Candidates (id | title | category | price | rating):
${candidates.map((c) => `${c.id} | ${c.title} | ${c.category ?? "uncategorised"} | ${c.price} | ${c.rating}`).join("\n")}

Pick the best ${limit} for THIS buyer and order them best-first. Use the signals: something related to what they viewed or searched for, within their budget, and available near them. Do not pick two near-identical items.

Return ONLY JSON:
{"picks":[{"id":"<exact id from the list>","reason":"<max 12 words, why this buyer, e.g. 'Similar to the generator you viewed'>"}]}

Every id MUST be copied exactly from the list above. Never invent an id.`;

    return aiJson<{ picks: { id: string; reason: string }[] }>({
      prompt,
      fast: true,
      timeoutMs: 9_000,
      maxTokens: 900,
      temperature: 0.4,
    });
  });

  // ── Keep only ids that really exist in the candidate set ─────────────
  const picks: { id: string; reason: string; score: number }[] = [];
  const seen = new Set<string>();

  if (ranked?.picks?.length) {
    for (const p of ranked.picks) {
      const id = String(p?.id ?? "").trim();
      if (!byId.has(id) || seen.has(id)) continue;
      seen.add(id);
      picks.push({
        id,
        reason: clip(String(p?.reason ?? ""), 90) || "Recommended for you",
        score: 1 - picks.length / Math.max(1, limit),
      });
      if (picks.length >= limit) break;
    }
  }

  // ── Top up from the deterministic order ──────────────────────────────
  // The model may return fewer than asked, or nothing at all. The SQL
  // pre-score is already a decent ranking, so fill the rest from it.
  if (picks.length < limit) {
    for (const c of candidates) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      picks.push({
        id: c.id,
        reason: fallbackReason(c, signals),
        score: Number(c.base_score ?? 0) / 100,
      });
      if (picks.length >= limit) break;
    }
  }

  if (picks.length === 0) return [];

  // ── Hydrate ──────────────────────────────────────────────────────────
  const supabase = createClient();
  const { data } = await supabase
    .from("listings")
    .select(
      `id,shop_id,type,title,description,category_id,tags,price,original_price,discount_percent,stock,images,status,service_area,needs_home_visit,service_mode,delivery_days,rating_avg,rating_count,delivery_fee_override,free_delivery_threshold,fulfilment_mode,shops!inner(id,name,slug,city,state,rating_avg,rating_count,verified,logo_url,kind),categories(name,icon,slug)`,
    )
    .in("id", picks.map((p) => p.id));

  const listingById = new Map((data ?? []).map((l: any) => [l.id, l as unknown as Listing]));

  return picks
    .map((p) => {
      const listing = listingById.get(p.id);
      return listing ? { listing, reason: p.reason, score: p.score } : null;
    })
    .filter(Boolean) as Recommendation[];
}

/**
 * A reason that is true without the model.
 *
 * Each branch names the signal that actually put the item in the set, so
 * the label is never a guess dressed up as personalisation.
 */
function fallbackReason(c: Candidate, s: Signals): string {
  if (c.signal === "cart") return "Goes with what's in your cart";
  if (c.signal === "search") return "Matches what you searched for";
  if (c.signal === "browse") return "Similar to what you viewed";
  if (c.signal === "history") return "Like what you bought before";
  if (c.signal === "location" && c.city) return `Popular in ${c.city}`;
  if (c.signal === "budget") return "Within your usual budget";
  if (Number(c.rating) >= 4.5) return "Highly rated by buyers";
  return "Recommended for you";
}

/**
 * Persist the picks so the next page load is instant.
 *
 * This is best-effort: a failed write must not fail the page, because the
 * recommendations were already computed and are about to be rendered.
 */
export async function saveRecommendations(
  buyerId: string,
  recs: Recommendation[],
): Promise<void> {
  if (recs.length === 0) return;
  const supabase = createClient();
  await supabase.from("ai_recommendations").upsert(
    recs.map((r) => ({
      buyer_id: buyerId,
      listing_id: r.listing.id,
      score: r.score,
      reason: r.reason,
      source: "browse",
    })),
    { onConflict: "buyer_id,listing_id" },
  );
}
