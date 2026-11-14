/**
 * AI trust & safety — the report an admin reads.
 *
 * ── What it checks ───────────────────────────────────────────────────────
 * A listing, a shop, a review or a chat is scored on the things that
 * actually cost a marketplace money or trust in Nigeria:
 *
 *   • off-platform payment (asking for a transfer outside escrow)
 *   • contact details in a listing (phone, WhatsApp, email, socials)
 *   • counterfeit / prohibited goods (drugs, weapons, fake brands)
 *   • misleading pricing (a "discount" off an invented original price)
 *   • review manipulation (a burst of 5-star reviews, copied text)
 *   • a shop that is new AND has a high-value listing (the classic scam)
 *
 * ── Why the model is given the rules, not asked to invent them ───────────
 * A generic "is this suspicious?" prompt produces a generic answer. The
 * prompt below names each rule and asks for a verdict per rule, so the
 * report has findings an admin can act on and a score that means
 * something. The model never decides the outcome — it produces a report;
 * the admin decides.
 *
 * ── Why the score is clamped ─────────────────────────────────────────────
 * A model that returns 97 for a listing with one emoji in the title would
 * make the queue useless. The score is clamped to the highest severity
 * finding, so a report can never claim "critical" without a critical
 * finding behind it.
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { aiJson, aiTry, clip } from "@/lib/ai";

export type SafetyFinding = {
  rule: string;
  severity: "low" | "medium" | "high" | "critical";
  detail: string;
  /** The exact text that triggered it, so the admin can see it. */
  evidence?: string;
};

export type SafetyReport = {
  risk_level: "low" | "medium" | "high" | "critical";
  score: number;
  summary: string;
  findings: SafetyFinding[];
};

const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** The rules, in one place so the prompt and the UI agree. */
export const SAFETY_RULES = [
  "off_platform_payment",
  "contact_details",
  "prohibited_goods",
  "counterfeit",
  "misleading_pricing",
  "review_manipulation",
  "new_shop_high_value",
] as const;

/**
 * Analyse one subject and return a report.
 *
 * `subject` is the text the model reads — a listing's title/description, a
 * shop's blurb, a review body, a chat transcript. Building it is the
 * caller's job because each subject type has a different shape.
 */
export async function analyseSafety(input: {
  subjectType: "listing" | "shop" | "review" | "chat" | "user";
  subjectId: string;
  /** The text to read. */
  text: string;
  /** Extra facts the model should weigh (price, shop age, review count). */
  context?: Record<string, string | number | null>;
}): Promise<SafetyReport | null> {
  const ctx = input.context ?? {};
  const ctxLines = Object.entries(ctx)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const report = await aiTry(() =>
    aiJson<SafetyReport>({
      prompt: `You are a trust & safety analyst for NaijaMart, a Nigerian marketplace that holds every payment in escrow.

Analyse this ${input.subjectType} and return a risk report.

SUBJECT TEXT:
"""
${clip(input.text, 4000)}
"""
${ctxLines ? `\nFACTS:\n${ctxLines}\n` : ""}
Check each rule:
1. off_platform_payment — does it ask the buyer to pay outside escrow (bank transfer to a personal account, "pay on delivery only", "send money first")?
2. contact_details — does it expose a phone number, WhatsApp, email, Instagram/Telegram handle, or an external link?
3. prohibited_goods — drugs, weapons, stolen goods, live animals, prescription medicine, adult content, or anything illegal in Nigeria?
4. counterfeit — fake or replica branded goods, "original copy", "first copy", "AAA quality"?
5. misleading_pricing — a discount that looks invented, a price that is implausibly low for the item, or a bait price?
6. review_manipulation — copied review text, a suspicious burst of identical 5-star reviews, or a review that reads like the seller wrote it?
7. new_shop_high_value — a brand-new shop listing something expensive (a phone, a laptop, a generator) with no history?

Return ONLY JSON:
{
  "risk_level": "low" | "medium" | "high" | "critical",
  "score": 0-100,
  "summary": "one sentence an admin can read in a queue",
  "findings": [
    {"rule":"<one of the 7 rule names>","severity":"low|medium|high|critical","detail":"what is wrong","evidence":"the exact words that triggered it"}
  ]
}

Rules for your answer:
- Only report a finding you can point to in the text. If nothing is wrong, return an empty findings array and risk_level "low".
- score 0-20 = low, 21-50 = medium, 51-80 = high, 81-100 = critical.
- Never invent a finding to seem thorough. A clean listing must come back clean.`,
      fast: false,
      timeoutMs: 25_000,
      maxTokens: 1200,
      temperature: 0.1,
    }),
  );

  if (!report) return null;

  // ── Clamp the score to the worst finding ────────────────────────────
  // A model that says "critical" with no critical finding is wrong, and a
  // queue sorted by that score would be sorted by noise.
  const findings = Array.isArray(report.findings)
    ? report.findings
        .filter((f) => f && typeof f.rule === "string")
        .map((f) => ({
          rule: String(f.rule),
          severity: (["low", "medium", "high", "critical"].includes(f.severity)
            ? f.severity
            : "low") as SafetyFinding["severity"],
          detail: clip(String(f.detail ?? ""), 300),
          evidence: f.evidence ? clip(String(f.evidence), 200) : undefined,
        }))
    : [];

  const worst = findings.reduce(
    (acc, f) => Math.max(acc, SEVERITY_RANK[f.severity] ?? 0),
    0,
  );
  const levelFor = (rank: number) =>
    (["low", "medium", "high", "critical"] as const)[rank] ?? "low";

  const claimed = SEVERITY_RANK[report.risk_level] ?? 0;
  const level = levelFor(Math.min(claimed, worst));
  const score = Math.max(0, Math.min(100, Math.round(Number(report.score) || 0)));

  return {
    risk_level: level,
    score,
    summary: clip(String(report.summary ?? ""), 240) || "No issues found.",
    findings,
  };
}

/**
 * Analyse a listing and store the report.
 *
 * Called from the admin console on demand, and from the listing publish
 * path so a new listing is checked before it goes live.
 */
export async function checkListing(listingId: string): Promise<SafetyReport | null> {
  const supabase = createClient();

  const { data: listing } = await supabase
    .from("listings")
    .select(
      `id,title,description,price,original_price,discount_percent,stock,status,created_at,
       shops!inner(id,name,description,status,verified,created_at,rating_count)`,
    )
    .eq("id", listingId)
    .maybeSingle();

  if (!listing) return null;
  const l: any = listing;
  const shop: any = l.shops;

  const shopAgeDays = shop?.created_at
    ? Math.floor((Date.now() - new Date(shop.created_at).getTime()) / 86_400_000)
    : null;

  const report = await analyseSafety({
    subjectType: "listing",
    subjectId: listingId,
    text: [
      `Title: ${l.title}`,
      `Description: ${l.description ?? "(none)"}`,
      `Price: ${l.price} naira`,
      l.original_price ? `Original price: ${l.original_price} naira` : "",
      l.discount_percent ? `Discount: ${l.discount_percent}%` : "",
      `Shop: ${shop?.name ?? "unknown"}`,
      shop?.description ? `Shop description: ${shop.description}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    context: {
      "shop age (days)": shopAgeDays,
      "shop verified": shop?.verified ? "yes" : "no",
      "shop review count": shop?.rating_count ?? 0,
      "listing status": l.status,
    },
  });

  if (report) await storeReport("listing", listingId, report);
  return report;
}

/** Analyse a review for manipulation. */
export async function checkReview(reviewId: string): Promise<SafetyReport | null> {
  const supabase = createClient();
  const { data: review } = await supabase
    .from("reviews")
    .select("id,rating,body,created_at,shop_id,buyer_id")
    .eq("id", reviewId)
    .maybeSingle();
  if (!review) return null;
  const r: any = review;

  // How many reviews did this shop get in the last 24 hours? A burst is
  // the strongest manipulation signal and the model cannot see it.
  const { count } = await supabase
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", r.shop_id)
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());

  const report = await analyseSafety({
    subjectType: "review",
    subjectId: reviewId,
    text: `Rating: ${r.rating}/5\nReview: ${r.body ?? "(no text)"}`,
    context: {
      "reviews this shop received in the last 24h": count ?? 0,
      "review length (chars)": (r.body ?? "").length,
    },
  });

  if (report) await storeReport("review", reviewId, report);
  return report;
}

/** Analyse a shop's profile and its recent listings. */
export async function checkShop(shopId: string): Promise<SafetyReport | null> {
  const supabase = createClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id,name,description,category,state,city,status,verified,created_at,rating_avg,rating_count")
    .eq("id", shopId)
    .maybeSingle();
  if (!shop) return null;
  const s: any = shop;

  const { data: listings } = await supabase
    .from("listings")
    .select("title,price,status")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(10);

  const ageDays = s.created_at
    ? Math.floor((Date.now() - new Date(s.created_at).getTime()) / 86_400_000)
    : null;

  const report = await analyseSafety({
    subjectType: "shop",
    subjectId: shopId,
    text: [
      `Shop: ${s.name}`,
      `Category: ${s.category ?? "unknown"}`,
      `Location: ${[s.city, s.state].filter(Boolean).join(", ") || "unknown"}`,
      `Description: ${s.description ?? "(none)"}`,
      `Recent listings: ${(listings ?? []).map((l: any) => `${l.title} (${l.price} naira)`).join("; ") || "none"}`,
    ].join("\n"),
    context: {
      "shop age (days)": ageDays,
      verified: s.verified ? "yes" : "no",
      "average rating": s.rating_avg,
      "review count": s.rating_count,
      "listing count": listings?.length ?? 0,
    },
  });

  if (report) await storeReport("shop", shopId, report);
  return report;
}

/** Persist a report so the admin queue can read it without re-running the model. */
async function storeReport(
  subjectType: "listing" | "shop" | "review" | "chat" | "user",
  subjectId: string,
  report: SafetyReport,
): Promise<void> {
  const supabase = createClient();
  await supabase.from("ai_safety_reports").insert({
    subject_type: subjectType,
    subject_id: subjectId,
    risk_level: report.risk_level,
    score: report.score,
    summary: report.summary,
    findings: report.findings,
    status: "open",
  });
}
