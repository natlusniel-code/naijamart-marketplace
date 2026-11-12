import "server-only";
import { askAI } from "./client";

/**
 * Buyer-facing AI — Part 1, features 7, 9, 10, 11, 12, 13.
 *
 * ── The rule that matters most here ─────────────────────────────────────────
 * The support chatbot answers from a FIXED policy document. It is explicitly
 * instructed to hand off to a human rather than invent a policy. That is not a
 * nicety: a chatbot that invents a refund rule creates a legal and financial
 * obligation the platform never agreed to.
 *
 * ── The order-status assistant never queries the database ───────────────────
 * The site retrieves the order (with RLS, as the signed-in buyer) and passes it
 * in. The AI is told it cannot look anything up. If the order is not in the
 * payload, the AI must say so — it must never claim to have checked.
 */

// ─────────────────────────────────────────────────────────────────────────
// 7. Customer support chatbot
// ─────────────────────────────────────────────────────────────────────────
export type SupportAnswer = {
  answer: string;
  /** True when the AI could not answer from policy and a human should take over. */
  handoff: boolean;
  /** Which policy sections it used, for the audit log. */
  sources: string[];
};

/**
 * The fixed knowledge document.
 *
 * Kept in code, not in the database, so a policy change is a reviewed commit
 * rather than a row someone can edit at 2am. It mirrors `src/app/legal/*`.
 */
export const POLICY_DOCUMENT = `
NAIJAMART POLICIES

PAYMENTS AND ESCROW
- Every payment is held in escrow by NaijaMart until the buyer confirms delivery.
- A buyer pays by bank transfer to the account shown at checkout, then uploads the receipt.
- Payments are confirmed either automatically or by a NaijaMart reviewer.
- Sellers are paid out after the escrow hold period, which is 4 days after delivery.

DELIVERY
- Delivery fees are set per shop and shown at checkout before payment.
- Orders over the cross-LGA threshold (currently ₦20,000) can be delivered to any
  LGA within the buyer's own state.
- Orders at or below that threshold can only be placed with sellers in the buyer's own LGA.
- Pickup is available from shops that offer it; the option appears at checkout.

RETURNS AND REFUNDS
- If an order is not delivered, the buyer is refunded.
- A buyer can raise a dispute from the order page if the item is not as described.
- Disputes are reviewed by NaijaMart; the decision is made by a human, not automatically.
- Refunds are returned to the account the buyer paid from.

SELLER RULES
- A seller must complete business details, upload a valid identity document
  (NIN slip, national ID, driver's licence, passport or voter's card), and pay
  the monthly subscription.
- A seller is only approved after NaijaMart reviews the shop. Approval and
  identity verification are separate checks.
- Sellers must not list prohibited items, use fake brands, or make claims they
  cannot support.
- Sellers must respond to buyer messages; slow responses lower their ranking.

ACCOUNTS
- One account has one role: buyer or seller.
- Opening a shop converts the account to a seller account.
- Passwords can be reset from the sign-in page using the "Forgot password" link.

WHAT NAIJAMART DOES NOT DO
- NaijaMart does not take payment outside the platform.
- NaijaMart does not ask for a password, PIN or card details over chat.
- NaijaMart does not guarantee delivery times quoted by a seller.
`.trim();

export async function supportAnswer(opts: {
  actorId: string;
  question: string;
  /** Recent turns, so a follow-up like "and how long?" makes sense. */
  history?: { role: "user" | "assistant"; content: string }[];
}): Promise<SupportAnswer> {
  // The non-AI fallback: point at the real policy pages and a human. This is
  // what a buyer sees when the AI is down, and it is genuinely helpful.
  const fallback: SupportAnswer = {
    answer:
      "I can't answer that automatically right now. You can read our policies under Help, or message our team on WhatsApp and a person will reply.",
    handoff: true,
    sources: [],
  };

  const ai = await askAI<{ answer: string; handoff: boolean; sources: string[] }>({
    feature: "support_chat",
    actorId: opts.actorId,
    actorRole: "buyer",
    system: `You are the NaijaMart support assistant.

Answer ONLY from the policy document below. You have no other knowledge of
NaijaMart and you cannot look anything up.

${POLICY_DOCUMENT}

Rules:
- If the policy document does not answer the question, set "handoff": true and
  say you will pass them to a human. NEVER invent a policy, a fee, a timeframe
  or a guarantee.
- Never ask for a password, PIN, card number or bank details.
- Never promise a refund, a payout or a delivery date. Those are decisions made
  by a person.
- Be brief: 1-3 sentences. Plain English.

Return JSON: { "answer": string, "handoff": boolean, "sources": string[] }
"sources" lists the policy section names you used, e.g. ["RETURNS AND REFUNDS"].`,
    input: {
      question: opts.question,
      recent_conversation: (opts.history ?? []).slice(-6),
    },
    inputSummary: opts.question.slice(0, 120),
    schemaHint: `{ answer, handoff, sources[] }`,
  });

  if (!ai.ok) return fallback;

  return {
    answer: ai.data.answer || fallback.answer,
    // Code decides handoff, not the model alone: an empty answer is a handoff
    // whatever the model claimed.
    handoff: ai.data.handoff === true || !ai.data.answer,
    sources: Array.isArray(ai.data.sources) ? ai.data.sources.slice(0, 5) : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 9. Order-status assistant
// ─────────────────────────────────────────────────────────────────────────
export type OrderStatusAnswer = { answer: string; handoff: boolean };

export async function explainOrderStatus(opts: {
  actorId: string;
  question: string;
  /** The order, already retrieved by the site under the buyer's own RLS. */
  order: {
    reference: string;
    status: string;
    total: number;
    shop_name: string;
    created_at: string;
    items: { title: string; quantity: number }[];
    payment_status: string | null;
    payout_status: string | null;
  } | null;
}): Promise<OrderStatusAnswer> {
  // No order → the site could not find one. Say that; do not guess.
  if (!opts.order) {
    return {
      answer:
        "I couldn't find that order on your account. Open Orders to see everything you've bought, or message our team if you think something is missing.",
      handoff: true,
    };
  }

  const o = opts.order;
  const fallback: OrderStatusAnswer = {
    answer: `Order ${o.reference} from ${o.shop_name} is currently "${o.status.replace(/_/g, " ")}". Payment: ${o.payment_status ?? "pending"}.`,
    handoff: false,
  };

  const ai = await askAI<{ answer: string; handoff: boolean }>({
    feature: "order_status",
    actorId: opts.actorId,
    actorRole: "buyer",
    system: `You explain an order's status to a NaijaMart buyer.

You are given the order record. You CANNOT query the database and you must
never claim to have looked anything up — the record below is all you know.

Rules:
- Answer from the record only. If the record does not contain what they asked,
  say so and set "handoff": true.
- Never promise a delivery date. Never say a refund or payout has been approved.
- Explain what the current status means in plain English, and what happens next.
- 1-3 sentences.

Return JSON: { "answer": string, "handoff": boolean }`,
    input: { question: opts.question, order: o },
    inputSummary: `order ${o.reference}`,
    inputRef: o.reference,
    schemaHint: `{ answer, handoff }`,
  });

  if (!ai.ok) return fallback;

  return {
    answer: ai.data.answer || fallback.answer,
    handoff: ai.data.handoff === true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 10 + 11. Natural-language search → structured filters
// ─────────────────────────────────────────────────────────────────────────
export type SearchFilters = {
  category: string | null;
  max_price: number | null;
  min_price: number | null;
  keywords: string[];
  /** What the AI understood, shown to the buyer so the result is explainable. */
  understood: string;
};

/**
 * Turn "affordable phone for good pictures under 100,000" into filters.
 *
 * The AI produces FILTERS, never results. The caller then runs a normal
 * database query with them. If the AI fails, the caller falls back to keyword
 * search — which is why this returns `null` rather than throwing.
 */
export async function parseSearchQuery(opts: {
  actorId: string;
  query: string;
  categories: string[];
}): Promise<SearchFilters | null> {
  const ai = await askAI<SearchFilters>({
    feature: "nl_search",
    actorId: opts.actorId,
    actorRole: "buyer",
    system: `Convert a shopper's sentence into marketplace search filters.

You are given the query and the ONLY categories that exist. Pick one from that
list or null — never invent a category.

Return JSON:
{
  "category": string | null,   // one of the provided categories, or null
  "max_price": number | null,  // naira, digits only. "under 100k" -> 100000
  "min_price": number | null,
  "keywords": string[],        // 1-5 words to match in the title/description
  "understood": string         // one short sentence restating what they want
}

Rules:
- "affordable", "cheap", "budget" do NOT set a price — they are not a number.
- "under 100,000", "below 50k", "less than 20k" DO set max_price.
- Keep keywords concrete: the product type and the attribute they care about
  ("phone", "camera"). Drop filler words.
- Never invent a category that is not in the list.`,
    input: { query: opts.query, categories: opts.categories },
    inputSummary: opts.query.slice(0, 120),
    schemaHint: `{ category, max_price, min_price, keywords[], understood }`,
  });

  if (!ai.ok) return null;

  const cat =
    ai.data.category && opts.categories.includes(ai.data.category) ? ai.data.category : null;

  return {
    category: cat,
    max_price: numOrNull(ai.data.max_price),
    min_price: numOrNull(ai.data.min_price),
    keywords: Array.isArray(ai.data.keywords)
      ? ai.data.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 5)
      : [],
    understood: ai.data.understood || opts.query,
  };
}

/**
 * 11. Search query correction.
 *
 * Returns a corrected query, or null when the AI is unavailable or thinks the
 * query is already fine. The caller then just uses the original.
 */
export async function correctSearchQuery(opts: {
  actorId: string;
  query: string;
}): Promise<{ corrected: string; changed: boolean } | null> {
  const ai = await askAI<{ corrected: string; changed: boolean }>({
    feature: "search_correction",
    actorId: opts.actorId,
    actorRole: "buyer",
    system: `Fix spelling and local-expression problems in a marketplace search query.

Nigerian English examples: "fone" -> "phone", "gen" -> "generator",
"AC" -> "air conditioner", "tokumbo" -> "tokunbo" (used, imported).

Return JSON: { "corrected": string, "changed": boolean }
If the query is already fine, return it unchanged with "changed": false.
Never add words the shopper did not mean. Never change a number.`,
    input: { query: opts.query },
    inputSummary: opts.query.slice(0, 120),
    schemaHint: `{ corrected, changed }`,
  });

  if (!ai.ok) return null;
  const corrected = String(ai.data.corrected ?? "").trim();
  if (!corrected) return null;
  // Code guard: a "correction" that changes a number is not a correction.
  const n1 = (opts.query.match(/\d+/g) ?? []).join(",");
  const n2 = (corrected.match(/\d+/g) ?? []).join(",");
  if (n1 !== n2) return null;
  return { corrected, changed: corrected.toLowerCase() !== opts.query.trim().toLowerCase() };
}

// ─────────────────────────────────────────────────────────────────────────
// 12. Product comparison summary
// ─────────────────────────────────────────────────────────────────────────
export async function compareProducts(opts: {
  actorId: string;
  products: {
    title: string;
    price: number;
    description: string | null;
    tags: string[];
    shop_name: string;
    rating: number;
  }[];
}): Promise<{ summary: string; differences: string[] } | null> {
  const ai = await askAI<{ summary: string; differences: string[] }>({
    feature: "compare_summary",
    actorId: opts.actorId,
    actorRole: "buyer",
    system: `Summarise the differences between marketplace products.

Use ONLY the values provided. Do not add specifications, do not guess quality,
do not recommend one as "better" — state the differences factually.

Return JSON: { "summary": string, "differences": string[] }
"summary" is 2-3 sentences. "differences" is 3-6 short factual points.`,
    input: { products: opts.products },
    inputSummary: `compare ${opts.products.length} products`,
    schemaHint: `{ summary, differences[] }`,
  });

  if (!ai.ok) return null;
  return {
    summary: ai.data.summary || "",
    differences: Array.isArray(ai.data.differences) ? ai.data.differences.slice(0, 8) : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 13. Review summariser
// ─────────────────────────────────────────────────────────────────────────
export async function summariseReviews(opts: {
  actorId: string;
  shopName: string;
  reviews: { rating: number; body: string | null }[];
}): Promise<{ positives: string[]; complaints: string[]; themes: string[] } | null> {
  if (opts.reviews.length === 0) return null;

  const ai = await askAI<{ positives: string[]; complaints: string[]; themes: string[] }>({
    feature: "review_summary",
    actorId: opts.actorId,
    actorRole: "buyer",
    system: `Summarise marketplace reviews for a shop.

Group what reviewers actually said. Do not invent a theme that no review
mentions. Do not soften a complaint.

Return JSON:
{
  "positives": string[],   // 2-5 short points reviewers praised
  "complaints": string[],  // 0-5 short points reviewers complained about
  "themes": string[]       // 2-5 recurring topics, e.g. "fast delivery"
}`,
    input: { shop_name: opts.shopName, reviews: opts.reviews.slice(0, 60) },
    inputSummary: `reviews for ${opts.shopName}`,
    schemaHint: `{ positives[], complaints[], themes[] }`,
  });

  if (!ai.ok) return null;
  return {
    positives: Array.isArray(ai.data.positives) ? ai.data.positives.slice(0, 6) : [],
    complaints: Array.isArray(ai.data.complaints) ? ai.data.complaints.slice(0, 6) : [],
    themes: Array.isArray(ai.data.themes) ? ai.data.themes.slice(0, 6) : [],
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}
