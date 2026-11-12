import "server-only";
import { askAI } from "./client";

/**
 * Seller-facing writing tools — Part 1, features 1–6, 8 and 15.
 *
 * ── Every one of these is a SUGGESTION ──────────────────────────────────────
 * Nothing here writes to the database. Each function returns text for the
 * seller to accept, edit or ignore. That is deliberate: a seller's listing is
 * their commercial statement, and an AI that silently rewrote it would be both
 * a trust problem and a support burden.
 *
 * ── Every one has a non-AI fallback ─────────────────────────────────────────
 * When the AI is unavailable each function returns `{ ok: false, fallback }`
 * where `fallback` is something genuinely useful — usually the seller's own
 * text, lightly tidied by code. The UI shows the fallback and a quiet note that
 * suggestions are unavailable, rather than an error.
 */

export type Suggestion<T> =
  | { ok: true; data: T; cached: boolean }
  | { ok: false; reason: string; fallback: T };

/** Title-case a string without touching the rest of the words. */
function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Collapse whitespace and trim — the code-side tidy used by every fallback. */
function tidy(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Product description writer
// ─────────────────────────────────────────────────────────────────────────
export async function writeDescription(opts: {
  actorId: string;
  name: string;
  specs: string;
  category?: string;
  price?: number;
}): Promise<Suggestion<{ title: string; description: string }>> {
  const fallback = {
    title: titleCase(opts.name || "Untitled listing"),
    description: tidy(
      [opts.name, opts.specs].filter(Boolean).join("\n\n") ||
        "Add a few details and we'll help you write this.",
    ),
  };

  const ai = await askAI<{ title: string; description: string }>({
    feature: "description_writer",
    actorId: opts.actorId,
    actorRole: "seller",
    system: `You write product listings for a Nigerian marketplace.

Given a product name and its specifications, write:
- "title": at most 70 characters, specific, no ALL CAPS, no emoji, no price
- "description": 2 short paragraphs. Plain English a Nigerian shopper reads
  quickly. Mention what it is, what it does, and who it suits. Do NOT invent
  specifications that were not given. Do NOT claim guarantees, warranties or
  authenticity that were not stated.

Return JSON: { "title": string, "description": string }`,
    input: {
      name: opts.name,
      specs: opts.specs,
      category: opts.category ?? null,
      price: opts.price ?? null,
    },
    inputSummary: `description for "${opts.name}"`,
    schemaHint: `{ title, description }`,
  });

  if (!ai.ok) return { ok: false, reason: ai.reason, fallback };
  return {
    ok: true,
    cached: ai.cached,
    data: {
      title: (ai.data.title || fallback.title).slice(0, 120),
      description: ai.data.description || fallback.description,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Product title improver
// ─────────────────────────────────────────────────────────────────────────
export async function improveTitle(opts: {
  actorId: string;
  title: string;
  category?: string;
}): Promise<Suggestion<{ title: string; why: string }>> {
  const fallback = { title: titleCase(opts.title), why: "Tidied capitalisation." };

  const ai = await askAI<{ title: string; why: string }>({
    feature: "title_improver",
    actorId: opts.actorId,
    actorRole: "seller",
    system: `Rewrite a marketplace listing title so it is short and searchable.

Rules:
- At most 70 characters.
- Lead with the product type, then the distinguishing attribute
  (e.g. "3-Seater Leather Sofa", not "Beautiful Sofa For Your Home").
- No ALL CAPS, no emoji, no price, no shop name, no "best" or "cheap".
- Keep every fact that was in the original. Do not add specifications.

Return JSON: { "title": string, "why": string }  // "why" is one short sentence`,
    input: { title: opts.title, category: opts.category ?? null },
    inputSummary: `title for "${opts.title}"`,
    schemaHint: `{ title, why }`,
  });

  if (!ai.ok) return { ok: false, reason: ai.reason, fallback };
  return {
    ok: true,
    cached: ai.cached,
    data: {
      title: (ai.data.title || fallback.title).slice(0, 120),
      why: ai.data.why || "",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Tag and category suggestions
// ─────────────────────────────────────────────────────────────────────────
export type TagSuggestion = {
  category: string | null;
  tags: string[];
  brand: string | null;
  colour: string | null;
  size: string | null;
};

export async function suggestTags(opts: {
  actorId: string;
  title: string;
  description?: string;
  categories: string[];
}): Promise<Suggestion<TagSuggestion>> {
  // Code-side fallback: derive tags from the title's own words. Crude but
  // genuinely useful, and it never invents a brand or a colour.
  const words = `${opts.title} ${opts.description ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const fallback: TagSuggestion = {
    category: null,
    tags: Array.from(new Set(words)).slice(0, 8),
    brand: null,
    colour: null,
    size: null,
  };

  const ai = await askAI<TagSuggestion>({
    feature: "tag_suggest",
    actorId: opts.actorId,
    actorRole: "seller",
    system: `Suggest search attributes for a marketplace listing.

You are given the listing text and the ONLY categories that exist. Pick one
category from that list, or null if none fits — never invent a category.

Return JSON:
{
  "category": string | null,   // must be one of the provided categories
  "tags": string[],            // 5-10 lowercase search terms buyers would type
  "brand": string | null,      // only if the text names one
  "colour": string | null,     // only if the text names one
  "size": string | null        // only if the text names one
}

Never invent a brand, colour or size that is not in the text.`,
    input: {
      title: opts.title,
      description: opts.description ?? null,
      categories: opts.categories,
    },
    inputSummary: `tags for "${opts.title}"`,
    schemaHint: `{ category, tags[], brand, colour, size }`,
  });

  if (!ai.ok) return { ok: false, reason: ai.reason, fallback };

  // Code validates the model's category against the real list. A hallucinated
  // category would otherwise be written to the listing and break filtering.
  const cat =
    ai.data.category && opts.categories.includes(ai.data.category) ? ai.data.category : null;

  return {
    ok: true,
    cached: ai.cached,
    data: {
      category: cat,
      tags: Array.isArray(ai.data.tags)
        ? ai.data.tags
            .map((t) => String(t).toLowerCase().trim())
            .filter(Boolean)
            .slice(0, 20)
        : fallback.tags,
      brand: ai.data.brand ?? null,
      colour: ai.data.colour ?? null,
      size: ai.data.size ?? null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Spelling and grammar correction
// ─────────────────────────────────────────────────────────────────────────
export async function fixGrammar(opts: {
  actorId: string;
  text: string;
}): Promise<Suggestion<{ text: string; changes: string[] }>> {
  const fallback = { text: tidy(opts.text), changes: [] };

  const ai = await askAI<{ text: string; changes: string[] }>({
    feature: "grammar_fix",
    actorId: opts.actorId,
    actorRole: "seller",
    system: `Correct spelling and grammar in a marketplace listing.

HARD RULE: do not change any product fact. Do not change numbers, sizes,
colours, model names, brands, prices or quantities. Do not add or remove
claims. Only fix spelling, punctuation, capitalisation and sentence structure.

Return JSON: { "text": string, "changes": string[] }  // changes = short list`,
    input: { text: opts.text },
    inputSummary: "grammar fix",
    schemaHint: `{ text, changes[] }`,
  });

  if (!ai.ok) return { ok: false, reason: ai.reason, fallback };

  // Code guard: if the model changed a number, reject its output. Numbers in a
  // listing are facts (a 3-seater sofa is not a 2-seater), and a model that
  // "corrects" one has broken the listing.
  const numsBefore = (opts.text.match(/\d+/g) ?? []).sort().join(",");
  const numsAfter = (ai.data.text.match(/\d+/g) ?? []).sort().join(",");
  if (numsBefore !== numsAfter) {
    return { ok: false, reason: "numbers_changed", fallback };
  }

  return {
    ok: true,
    cached: ai.cached,
    data: {
      text: ai.data.text || fallback.text,
      changes: Array.isArray(ai.data.changes) ? ai.data.changes.slice(0, 10) : [],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Product image quality checker
// ─────────────────────────────────────────────────────────────────────────
export type ImageQuality = {
  score: number; // 0..100
  issues: string[];
  advice: string;
};

export async function checkImageQuality(opts: {
  actorId: string;
  imageUrl: string;
}): Promise<Suggestion<ImageQuality>> {
  // No AI → we cannot judge an image. Say so honestly rather than pretend.
  const fallback: ImageQuality = {
    score: 0,
    issues: [],
    advice: "Automatic photo checks are unavailable right now. Make sure the product is well lit and fills the frame.",
  };

  const ai = await askAI<ImageQuality>({
    feature: "image_quality",
    actorId: opts.actorId,
    actorRole: "seller",
    system: `Judge a product photo for a marketplace listing.

Return JSON:
{
  "score": number,        // 0-100, how suitable this is as a listing photo
  "issues": string[],     // e.g. "blurry", "too dark", "product cut off", "cluttered background"
  "advice": string        // one short, actionable sentence for the seller
}

Judge only photographic quality and suitability. Do not judge the product.`,
    input: { image_url: opts.imageUrl },
    inputSummary: "image quality",
    schemaHint: `{ score, issues[], advice }`,
  });

  if (!ai.ok) return { ok: false, reason: ai.reason, fallback };

  return {
    ok: true,
    cached: ai.cached,
    data: {
      score: Math.max(0, Math.min(100, Number(ai.data.score) || 0)),
      issues: Array.isArray(ai.data.issues) ? ai.data.issues.slice(0, 8) : [],
      advice: ai.data.advice || fallback.advice,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Image-to-listing assistant
// ─────────────────────────────────────────────────────────────────────────
export async function listingFromImage(opts: {
  actorId: string;
  imageUrl: string;
  categories: string[];
}): Promise<Suggestion<{ title: string; description: string; tags: string[]; category: string | null }>> {
  const fallback = {
    title: "",
    description: "",
    tags: [] as string[],
    category: null as string | null,
  };

  const ai = await askAI<{
    title: string;
    description: string;
    tags: string[];
    category: string | null;
  }>({
    feature: "image_to_listing",
    actorId: opts.actorId,
    actorRole: "seller",
    system: `Look at a product photo and draft a marketplace listing for the seller to review.

Return JSON:
{
  "title": string,          // at most 70 chars, what the product is
  "description": string,    // 2 short paragraphs, only what is visible
  "tags": string[],         // 5-10 lowercase search terms
  "category": string | null // MUST be one of the provided categories, or null
}

Describe only what you can actually see. If you cannot tell the brand, colour
or material, do not guess — leave it out. Never invent a specification.`,
    input: { image_url: opts.imageUrl, categories: opts.categories },
    inputSummary: "image to listing",
    schemaHint: `{ title, description, tags[], category }`,
  });

  if (!ai.ok) return { ok: false, reason: ai.reason, fallback };

  const cat =
    ai.data.category && opts.categories.includes(ai.data.category) ? ai.data.category : null;

  return {
    ok: true,
    cached: ai.cached,
    data: {
      title: (ai.data.title || "").slice(0, 120),
      description: ai.data.description || "",
      tags: Array.isArray(ai.data.tags)
        ? ai.data.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 20)
        : [],
      category: cat,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 8. FAQ generator
// ─────────────────────────────────────────────────────────────────────────
export async function generateFaqs(opts: {
  actorId: string;
  shopName: string;
  policies: string;
  products: string;
}): Promise<Suggestion<{ faqs: { q: string; a: string }[] }>> {
  const fallback = {
    faqs: [
      { q: "How long does delivery take?", a: "Delivery times depend on your location. Message the seller for an estimate." },
      { q: "Can I return an item?", a: "Returns are covered by the NaijaMart refund policy. Open the order to start a return." },
      { q: "Is my payment safe?", a: "Yes. NaijaMart holds your payment in escrow until you confirm delivery." },
    ],
  };

  const ai = await askAI<{ faqs: { q: string; a: string }[] }>({
    feature: "faq_generator",
    actorId: opts.actorId,
    actorRole: "seller",
    system: `Write FAQs for a marketplace shop, using ONLY the policies and
product information provided.

Return JSON: { "faqs": [ { "q": string, "a": string } ] }  // 4-8 entries

Never invent a policy. If the provided policies do not answer something a buyer
would obviously ask, write the answer as "Message the seller" rather than
making up a rule.`,
    input: {
      shop_name: opts.shopName,
      policies: opts.policies,
      products: opts.products,
    },
    inputSummary: `FAQs for ${opts.shopName}`,
    schemaHint: `{ faqs: [{ q, a }] }`,
  });

  if (!ai.ok) return { ok: false, reason: ai.reason, fallback };

  return {
    ok: true,
    cached: ai.cached,
    data: {
      faqs: Array.isArray(ai.data.faqs)
        ? ai.data.faqs
            .filter((f) => f && f.q && f.a)
            .slice(0, 10)
            .map((f) => ({ q: String(f.q), a: String(f.a) }))
        : fallback.faqs,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 15. Seller dashboard insights
// ─────────────────────────────────────────────────────────────────────────
export type SellerInsight = { title: string; detail: string; severity: "info" | "warn" };

export async function sellerInsights(opts: {
  actorId: string;
  shopName: string;
  stats: {
    listings: number;
    withoutImages: number;
    shortDescriptions: number;
    unansweredChats: number;
    lowRating: number;
    views: number;
  };
}): Promise<Suggestion<{ insights: SellerInsight[] }>> {
  // The fallback is genuinely useful: these are rules, not guesses.
  const fallback: { insights: SellerInsight[] } = { insights: [] };
  if (opts.stats.withoutImages > 0)
    fallback.insights.push({
      title: `${opts.stats.withoutImages} listing(s) have no photo`,
      detail: "Listings with a clear photo sell far better. Add one to each.",
      severity: "warn",
    });
  if (opts.stats.shortDescriptions > 0)
    fallback.insights.push({
      title: `${opts.stats.shortDescriptions} listing(s) have a very short description`,
      detail: "Buyers ask fewer questions when the description covers size, material and condition.",
      severity: "info",
    });
  if (opts.stats.unansweredChats > 0)
    fallback.insights.push({
      title: `${opts.stats.unansweredChats} buyer message(s) waiting`,
      detail: "Replying quickly improves your seller score and your ranking.",
      severity: "warn",
    });
  if (fallback.insights.length === 0)
    fallback.insights.push({
      title: "Your shop looks healthy",
      detail: "Photos, descriptions and messages are all in good shape.",
      severity: "info",
    });

  const ai = await askAI<{ insights: SellerInsight[] }>({
    feature: "seller_insights",
    actorId: opts.actorId,
    actorRole: "seller",
    system: `Give a marketplace seller 2-4 short, actionable suggestions based on
the statistics provided.

Return JSON: { "insights": [ { "title": string, "detail": string, "severity": "info" | "warn" } ] }

Only use the numbers provided. Do not invent statistics. Be specific and brief.`,
    input: { shop_name: opts.shopName, stats: opts.stats },
    inputSummary: `insights for ${opts.shopName}`,
    schemaHint: `{ insights: [{ title, detail, severity }] }`,
  });

  if (!ai.ok) return { ok: false, reason: ai.reason, fallback };

  return {
    ok: true,
    cached: ai.cached,
    data: {
      insights: Array.isArray(ai.data.insights)
        ? ai.data.insights
            .filter((i) => i && i.title)
            .slice(0, 5)
            .map((i) => ({
              title: String(i.title),
              detail: String(i.detail ?? ""),
              severity: i.severity === "warn" ? "warn" : "info",
            }))
        : fallback.insights,
    },
  };
}
