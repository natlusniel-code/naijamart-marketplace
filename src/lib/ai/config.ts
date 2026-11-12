/**
 * AI configuration.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 * Every AI feature is OPTIONAL. If the AI is unavailable, slow, rate-limited or
 * over quota, the site keeps working. Nothing in checkout, login, payment or
 * order creation may depend on this module returning anything.
 *
 * ── Where the thinking happens ──────────────────────────────────────────────
 * The site calls Teamily for AI work. Teamily does the thinking and returns
 * structured results. The site's own data stays in Supabase and is sent along
 * with each request — we never hand Teamily a database connection, and Teamily
 * never reads our tables.
 *
 * ── Why the endpoint is configurable ────────────────────────────────────────
 * The Teamily AI endpoint and key are deployment secrets, not code. They are
 * read from the environment so they can be rotated in Vercel without a commit.
 * When they are absent, `aiEnabled` is false and every feature takes its
 * non-AI path — which is a supported state, not an error.
 */

/** Base URL of the Teamily AI gateway. */
export const TEAMILY_AI_URL = (process.env.TEAMILY_AI_URL || "").trim().replace(/\/+$/, "");

/** Bearer token for the gateway. Server-side only — never NEXT_PUBLIC_. */
export const TEAMILY_AI_KEY = (process.env.TEAMILY_AI_KEY || "").trim();

/** Model/agent identifier Teamily should route to. */
export const TEAMILY_AI_MODEL = (process.env.TEAMILY_AI_MODEL || "teamily-default").trim();

/**
 * True when the AI can be called at all.
 *
 * Deliberately requires BOTH values: a URL with no key would 401 on every
 * request and burn the timeout budget for nothing.
 */
export const aiEnabled = Boolean(TEAMILY_AI_URL && TEAMILY_AI_KEY);

/**
 * Hard ceiling on a single AI call, in milliseconds.
 *
 * This is the number that keeps the site fast when Teamily is slow. A page
 * render must never wait longer than this for an optional feature; past it we
 * abort and fall back. Kept short on purpose — the fallback is always usable.
 */
export const AI_TIMEOUT_MS = Number(process.env.TEAMILY_AI_TIMEOUT_MS || 8000);

/** Per-feature rate limits: calls allowed per actor per hour. */
export const AI_RATE_LIMITS: Record<string, number> = {
  // Buyer/seller writing tools — cheap, but a seller could loop them.
  description_writer: 40,
  title_improver: 40,
  tag_suggest: 40,
  grammar_fix: 40,
  image_quality: 30,
  image_to_listing: 20,
  faq_generator: 10,
  seller_insights: 10,
  // Buyer-facing
  support_chat: 30,
  order_status: 30,
  nl_search: 60,
  search_correction: 60,
  compare_summary: 20,
  review_summary: 20,
  // Admin
  listing_review: 100,
  duplicate_detect: 20,
  seller_risk: 20,
  review_spam: 100,
  complaint_triage: 100,
  bulk_cleanup: 5,
  category_mapping: 100,
  image_audit: 50,
  admin_digest: 10,
  dispute_summary: 30,
  payout_anomaly: 20,
  support_draft: 50,
  search_gap_report: 10,
  sales_narrative: 10,
  price_sanity: 50,
  // Payment + identity — these are the ones that matter
  receipt_extract: 20,
  identity_check: 10,
};

/** Default limit for a feature not listed above. */
export const AI_DEFAULT_RATE_LIMIT = 20;

/** Cache TTL per feature, in seconds. 0 = do not cache. */
export const AI_CACHE_TTL: Record<string, number> = {
  support_chat: 3600,
  faq_generator: 86400,
  review_summary: 3600,
  compare_summary: 3600,
  nl_search: 900,
  search_correction: 86400,
  category_mapping: 86400,
  // Never cache a payment or identity decision: the same image must be
  // re-read for a new payment, and a cached verdict would let a replayed
  // receipt reuse an old approval.
  receipt_extract: 0,
  identity_check: 0,
};
