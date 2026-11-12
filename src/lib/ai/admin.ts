import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { askAI } from "./client";

/**
 * Admin AI — Part 2, all fifteen features.
 *
 * ── The admin rule, enforced in code ────────────────────────────────────────
 *   THE AI FLAGS. THE ADMIN DECIDES.
 *
 * Nothing in this file writes a ban, a refund, a payout or an approval. Every
 * function either returns a suggestion for display, or writes a row to
 * `ai_suggestions` with `status = 'open'` — which is a to-do for a human, not
 * an action. The only writes to business tables in the whole AI surface are
 * `ai_auto_approve_payment` and `ai_apply_identity_verdict`, both of which are
 * gated by the rules engine and both of which are logged.
 */

export type Flag = {
  title: string;
  detail: string;
  severity: "info" | "warn" | "high";
  evidence?: Record<string, unknown>;
};

/** Persist a flag for the admin queue. Best-effort. */
export async function recordSuggestion(opts: {
  feature: string;
  subjectType: string;
  subjectId?: string | null;
  flag: Flag;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from("ai_suggestions").insert({
      feature: opts.feature,
      subject_type: opts.subjectType,
      subject_id: opts.subjectId ?? null,
      severity: opts.flag.severity,
      title: opts.flag.title,
      detail: opts.flag.detail,
      evidence: opts.flag.evidence ?? {},
    });
  } catch {
    /* a failed flag must not break the page that produced it */
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Listing review assistant
// ─────────────────────────────────────────────────────────────────────────
export async function reviewListing(opts: {
  actorId: string;
  listing: {
    id: string;
    title: string;
    description: string | null;
    price: number;
    category: string | null;
    shop_name: string;
    images: string[];
  };
}): Promise<Flag[]> {
  const ai = await askAI<{ flags: Flag[] }>({
    feature: "listing_review",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Review a marketplace listing for problems a human should look at.

Look for: fake or misused brand names, implausible prices (far too low for the
product, a classic scam signal), prohibited items (weapons, drugs, counterfeit
goods, live animals, prescription medicine), stolen-looking stock photos, and
missing essential information.

Return JSON: { "flags": [ { "title": string, "detail": string, "severity": "info"|"warn"|"high", "evidence": {} } ] }

Return an empty array when the listing looks fine. Do not flag ordinary
informality, Nigerian English, or a low price that is plausible for a used item.
State the REASON for every flag — the admin must be able to judge it.`,
    input: opts.listing,
    inputSummary: `listing "${opts.listing.title}"`,
    inputRef: opts.listing.id,
    schemaHint: `{ flags: [{ title, detail, severity, evidence }] }`,
  });

  if (!ai.ok) return [];
  const flags = Array.isArray(ai.data.flags) ? ai.data.flags.slice(0, 6) : [];
  for (const f of flags) {
    await recordSuggestion({
      feature: "listing_review",
      subjectType: "listing",
      subjectId: opts.listing.id,
      flag: {
        title: String(f.title ?? "Listing needs review"),
        detail: String(f.detail ?? ""),
        severity: f.severity === "high" ? "high" : f.severity === "warn" ? "warn" : "info",
        evidence: f.evidence,
      },
    });
  }
  return flags;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Duplicate listing detection
// ─────────────────────────────────────────────────────────────────────────
export async function detectDuplicates(opts: {
  actorId: string;
  listings: { id: string; title: string; price: number; shop_name: string }[];
}): Promise<{ groups: { ids: string[]; reason: string }[] }> {
  if (opts.listings.length < 2) return { groups: [] };

  const ai = await askAI<{ groups: { ids: string[]; reason: string }[] }>({
    feature: "duplicate_detect",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Find listings that are the same product posted under different titles,
possibly by different sellers.

Return JSON: { "groups": [ { "ids": string[], "reason": string } ] }

Only group listings you are confident are the same product. A "Samsung 43 inch
TV" and a "Samsung 55 inch TV" are NOT duplicates. Use the ids exactly as given.
Return an empty array if there are no duplicates.`,
    input: { listings: opts.listings.slice(0, 200) },
    inputSummary: `duplicate scan of ${opts.listings.length} listings`,
    schemaHint: `{ groups: [{ ids[], reason }] }`,
  });

  if (!ai.ok) return { groups: [] };

  // Code validates every id against the real set — a hallucinated id would
  // otherwise point the admin at a listing that does not exist.
  const valid = new Set(opts.listings.map((l) => l.id));
  const groups = (Array.isArray(ai.data.groups) ? ai.data.groups : [])
    .map((g) => ({
      ids: (Array.isArray(g.ids) ? g.ids : []).filter((id) => valid.has(id)),
      reason: String(g.reason ?? ""),
    }))
    .filter((g) => g.ids.length >= 2);

  for (const g of groups) {
    await recordSuggestion({
      feature: "duplicate_detect",
      subjectType: "listing",
      subjectId: g.ids[0],
      flag: {
        title: `${g.ids.length} listings look like the same product`,
        detail: g.reason,
        severity: "warn",
        evidence: { ids: g.ids },
      },
    });
  }

  return { groups };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Seller risk summary
// ─────────────────────────────────────────────────────────────────────────
export async function sellerRiskSummary(opts: {
  actorId: string;
  shop: {
    id: string;
    name: string;
    created_at: string;
    status: string;
    verified: boolean;
    rating_avg: number;
    rating_count: number;
    orders: number;
    disputes: number;
    refunds: number;
    payouts: number;
  };
}): Promise<string | null> {
  const ai = await askAI<{ summary: string }>({
    feature: "seller_risk",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Write ONE short paragraph (3-4 sentences) summarising a seller's risk
profile for an admin.

Use only the numbers provided: account age, order count, dispute count, refund
count, rating, verification status. Say plainly whether anything looks unusual.
Do not recommend a ban or a suspension — the admin decides.

Return JSON: { "summary": string }`,
    input: opts.shop,
    inputSummary: `risk for ${opts.shop.name}`,
    inputRef: opts.shop.id,
    schemaHint: `{ summary }`,
  });

  if (!ai.ok) return null;
  return ai.data.summary || null;
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Review spam filter
// ─────────────────────────────────────────────────────────────────────────
export async function detectReviewSpam(opts: {
  actorId: string;
  reviews: { id: string; rating: number; body: string | null; buyer_id: string }[];
}): Promise<{ suspicious: { id: string; reason: string }[] }> {
  if (opts.reviews.length === 0) return { suspicious: [] };

  const ai = await askAI<{ suspicious: { id: string; reason: string }[] }>({
    feature: "review_spam",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Find fake or spam reviews.

Signals: copy-pasted praise across different shops, generic five-star text with
no product detail, several reviews from the same buyer, text that reads like an
advert, and a burst of identical wording.

Return JSON: { "suspicious": [ { "id": string, "reason": string } ] }

Use the ids exactly as given. Do not flag a short but genuine review
("Very good, arrived fast") — brevity is not spam.`,
    input: { reviews: opts.reviews.slice(0, 100) },
    inputSummary: `spam scan of ${opts.reviews.length} reviews`,
    schemaHint: `{ suspicious: [{ id, reason }] }`,
  });

  if (!ai.ok) return { suspicious: [] };

  const valid = new Set(opts.reviews.map((r) => r.id));
  const suspicious = (Array.isArray(ai.data.suspicious) ? ai.data.suspicious : [])
    .filter((s) => valid.has(s.id))
    .map((s) => ({ id: s.id, reason: String(s.reason ?? "") }));

  for (const s of suspicious) {
    await recordSuggestion({
      feature: "review_spam",
      subjectType: "review",
      subjectId: s.id,
      flag: { title: "Possible fake review", detail: s.reason, severity: "warn" },
    });
  }

  return { suspicious };
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Complaint triage
// ─────────────────────────────────────────────────────────────────────────
export type Triage = "needs_refund" | "needs_seller_warning" | "just_a_question";

export async function triageComplaint(opts: {
  actorId: string;
  disputeId: string;
  reason: string;
  messages: { role: string; content: string }[];
}): Promise<{ category: Triage; why: string } | null> {
  const ai = await askAI<{ category: Triage; why: string }>({
    feature: "complaint_triage",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Sort a buyer complaint into exactly one bucket:

- "needs_refund"          — the buyer did not receive the item, or it is materially
                            not as described and the seller is at fault
- "needs_seller_warning"  — the seller behaved badly but the buyer is not owed money
- "just_a_question"       — the buyer is asking something, not complaining

Return JSON: { "category": "needs_refund"|"needs_seller_warning"|"just_a_question", "why": string }

"why" is one sentence citing what in the thread led to the category. You are
sorting, not deciding — an admin makes the actual call.`,
    input: { reason: opts.reason, messages: opts.messages.slice(-20) },
    inputSummary: `dispute ${opts.disputeId}`,
    inputRef: opts.disputeId,
    schemaHint: `{ category, why }`,
  });

  if (!ai.ok) return null;

  const valid: Triage[] = ["needs_refund", "needs_seller_warning", "just_a_question"];
  const category = valid.includes(ai.data.category) ? ai.data.category : "just_a_question";

  await recordSuggestion({
    feature: "complaint_triage",
    subjectType: "dispute",
    subjectId: opts.disputeId,
    flag: {
      title: `Complaint sorted as: ${category.replace(/_/g, " ")}`,
      detail: ai.data.why ?? "",
      severity: category === "needs_refund" ? "high" : "info",
    },
  });

  return { category, why: ai.data.why ?? "" };
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Bulk description cleanup
// ─────────────────────────────────────────────────────────────────────────
export async function cleanupListing(opts: {
  actorId: string;
  listing: { id: string; title: string; description: string | null; category: string | null };
  categories: string[];
}): Promise<{ title: string; description: string; category: string | null; changes: string[] } | null> {
  const ai = await askAI<{
    title: string;
    description: string;
    category: string | null;
    changes: string[];
  }>({
    feature: "bulk_cleanup",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Clean up an existing marketplace listing.

Fix the title (short, searchable, no ALL CAPS), fix typos and grammar in the
description, and pick the correct category from the provided list.

HARD RULE: do not change any product fact — no numbers, sizes, colours, brands,
prices or quantities. Do not add claims.

Return JSON: { "title": string, "description": string, "category": string|null, "changes": string[] }
"category" must be one of the provided categories, or null.`,
    input: {
      title: opts.listing.title,
      description: opts.listing.description,
      category: opts.listing.category,
      categories: opts.categories,
    },
    inputSummary: `cleanup "${opts.listing.title}"`,
    inputRef: opts.listing.id,
    schemaHint: `{ title, description, category, changes[] }`,
  });

  if (!ai.ok) return null;

  // Code guard: numbers are facts. Reject a "cleanup" that changed one.
  const before = `${opts.listing.title} ${opts.listing.description ?? ""}`.match(/\d+/g) ?? [];
  const after = `${ai.data.title} ${ai.data.description}`.match(/\d+/g) ?? [];
  if (before.sort().join(",") !== after.sort().join(",")) return null;

  return {
    title: (ai.data.title || opts.listing.title).slice(0, 120),
    description: ai.data.description || opts.listing.description || "",
    category:
      ai.data.category && opts.categories.includes(ai.data.category) ? ai.data.category : null,
    changes: Array.isArray(ai.data.changes) ? ai.data.changes.slice(0, 8) : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Category mapping
// ─────────────────────────────────────────────────────────────────────────
export async function suggestCategory(opts: {
  actorId: string;
  title: string;
  description: string | null;
  categories: string[];
}): Promise<string | null> {
  const ai = await askAI<{ category: string | null }>({
    feature: "category_mapping",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Pick the correct category for a marketplace listing.

Return JSON: { "category": string | null }
The category MUST be one of the provided ones, or null if none fits.
Never invent a category.`,
    input: {
      title: opts.title,
      description: opts.description,
      categories: opts.categories,
    },
    inputSummary: `category for "${opts.title}"`,
    schemaHint: `{ category }`,
  });

  if (!ai.ok) return null;
  return ai.data.category && opts.categories.includes(ai.data.category) ? ai.data.category : null;
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Image audit
// ─────────────────────────────────────────────────────────────────────────
export async function auditListingImage(opts: {
  actorId: string;
  listingId: string;
  title: string;
  imageUrl: string | null;
}): Promise<Flag | null> {
  // No image at all is a code decision, not an AI one.
  if (!opts.imageUrl) {
    return {
      title: "Listing has no photo",
      detail: "Buyers skip listings without a photo. Ask the seller to add one.",
      severity: "warn",
    };
  }

  const ai = await askAI<{ matches: boolean; is_stock: boolean; reason: string }>({
    feature: "image_audit",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Check whether a listing photo matches its title.

Return JSON: { "matches": boolean, "is_stock": boolean, "reason": string }

"matches" is false when the photo clearly shows something other than what the
title describes. "is_stock" is true when the photo looks like a manufacturer or
catalogue image rather than the seller's own photo. Be conservative: a plain
product photo on a table is not "stock".`,
    input: { title: opts.title, image_url: opts.imageUrl },
    inputSummary: `image audit "${opts.title}"`,
    inputRef: opts.listingId,
    schemaHint: `{ matches, is_stock, reason }`,
  });

  if (!ai.ok) return null;
  if (ai.data.matches !== false && ai.data.is_stock !== true) return null;

  const flag: Flag = {
    title: ai.data.is_stock ? "Photo looks like a stock image" : "Photo may not match the title",
    detail: ai.data.reason ?? "",
    severity: "warn",
  };
  await recordSuggestion({
    feature: "image_audit",
    subjectType: "listing",
    subjectId: opts.listingId,
    flag,
  });
  return flag;
}

// ─────────────────────────────────────────────────────────────────────────
// 9. Daily admin digest
// ─────────────────────────────────────────────────────────────────────────
export async function dailyDigest(opts: {
  actorId: string;
  stats: {
    new_orders: number;
    pending_payouts: number;
    open_disputes: number;
    sellers_awaiting_approval: number;
    payments_awaiting_confirmation: number;
    revenue_today: number;
    flagged_listings: number;
  };
}): Promise<string | null> {
  const ai = await askAI<{ digest: string }>({
    feature: "admin_digest",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Write a short morning digest for a marketplace admin.

Use only the numbers provided. Lead with anything that needs action today.
3-5 sentences, plain English, no bullet points.

Return JSON: { "digest": string }`,
    input: opts.stats,
    inputSummary: "daily digest",
    schemaHint: `{ digest }`,
  });

  if (!ai.ok) return null;
  return ai.data.digest || null;
}

// ─────────────────────────────────────────────────────────────────────────
// 10. Dispute summary
// ─────────────────────────────────────────────────────────────────────────
export async function summariseDispute(opts: {
  actorId: string;
  disputeId: string;
  reason: string;
  messages: { role: string; content: string; at?: string }[];
}): Promise<{ timeline: string[]; buyer_claim: string; seller_claim: string } | null> {
  const ai = await askAI<{ timeline: string[]; buyer_claim: string; seller_claim: string }>({
    feature: "dispute_summary",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Summarise a buyer/seller dispute thread for an admin.

Return JSON:
{
  "timeline": string[],     // 3-8 chronological points, each one line
  "buyer_claim": string,    // what the buyer says happened, 1-2 sentences
  "seller_claim": string    // what the seller says happened, 1-2 sentences
}

Use only what is in the thread. If one side never replied, say so plainly
rather than inventing their position. Do not decide who is right.`,
    input: { reason: opts.reason, messages: opts.messages.slice(-40) },
    inputSummary: `dispute ${opts.disputeId}`,
    inputRef: opts.disputeId,
    schemaHint: `{ timeline[], buyer_claim, seller_claim }`,
  });

  if (!ai.ok) return null;
  return {
    timeline: Array.isArray(ai.data.timeline) ? ai.data.timeline.slice(0, 10) : [],
    buyer_claim: ai.data.buyer_claim ?? "",
    seller_claim: ai.data.seller_claim ?? "",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 11. Payout anomaly check
// ─────────────────────────────────────────────────────────────────────────
export async function checkPayoutAnomaly(opts: {
  actorId: string;
  payout: {
    id: string;
    shop_name: string;
    amount: number;
    completed_orders_total: number;
    completed_orders_count: number;
    already_paid: number;
  };
}): Promise<Flag | null> {
  // Code first: the arithmetic check needs no AI and is the reliable one.
  const expected = opts.payout.completed_orders_total - opts.payout.already_paid;
  const overBy = opts.payout.amount - expected;

  if (overBy > 1) {
    const flag: Flag = {
      title: `Payout exceeds completed orders by ₦${overBy.toLocaleString()}`,
      detail: `Requested ₦${opts.payout.amount.toLocaleString()} but completed orders less prior payouts come to ₦${expected.toLocaleString()}.`,
      severity: "high",
      evidence: { expected, requested: opts.payout.amount },
    };
    await recordSuggestion({
      feature: "payout_anomaly",
      subjectType: "payout",
      subjectId: opts.payout.id,
      flag,
    });
    return flag;
  }

  // Then let the AI look for softer signals, but never let it block a payout.
  const ai = await askAI<{ anomaly: boolean; reason: string }>({
    feature: "payout_anomaly",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Look for anything unusual in a payout request.

Return JSON: { "anomaly": boolean, "reason": string }
Only flag a genuine anomaly. A payout that matches completed orders is normal.`,
    input: opts.payout,
    inputSummary: `payout ${opts.payout.id}`,
    inputRef: opts.payout.id,
    schemaHint: `{ anomaly, reason }`,
  });

  if (!ai.ok || ai.data.anomaly !== true) return null;

  const flag: Flag = {
    title: "Payout looks unusual",
    detail: ai.data.reason ?? "",
    severity: "warn",
  };
  await recordSuggestion({
    feature: "payout_anomaly",
    subjectType: "payout",
    subjectId: opts.payout.id,
    flag,
  });
  return flag;
}

// ─────────────────────────────────────────────────────────────────────────
// 12. Support inbox drafting
// ─────────────────────────────────────────────────────────────────────────
export async function draftSupportReply(opts: {
  actorId: string;
  message: string;
  context?: string;
}): Promise<string | null> {
  const ai = await askAI<{ draft: string }>({
    feature: "support_draft",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Draft a reply to a buyer's support message for an admin to review
before sending.

Rules:
- Answer only from the context provided. If the context does not cover it, say
  the team is checking and will follow up — do not invent a policy.
- Never promise a refund, a payout or a delivery date.
- 2-4 sentences, warm but plain. Sign off as "NaijaMart Support".

Return JSON: { "draft": string }`,
    input: { message: opts.message, context: opts.context ?? null },
    inputSummary: opts.message.slice(0, 120),
    schemaHint: `{ draft }`,
  });

  if (!ai.ok) return null;
  return ai.data.draft || null;
}

// ─────────────────────────────────────────────────────────────────────────
// 13. Search-gap report
// ─────────────────────────────────────────────────────────────────────────
export async function searchGapReport(opts: {
  actorId: string;
  gaps: { query: string; count: number }[];
}): Promise<{ summary: string; opportunities: string[] } | null> {
  if (opts.gaps.length === 0) return null;

  const ai = await askAI<{ summary: string; opportunities: string[] }>({
    feature: "search_gap_report",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Summarise what buyers searched for and found nothing.

Return JSON: { "summary": string, "opportunities": string[] }
"summary" is 2-3 sentences. "opportunities" is 3-6 concrete things the platform
could stock or recruit sellers for. Use only the queries provided.`,
    input: { gaps: opts.gaps.slice(0, 100) },
    inputSummary: `${opts.gaps.length} search gaps`,
    schemaHint: `{ summary, opportunities[] }`,
  });

  if (!ai.ok) return null;
  return {
    summary: ai.data.summary ?? "",
    opportunities: Array.isArray(ai.data.opportunities) ? ai.data.opportunities.slice(0, 8) : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 14. Sales narrative
// ─────────────────────────────────────────────────────────────────────────
export async function salesNarrative(opts: {
  actorId: string;
  thisWeek: { orders: number; revenue: number; new_sellers: number; disputes: number };
  lastWeek: { orders: number; revenue: number; new_sellers: number; disputes: number };
}): Promise<string | null> {
  const ai = await askAI<{ narrative: string }>({
    feature: "sales_narrative",
    actorId: opts.actorId,
    actorRole: "admin",
    system: `Explain in plain English what changed this week versus last week.

Use only the numbers provided. Say what went up, what went down, and the most
likely reason visible in the numbers. Do not invent a cause that the numbers do
not support — if nothing explains a change, say it is unclear.

Return JSON: { "narrative": string }  // 3-4 sentences`,
    input: { this_week: opts.thisWeek, last_week: opts.lastWeek },
    inputSummary: "weekly sales narrative",
    schemaHint: `{ narrative }`,
  });

  if (!ai.ok) return null;
  return ai.data.narrative || null;
}

// ─────────────────────────────────────────────────────────────────────────
// 15. Price sanity check
// ─────────────────────────────────────────────────────────────────────────
export async function priceSanity(opts: {
  actorId: string;
  listingId: string;
  title: string;
  price: number;
  category: string | null;
  categoryMedian: number | null;
  categoryCount: number;
}): Promise<Flag | null> {
  // Code first: a statistical outlier needs no AI.
  if (opts.categoryMedian && opts.categoryCount >= 5) {
    const ratio = opts.price / opts.categoryMedian;
    if (ratio < 0.2 || ratio > 5) {
      const flag: Flag = {
        title: `Price is ${ratio < 1 ? "far below" : "far above"} the category norm`,
        detail: `₦${opts.price.toLocaleString()} against a category median of ₦${opts.categoryMedian.toLocaleString()} (${opts.categoryCount} listings).`,
        severity: ratio < 0.2 ? "high" : "warn",
        evidence: { price: opts.price, median: opts.categoryMedian, ratio },
      };
      await recordSuggestion({
        feature: "price_sanity",
        subjectType: "listing",
        subjectId: opts.listingId,
        flag,
      });
      return flag;
    }
  }
  return null;
}
