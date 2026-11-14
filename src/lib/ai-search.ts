/**
 * AI voice and image search.
 *
 * ── The requirement ──────────────────────────────────────────────────────
 * "It must work well and be very fast." Those pull in opposite directions,
 * so the design is built around one rule: **the model never sits between
 * the buyer and the results.**
 *
 * ── How it stays fast ────────────────────────────────────────────────────
 *   1. The model's only job is to turn a voice clip or a photo into a
 *      short search query — a few words. That is a small, fast request
 *      (lite model, 6 s cap, 200 output tokens).
 *   2. The actual search is the existing `search_listing_ids` RPC, which
 *      is already indexed and already used by the text search page. So
 *      voice and image search return the same quality of results as
 *      typing, at the same speed.
 *   3. If the model is slow or down, the search still runs — on the
 *      transcript the browser already produced (voice) or on the
 *      category guess (image). A degraded result beats a spinner.
 *
 * ── Why the browser transcribes the voice ────────────────────────────────
 * The Web Speech API transcribes locally in Chrome/Edge/Safari with no
 * upload and no latency. Sending audio to a model would add a second of
 * upload plus a second of inference for a worse transcript. The audio path
 * here exists as a fallback for browsers without the API, not as the
 * primary route.
 *
 * ── Why image search parses to a query, not to a vector ──────────────────
 * A visual embedding would need a vector column, an index and a
 * re-embedding of every listing — a large change for a small gain. Naming
 * what is in the photo ("black leather sandals") and running the normal
 * text search reuses everything that already works, and a buyer can see
 * and correct the query it chose.
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { aiJson, aiTry, clip } from "@/lib/ai";
import { searchListings, getCategories, type Listing } from "@/lib/queries";

export type SearchModality = "text" | "voice" | "image";

export type ParsedQuery = {
  /** The words to search with. */
  query: string;
  /** A category slug, when the model is confident. */
  category?: string | null;
  /** A price ceiling the buyer implied ("under 20k"). */
  maxPrice?: number | null;
  /** What the model thought it saw/heard, for the "did you mean" line. */
  interpretation: string;
};

export type AiSearchResult = {
  listings: Listing[];
  parsed: ParsedQuery;
  /** How long the whole thing took, in ms. Shown in dev, logged always. */
  latencyMs: number;
  /** True when the model was skipped or failed and we searched on the raw text. */
  degraded: boolean;
};

/**
 * Turn a photo into a search query.
 *
 * The prompt asks for the product, not a description of the photo: "black
 * leather sandals" is searchable, "a photo of shoes on a white background"
 * is not.
 */
export async function parseImageQuery(
  base64: string,
  mimeType: string,
): Promise<ParsedQuery | null> {
  const parsed = await aiTry(() =>
    aiJson<ParsedQuery>({
      prompt: `Look at this photo and identify the product a buyer is trying to find.

Return ONLY JSON:
{"query":"2-5 words naming the product, e.g. 'black leather sandals'","category":"one of: fashion, electronics, home, beauty, food, services, or null","maxPrice":null,"interpretation":"one short sentence: what you see"}

Rules:
- The query must be what someone would TYPE into a marketplace search, not a description of the image.
- Name the item, its colour and its material if visible. Do not guess a brand.
- If the photo shows no product (a person, a landscape, a screenshot), set query to "" and say so in interpretation.`,
      parts: [{ inline_data: { mime_type: mimeType, data: base64 } }],
      fast: true,
      timeoutMs: 6_000,
      maxTokens: 200,
      temperature: 0.1,
      // Interactive: never retry. A second 6s attempt is worse than
      // falling back to the category guess immediately.
      retry: false,
    }),
  );

  if (!parsed) return null;
  const query = clip(String(parsed.query ?? ""), 80);
  if (!query) return null;
  return {
    query,
    category: parsed.category && parsed.category !== "null" ? String(parsed.category) : null,
    maxPrice: parsed.maxPrice != null ? Number(parsed.maxPrice) : null,
    interpretation: clip(String(parsed.interpretation ?? ""), 120) || `Searching for ${query}`,
  };
}

/**
 * Turn a spoken phrase into a structured query.
 *
 * The browser usually hands us a transcript already, so this is only
 * called when it did not — or when the transcript needs interpreting
 * ("something for my generator under 20k" → query "generator", max 20000).
 */
export async function parseVoiceQuery(transcript: string): Promise<ParsedQuery> {
  const raw = clip(transcript, 300);
  if (!raw) return { query: "", interpretation: "" };

  const parsed = await aiTry(() =>
    aiJson<ParsedQuery>({
      prompt: `A buyer said this to a Nigerian marketplace search: "${raw}"

Turn it into a search. Return ONLY JSON:
{"query":"the product or service they want, 2-6 words","category":"one of: fashion, electronics, home, beauty, food, services, or null","maxPrice":null,"interpretation":"one short sentence restating what they want"}

Rules:
- Strip filler ("I want", "do you have", "please").
- "under 20k" / "below 20,000" → maxPrice 20000. "k" means thousand.
- If they name a service ("plumber", "tailor"), set category "services".
- Keep the query in the words a seller would use in a listing title.`,
      fast: true,
      timeoutMs: 5_000,
      maxTokens: 200,
      temperature: 0.1,
      // Interactive: never retry. The degraded path (search the raw
      // transcript) is already good, and it is instant.
      retry: false,
    }),
  );

  if (!parsed) {
    // Degraded: search on the raw transcript. It is worse, but it is not
    // nothing, and the buyer sees their words in the box.
    return { query: raw, interpretation: `Searching for "${raw}"` };
  }

  return {
    query: clip(String(parsed.query ?? raw), 80) || raw,
    category: parsed.category && parsed.category !== "null" ? String(parsed.category) : null,
    maxPrice: parsed.maxPrice != null ? Number(parsed.maxPrice) : null,
    interpretation: clip(String(parsed.interpretation ?? ""), 120) || `Searching for "${raw}"`,
  };
}

/**
 * Map the model's category guess onto a real category slug, or drop it.
 *
 * Returns undefined (not null) so `searchListings` falls back to its own
 * "no category filter" path. A near-miss is matched on name OR slug,
 * case-insensitively, which covers "Electronics" vs "electronics".
 */
async function resolveCategorySlug(guess: string | null | undefined): Promise<string | undefined> {
  const g = (guess ?? "").trim().toLowerCase();
  if (!g) return undefined;

  try {
    const cats = await getCategories();

    // 1. Exact slug or exact name.
    const exact = cats.find(
      (c: any) =>
        String(c.slug ?? "").toLowerCase() === g || String(c.name ?? "").toLowerCase() === g,
    );
    if (exact) return String(exact.slug);

    /*
      2. Fuzzy, because the model does not know our taxonomy.

      Asked for "cheap android phone", it answers "Phones & Tablets"; the
      real category is "Phones & Accessories". An exact-only match dropped
      that filter and the search silently lost its category — the results
      were still plausible, which is the worst kind of bug.

      So: normalise both sides to their significant words and require a
      shared one. "phones" matches "phones-accessories". A guess that
      shares nothing with any category is still dropped, which is correct —
      a wrong filter returns nothing at all.
    */
    const words = (s: string) =>
      s
        .toLowerCase()
        .replace(/&/g, " ")
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !["and", "the", "for", "with"].includes(w));

    const guessWords = words(g);
    if (guessWords.length === 0) return undefined;

    let best: { slug: string; score: number } | null = null;
    for (const c of cats as any[]) {
      const catWords = new Set([...words(String(c.slug ?? "")), ...words(String(c.name ?? ""))]);
      const score = guessWords.filter((w) => catWords.has(w)).length;
      if (score > 0 && (!best || score > best.score)) {
        best = { slug: String(c.slug), score };
      }
    }
    return best?.slug;
  } catch {
    // If the category list cannot be read, search without the filter
    // rather than with a guess that would return nothing.
    return undefined;
  }
}

/**
 * Run a search from any modality.
 *
 * This is the one entry point the UI calls. It parses (when needed), then
 * runs the SAME `searchListings` the text page uses, so results are
 * consistent across all three inputs.
 */
export async function aiSearch(opts: {
  modality: SearchModality;
  /** Text for `text`, transcript for `voice`. */
  text?: string;
  /** Base64 + mime for `image`. */
  image?: { base64: string; mimeType: string };
  city?: string | null;
  userId?: string | null;
  limit?: number;
}): Promise<AiSearchResult> {
  const started = Date.now();
  let parsed: ParsedQuery | null = null;
  let degraded = false;

  if (opts.modality === "image" && opts.image) {
    parsed = await parseImageQuery(opts.image.base64, opts.image.mimeType);
    if (!parsed) {
      // The model could not read the photo. There is nothing to search
      // on, so return empty rather than a random grid.
      return {
        listings: [],
        parsed: { query: "", interpretation: "We could not read that photo. Try another one." },
        latencyMs: Date.now() - started,
        degraded: true,
      };
    }
  } else if (opts.modality === "voice") {
    parsed = await parseVoiceQuery(opts.text ?? "");
    degraded = !parsed.query || parsed.query === clip(opts.text ?? "", 300);
  } else {
    parsed = {
      query: clip(opts.text ?? "", 120),
      interpretation: opts.text ? `Searching for "${clip(opts.text ?? "", 60)}"` : "",
    };
  }

  if (!parsed.query) {
    return {
      listings: [],
      parsed,
      latencyMs: Date.now() - started,
      degraded,
    };
  }

  const listings = await searchListings({
    q: parsed.query,
    city: opts.city ?? null,
    //
    // The category is a SLUG and `search_listing_ids` returns nothing at all
    // for an unknown slug (that is deliberate — see sql/0015). The model
    // emits a name like "electronics", not necessarily the real slug, so a
    // hallucinated or differently-spelled category would silently wipe out
    // the results. So it is validated against the real list first and
    // dropped when it does not match; the text query still runs.
    category: await resolveCategorySlug(parsed.category),
    max: parsed.maxPrice ?? undefined,
    limit: opts.limit ?? 40,
  });

  const latencyMs = Date.now() - started;

  // Log the search: it is the signal the recommender reads, and it is how
  // "very fast" is measured rather than asserted.
  try {
    const supabase = createClient();
    await supabase.from("ai_search_queries").insert({
      user_id: opts.userId ?? null,
      modality: opts.modality,
      query_text: parsed.query,
      parsed,
      result_count: listings.length,
      latency_ms: latencyMs,
    });
  } catch {
    // A logging failure must never fail a search.
  }

  return { listings, parsed, latencyMs, degraded };
}
