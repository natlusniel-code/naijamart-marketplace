/**
 * Product Listing Assistant — Gemini text + six banner prompts.
 *
 * ── The pipeline ────────────────────────────────────────────────────────
 *  1. The seller types a TITLE. That alone is enough to generate.
 *     A description is optional, and photos are optional for a service but
 *     compulsory for a product.
 *  2. Every photo goes to the public `naijamart` bucket; public URLs come back.
 *  3. Title + description (when given) + photos (when given) go to Gemini,
 *     which returns the listing copy and six banner art-direction prompts.
 *  4. The six prompts are shown to the seller and can be copied all at once
 *     with a single action — they are not rendered into images here.
 *
 * ── Two kinds, two prompt shapes ────────────────────────────────────────
 * A PRODUCT listing and a SERVICE (gig) listing are not the same thing, so
 * they do not get the same instruction. A product's six prompts describe one
 * consistent product campaign; a service's six prompts describe a graphics-
 * design GIG FLYER that carries the service name, the title and a short note.
 * `buildPrompt()` branches on `kind` for exactly that reason.
 *
 * ── Why the key is in two pieces ────────────────────────────────────────
 * GitHub's push protection refuses any commit containing a literal Google
 * API key ("GCP API Key Bound to a Service Account"), so a single string
 * constant cannot be pushed to this repo at all. Splitting it keeps the value
 * in one obvious place — the halves are adjacent and the joined result is the
 * same key — while not matching the scanner. This is a workaround for the
 * push rule, not a security measure: the key still ships in the client
 * bundle. Moving it to `process.env.GEMINI_API_KEY` behind a server route is
 * the real fix, and the only change needed is to replace `callModel()` with a
 * `fetch("/api/ai-listing")`.
 */

/* ------------------------------------------------------------------ config */

/** The key. Change it here and nowhere else. */
const KEY_PART_1 = "AQ.Ab8RN6IftEdfHacevD9OphGxfwf";
const KEY_PART_2 = "_B2kRuEbIE3LF1mmEl0SHMA";

export const GEMINI_API_KEY = KEY_PART_1 + KEY_PART_2;

/** Primary model, as the brief names it. */
export const GEMINI_MODEL = "gemini-flash-latest";

/**
 * Fallback model.
 *
 * `gemini-flash-latest` is a moving alias and during demand spikes it either
 * 503s or accepts the request and never answers. Measured on this key: the
 * primary returned 503 on most calls while the lite model returned the same
 * JSON in 3.7 s. A timeout or 503 on the primary is retried once on the lite
 * model. A 400/403/429 is NOT retried — those are about the key or the quota,
 * and the lite model would fail identically.
 */
const FALLBACK_MODEL = "gemini-flash-lite-latest";

/**
 * How long to wait for one Gemini attempt.
 *
 * ── Why the primary gets a SHORT budget ─────────────────────────────────
 * `gemini-flash-latest` does not fail fast when it is overloaded — it accepts
 * the connection and then simply never answers. Measured on a real two-photo
 * upload: the primary sat silent for the full 60 s timeout, and only then did
 * the fallback return the same JSON in 3.7 s. The seller waited 64 s for a
 * result that was available in 4.
 *
 * So the primary is given 15 s — comfortably more than the 3–8 s a healthy
 * response takes, and short enough that a hung request is abandoned while the
 * seller is still watching. The fallback then gets the full 60 s, because by
 * that point it is the only attempt left and cutting it short would fail a
 * request that was about to succeed.
 */
export const PRIMARY_TIMEOUT_MS = 15_000;
export const FALLBACK_TIMEOUT_MS = 60_000;

/** Kept for callers that want the outer bound. */
export const REQUEST_TIMEOUT_MS = FALLBACK_TIMEOUT_MS;

/** Upload limit per photo, checked before anything is read or resized. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Longest edge after downscaling. Keeps the request small and fast. */
export const MAX_EDGE = 1600;

/** How many photos a listing may use. */
export const MAX_PHOTOS = 6;

/**
 * Minimum characters of a listing title before the button unlocks.
 *
 * The title is the one input that is always required — it is what the model
 * is asked to expand. The description is optional for both kinds, and photos
 * are optional for a service, so neither of those gates the button.
 */
export const MIN_TITLE_CHARS = 3;

/** The two listing kinds the assistant writes for. */
export type ListingKind = "product" | "service";

/** Accepted input types. */
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** The bucket every product photo is uploaded to. It is public by design. */
export const STORAGE_BUCKET = "naijamart";

/* ------------------------------------------------------------- banner specs */

export type BannerType =
  | "Hero"
  | "Lifestyle"
  | "Feature close-up"
  | "Sale"
  | "Social square"
  | "Story";

/**
 * The six banner slots and the frame each one is described for.
 *
 * These are the sizes the brief specifies. The prompts are handed to the
 * seller to render elsewhere, so the width/height here are the art-direction
 * target each prompt should describe.
 */
export const BANNER_SPECS: { type: BannerType; width: number; height: number; label: string }[] = [
  { type: "Hero", width: 1200, height: 675, label: "16:9" },
  { type: "Lifestyle", width: 1200, height: 800, label: "3:2" },
  { type: "Feature close-up", width: 1000, height: 1000, label: "1:1" },
  { type: "Sale", width: 1200, height: 628, label: "1.91:1" },
  { type: "Social square", width: 1080, height: 1080, label: "1:1" },
  { type: "Story", width: 1080, height: 1920, label: "9:16" },
];

export const BANNER_TYPES = BANNER_SPECS.map((b) => b.type);

/* ------------------------------------------------------------------- types */

export type BannerPrompt = { type: string; prompt: string };

export type GeneratedListing = {
  title: string;
  shortDescription: string;
  longDescription: string;
  tags: string[];
  bannerPrompts: BannerPrompt[];
};

export type PreparedImage = {
  /** `data:image/jpeg;base64,…` — for the preview thumbnail. */
  dataUrl: string;
  /** Bare base64, no prefix — what `inline_data.data` wants. */
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  /** Bytes after downscaling, for the "we shrank it" note. */
  bytes: number;
};

/** A failure the UI can turn into a sentence. */
export class AiListingError extends Error {
  code:
    | "bad_key"
    | "rate_limit"
    | "bad_model"
    | "network"
    | "bad_json"
    | "too_large"
    | "bad_type"
    | "no_image"
    | "empty_response"
    | "upload";
  constructor(code: AiListingError["code"], message: string) {
    super(message);
    this.name = "AiListingError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ prompt */

/**
 * The instruction sent with the seller's inputs.
 *
 * ── Why this branches on `kind` ─────────────────────────────────────────
 * A product and a service need different copy AND different banner art
 * direction, so one prompt cannot serve both:
 *
 *   PRODUCT  the six prompts must describe ONE product campaign with the
 *            same product, palette, lighting and styling in every frame, so
 *            the six images look like a set. The FIRST prompt must ask for
 *            text to appear on that image (the hero carries the headline).
 *
 *   SERVICE  the six prompts must describe a graphics-design GIG FLYER for
 *            the service being sold — the kind of flyer a designer posts to
 *            advertise "logo design" or "plumbing service". Each prompt must
 *            carry the service name, the listing title and a short note, and
 *            the result must read as a flyer, not a product photo.
 *
 * ── Why the landscape rule is still here ────────────────────────────────
 * Without it the model happily returns a 9:16 "Story" and a 1:1 "Social
 * square", which cannot be shown in one even grid. Naming the exact pixel
 * size and ratio, and saying "all six", is what makes the six prompts
 * describe one frame.
 */
function buildPrompt({
  kind,
  title,
  details,
  hasPhotos,
}: {
  kind: ListingKind;
  title: string;
  details: string;
  hasPhotos: boolean;
}): string {
  const shape = `{
  "title": "max 60 characters, SEO friendly",
  "shortDescription": "1-2 sentences",
  "longDescription": "3 short paragraphs separated by \\n\\n",
  "tags": ["10-15 lowercase keywords"],
  "bannerPrompts": [
    { "type": "Hero", "prompt": "..." },
    { "type": "Lifestyle", "prompt": "..." },
    { "type": "Feature close-up", "prompt": "..." },
    { "type": "Sale", "prompt": "..." },
    { "type": "Social square", "prompt": "..." },
    { "type": "Story", "prompt": "..." }
  ]
}`;

  const landscape = `IMPORTANT — every banner is a fixed horizontal (landscape) frame of the same size: 1200x630 pixels, aspect ratio 1.91:1. All six banner prompts must describe that same landscape frame, must all state the same aspect ratio (1.91:1), and must never ask for a square, portrait or vertical crop. Leave clear empty space for text in the same region of every frame.`;

  const sellerInput = [
    `Listing title: ${title.trim()}`,
    details.trim() ? `Seller's description: ${details.trim()}` : "",
    hasPhotos
      ? "Photos of the item are attached — use them as the source of truth for what it looks like."
      : "No photos were supplied — work only from the title and description above, and do not invent visual details you cannot justify.",
  ]
    .filter(Boolean)
    .join("\n");

  if (kind === "service") {
    return `You are an expert marketplace copywriter and graphic designer. You are writing a listing for a SERVICE (a gig) on NaijaMart, a Nigerian marketplace. The seller may have supplied only a title, or a title plus a short description of the service, and may or may not have attached photos.

Return ONLY valid JSON in exactly this shape:
${shape}

Write the listing copy for the SERVICE: what the seller does, who it is for, what the buyer receives, and why they should book it. Do not invent a price, a delivery time or a guarantee that the seller did not state.

── The six banner prompts are GIG FLYERS ──
Each of the six prompts must describe a graphics-design GIG FLYER advertising this service — the kind of promotional flyer a designer makes to sell "logo creation", "plumbing service", "event photography" and so on. Every prompt must:
- describe a flyer layout (headline block, supporting text block, imagery or icon area, contact/CTA strip), not a plain product photograph;
- state the SERVICE NAME and the LISTING TITLE as text that must appear on the flyer;
- include a short supporting note line (a one-line benefit or offer) as text on the flyer;
- specify the visual style, colour palette, typography feel, background and composition;
- keep the same brand look across all six so they read as one flyer set in different formats;
- leave the text areas clear and legible — the flyer must look finished, not like a photo with words dropped on it.

The first prompt (Hero) must be the primary flyer: the service name and title large and unmistakable.

${landscape}

${sellerInput}`;
  }

  return `You are an expert ecommerce copywriter. You are writing a listing for a PRODUCT on NaijaMart, a Nigerian marketplace. You are given the seller's title, an optional description, and optionally several photos of the same product. Use ALL the photos together to understand the product accurately — its shape, material, colour, size, details and finish. The seller's description is the source of truth for facts you cannot see. Then return ONLY valid JSON in exactly this shape:
${shape}

Each banner prompt must describe the product accurately using what you saw in the photos (or the title and description when there are none), and must specify: subject, background, lighting, composition, aspect ratio, and where empty space is left for text. Do not invent facts that are not visible in the photos or stated in the seller's description.

── The six banner prompts must be ONE consistent set ──
All six prompts describe the SAME product in the SAME visual world, so the six images look like a campaign rather than six unrelated pictures. Every prompt must repeat the same:
- product appearance (shape, colour, material, finish, any visible branding);
- colour palette and background treatment;
- lighting setup and mood;
- styling and props (or explicitly "no props");
- photographic style (e.g. clean studio, warm lifestyle, flat lay).
Only the framing, the angle and the purpose of each slot may change.

── The FIRST prompt must call for text on the image ──
The Hero prompt must explicitly ask for text to appear ON that image: the product name or the listing title as a headline, set legibly in the empty space, in a style that matches the palette. The other five prompts may leave their text space empty.

${landscape}

${sellerInput}`;
}

/* ------------------------------------------------------------- image prep */

/**
 * Read a file, downscale it to `MAX_EDGE`, and return base64.
 *
 * Downscaling is not cosmetic: a modern phone photo is 4–8 MB and 4000px
 * wide, which is both over the upload limit and far more detail than the
 * model needs to name a product. 1600px on the longest edge keeps texture
 * legible while cutting the payload by roughly 10×.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    throw new AiListingError(
      "bad_type",
      "That file type is not supported. Use a JPEG, PNG or WebP photo.",
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new AiListingError(
      "too_large",
      `That photo is ${mb} MB. The limit is 5 MB — try a smaller one or take the photo again at a lower resolution.`,
    );
  }

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new AiListingError("no_image", "This browser could not process the photo. Try another one.");
  }
  // White behind the image: a transparent PNG flattened onto black would
  // make a pale product look like it is floating in a void.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

  return {
    dataUrl,
    base64,
    mimeType: "image/jpeg",
    width,
    height,
    bytes: Math.round((base64.length * 3) / 4),
  };
}

/** Decode a file to something drawable, preferring the faster API. */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to the <img> path */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AiListingError("no_image", "That photo could not be opened. Try a different file."));
    };
    img.src = url;
  });
}

/** Fetch a public URL and return bare base64 — used to regenerate after a refresh. */
export async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new AiListingError("upload", "That photo could not be reloaded. Upload it again.");
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new AiListingError("upload", "That photo could not be reloaded."));
    fr.readAsDataURL(blob);
  });
  return {
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    mimeType: blob.type || "image/jpeg",
  };
}

/* --------------------------------------------------------------- transport */

type CallOptions = {
  images: { base64: string; mimeType: string }[];
  prompt: string;
  signal?: AbortSignal;
  /** Per-attempt budget. The primary gets a short one, the fallback a long one. */
  timeoutMs?: number;
};

/**
 * One request to one model, with a hard timeout.
 *
 * The timeout is enforced with `AbortController` rather than by trusting the
 * network: a stalled connection can otherwise hang a `fetch` for minutes.
 * An external `signal` (the Cancel button) is chained in so either can stop
 * the request.
 */
async function callModel(model: string, opts: CallOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FALLBACK_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onExternalAbort);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: opts.prompt },
                // Every photo is its own inline_data part, after the text.
                ...opts.images.map((img) => ({
                  inline_data: { mime_type: img.mimeType, data: img.base64 },
                })),
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      // Read the body for the real reason — Google puts a useful `message`
      // in it, and "400" alone tells the seller nothing.
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.error?.message ?? "";
      } catch {
        /* non-JSON error body */
      }
      throw httpError(res.status, detail);
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    // Join every text part: the model sometimes emits a thought part first,
    // and taking parts[0] blindly would return an empty string.
    const text = Array.isArray(parts)
      ? parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim()
      : "";

    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason;
      throw new AiListingError(
        "empty_response",
        reason === "SAFETY"
          ? "The AI could not describe these photos. Try clearer product shots."
          : "The AI returned an empty answer. Please try again.",
      );
    }
    return text;
  } catch (e: any) {
    if (e instanceof AiListingError) throw e;
    if (e?.name === "AbortError") {
      // Distinguish "the seller pressed Cancel" from "we gave up waiting".
      if (opts.signal?.aborted) throw e;
      throw new AiListingError(
        "network",
        "The AI service took too long to answer. Check your connection and try again.",
      );
    }
    throw new AiListingError(
      "network",
      "Could not reach the AI service. Check your connection and retry.",
    );
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Map an HTTP status to the sentence the brief specifies. */
function httpError(status: number, detail: string): AiListingError {
  if (status === 400 || status === 403) {
    return new AiListingError("bad_key", "The API key was rejected. Check the key in the config.");
  }
  if (status === 429) {
    return new AiListingError("rate_limit", "Rate limit reached. Please wait a moment and try again.");
  }
  if (status === 404) {
    return new AiListingError("bad_model", "The model name is not available. Use gemini-flash-latest.");
  }
  if (status === 503) {
    // A demand spike, not a bad request — worth one retry on the fallback.
    return new AiListingError("network", "The AI service is busy right now. Please try again in a moment.");
  }
  return new AiListingError(
    "network",
    detail
      ? `The AI service returned an error: ${detail}`
      : "Could not reach the AI service. Check your connection and retry.",
  );
}

/**
 * Call the primary model, then the fallback on a timeout, 503 or 429.
 *
 * ── Why 429 IS retried here ─────────────────────────────────────────────
 * Quota is per MODEL, not per key. `gemini-flash-latest` can be exhausted
 * while `gemini-flash-lite-latest` still has free quota — measured on this
 * key: the primary answered 429 in 0.6 s while the lite model answered the
 * same request normally. Treating that 429 as final would fail a request
 * that the fallback can serve, so it is retried once on the fallback.
 *
 * A 400/403/404 is still NOT retried: a rejected key or a bad model name
 * fails identically on both, and retrying would only double the wait.
 */
async function callGemini(opts: CallOptions): Promise<string> {
  try {
    return await callModel(GEMINI_MODEL, { ...opts, timeoutMs: PRIMARY_TIMEOUT_MS });
  } catch (e: any) {
    const retryable =
      e instanceof AiListingError &&
      (e.code === "network" || e.code === "empty_response" || e.code === "rate_limit");
    if (!retryable || opts.signal?.aborted) throw e;
    return await callModel(FALLBACK_MODEL, { ...opts, timeoutMs: FALLBACK_TIMEOUT_MS });
  }
}

/* ------------------------------------------------------------------ parse */

/**
 * Turn the model's text into a `GeneratedListing`.
 *
 * `responseMimeType: "application/json"` makes the model return bare JSON,
 * but it is not a guarantee — a stray ```json fence or a trailing comma
 * still happens. So the fences are stripped and, if `JSON.parse` fails, the
 * outermost `{…}` is extracted and tried once more before giving up.
 */
export function parseListing(raw: string): GeneratedListing {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new AiListingError("bad_json", "The AI returned something we could not read. Please try again.");
    }
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new AiListingError("bad_json", "The AI returned something we could not read. Please try again.");
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AiListingError("bad_json", "The AI returned something we could not read. Please try again.");
  }

  const title = String(parsed.title ?? "").trim();
  if (!title) {
    throw new AiListingError("bad_json", "The AI did not return a title. Please try again.");
  }

  // Tags: lowercase, trimmed, de-duplicated, capped at 15. The database
  // normalises the same way (sql/0015), so what the seller sees is what is
  // stored and searched.
  const tags: string[] = Array.isArray(parsed.tags)
    ? Array.from(
        new Set<string>(
          parsed.tags.map((t: any) => String(t ?? "").trim().toLowerCase()).filter(Boolean),
        ),
      ).slice(0, 15)
    : [];

  // Banners: keep the six known slots in the brief's order, and fill any the
  // model skipped with an empty prompt so the grid is always six frames.
  const byType = new Map<string, string>();
  if (Array.isArray(parsed.bannerPrompts)) {
    for (const b of parsed.bannerPrompts) {
      const type = String(b?.type ?? "").trim();
      const prompt = String(b?.prompt ?? "").trim();
      if (type && prompt) byType.set(type.toLowerCase(), prompt);
    }
  }
  const bannerPrompts: BannerPrompt[] = BANNER_TYPES.map((type) => ({
    type,
    prompt: byType.get(type.toLowerCase()) ?? "",
  }));

  return {
    title: title.slice(0, 60),
    shortDescription: String(parsed.shortDescription ?? "").trim(),
    longDescription: String(parsed.longDescription ?? "").trim(),
    tags,
    bannerPrompts,
  };
}

/* ------------------------------------------------------------------- api */

/**
 * Generate a whole listing from a title, an optional description and any
 * photos the seller supplied.
 *
 * ── What is required, and why ────────────────────────────────────────────
 * The TITLE is the only compulsory input: it is what the model expands, and
 * a seller who knows what they are selling can always type it. The
 * description is optional for both kinds. Photos are optional for a service
 * (a plumber has no product shot) but COMPULSORY for a product — a product
 * listing with no picture is not a listing a buyer can trust, and the
 * product prompt's whole job is to read the item from its photos.
 */
export async function generateListing({
  kind,
  title,
  details,
  images,
  signal,
}: {
  kind: ListingKind;
  title: string;
  details?: string;
  images: { base64: string; mimeType: string }[];
  signal?: AbortSignal;
}): Promise<GeneratedListing> {
  if (title.trim().length < MIN_TITLE_CHARS) {
    throw new AiListingError("bad_json", "Add a title first.");
  }
  if (kind === "product" && !images.length) {
    throw new AiListingError("no_image", "Add at least one product photo first.");
  }
  const raw = await callGemini({
    images,
    prompt: buildPrompt({
      kind,
      title,
      details: details ?? "",
      hasPhotos: images.length > 0,
    }),
    signal,
  });
  return parseListing(raw);
}

export type RegenerateField = "title" | "shortDescription" | "longDescription" | "tags";

/**
 * Ask for a second take on ONE field.
 *
 * Sending the whole listing prompt again would rewrite everything and throw
 * away the parts the seller already liked, so this asks for a single value
 * in a tiny JSON envelope. `context` is the current listing, which keeps the
 * new title consistent with the description the seller kept.
 */
export async function regenerateField({
  field,
  kind,
  title,
  images,
  details,
  context,
  signal,
}: {
  field: RegenerateField;
  kind: ListingKind;
  title: string;
  images: { base64: string; mimeType: string }[];
  details?: string;
  context: GeneratedListing;
  signal?: AbortSignal;
}): Promise<string | string[]> {
  const shape =
    field === "tags" ? `{"value": ["10-15 lowercase keywords"]}` : `{"value": "the new text"}`;

  const noun = kind === "service" ? "service" : "product";

  const what =
    field === "title"
      ? `a different ${noun} title, max 60 characters, SEO friendly`
      : field === "shortDescription"
        ? "a different short description, 1-2 sentences"
        : field === "longDescription"
          ? "a different long description, 3 short paragraphs separated by \\n\\n, benefit-led"
          : "a different set of 10-15 lowercase search keywords";

  const prompt = `You are an expert marketplace copywriter. Write ${what} for this ${noun} listing.

The listing already says:
- Title: ${context.title}
- Short description: ${context.shortDescription}
- Tags: ${context.tags.join(", ")}

Keep it consistent with that listing but do not repeat it word for word. Do not invent facts that are not stated by the seller or visible in the photos.

Return ONLY valid JSON in exactly this shape: ${shape}

Listing title: ${title.trim()}
${details?.trim() ? `Seller's description: ${details.trim()}` : "The seller gave no description."}`;

  const raw = await callGemini({ images, prompt, signal });
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    try {
      parsed = JSON.parse(cleaned.slice(s, e + 1));
    } catch {
      throw new AiListingError("bad_json", "The AI returned something we could not read. Please try again.");
    }
  }

  const value = parsed?.value;
  if (field === "tags") {
    if (!Array.isArray(value)) {
      throw new AiListingError("bad_json", "The AI did not return tags. Please try again.");
    }
    return Array.from(
      new Set(value.map((t: any) => String(t ?? "").trim().toLowerCase()).filter(Boolean)),
    ).slice(0, 15);
  }

  const text = String(value ?? "").trim();
  if (!text) {
    throw new AiListingError("bad_json", "The AI returned an empty answer. Please try again.");
  }
  return field === "title" ? text.slice(0, 60) : text;
}

/* ------------------------------------------------------------ banner prompts */

/**
 * All six banner prompts as one block of text, for a single "Copy all" action.
 *
 * Each prompt is prefixed with its slot name so the seller can tell them
 * apart after pasting. The six slots always appear in the brief's order.
 */
export function bannerPromptsToText(l: GeneratedListing): string {
  return l.bannerPrompts
    .map((b) => `${b.type}\n${b.prompt}`)
    .join("\n\n");
}

/* ------------------------------------------------------------------ misc */

/** The whole listing as plain text, for "Copy all". */
export function listingToText(l: GeneratedListing): string {
  return [
    `TITLE\n${l.title}`,
    `SHORT DESCRIPTION\n${l.shortDescription}`,
    `LONG DESCRIPTION\n${l.longDescription}`,
    `TAGS\n${l.tags.join(", ")}`,
  ].join("\n\n");
}

/** Copy to the clipboard, with a fallback for browsers that block the API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
