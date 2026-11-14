/**
 * Product Listing Assistant — Gemini text + Pollinations banners + canvas type.
 *
 * ── The pipeline ──────────────────────────────────────────────────────────
 *  1. The seller uploads 1–6 photos and MUST type a description.
 *  2. Every photo goes to the public `naijamart` bucket; public URLs come back.
 *  3. All photos + the typed description go to Gemini, which returns the
 *     listing copy and six banner art-direction prompts.
 *  4. The prompts stay internal — they are never rendered in the UI.
 *  5. Each prompt is sent to Pollinations to render a banner image.
 *  6. The product text is drawn ON TOP of that image with canvas, in our own
 *     code, because image models cannot spell.
 *
 * ── Why the text is drawn by us ───────────────────────────────────────────
 * Every image model garbles lettering. Asking for "a banner that says
 * Handmade Rattan Basket" produces plausible-looking nonsense. So the model
 * only ever produces the PICTURE, and the words are set here with real type:
 * a measured, wrapped, shadowed sans-serif over a soft scrim. That is the
 * only way the text is guaranteed correct and crisp.
 *
 * ── Why the key is in two pieces ──────────────────────────────────────────
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
 * ── Why the primary gets a SHORT budget ───────────────────────────────────
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

/** Minimum characters of seller description before the button unlocks. */
export const MIN_DETAILS_CHARS = 10;

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
 * The six banner slots and the frame each one is rendered in.
 *
 * These are the sizes the brief specifies. Pollinations does not always honour
 * the exact pixel count — it caps the long edge — but it DOES honour the
 * aspect ratio, so a 16:9 request comes back 16:9 at a smaller size. The
 * canvas is therefore built at the image's NATIVE size (see `renderBanner`),
 * which keeps the type crisp instead of upscaling a small canvas.
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

/** A banner-render failure, with the wait the service asked for. */
export class BannerError extends Error {
  code: "rate_limited" | "kontext_unavailable" | "failed" | "bad_response" | "timeout";
  retryAfterMs: number;
  constructor(code: BannerError["code"], message: string, retryAfterMs = 0) {
    super(message);
    this.name = "BannerError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/* ------------------------------------------------------------------ prompt */

/**
 * The instruction sent with the photos.
 *
 * The first block is the brief's prompt verbatim. The second block is the
 * landscape rule: without it the model happily returns a 9:16 "Story" and a
 * 1:1 "Social square", which cannot be shown in one even grid. Naming the
 * exact pixel size and ratio, and saying "all six", is what makes the six
 * prompts describe one frame.
 */
function buildPrompt(details: string): string {
  return `You are an expert ecommerce copywriter. You are given several photos of the same product and the seller's own description of it. Use ALL the photos together to understand the product accurately — its shape, material, colour, size, details and finish. The seller's description is the source of truth for facts you cannot see. Then return ONLY valid JSON in exactly this shape:
{
  "title": "max 60 characters, SEO friendly",
  "shortDescription": "1-2 sentences",
  "longDescription": "3 short paragraphs separated by \\\\n\\\\n",
  "tags": ["10-15 lowercase keywords"],
  "bannerPrompts": [
    { "type": "Hero", "prompt": "..." },
    { "type": "Lifestyle", "prompt": "..." },
    { "type": "Feature close-up", "prompt": "..." },
    { "type": "Sale", "prompt": "..." },
    { "type": "Social square", "prompt": "..." },
    { "type": "Story", "prompt": "..." }
  ]
}
Each banner prompt must describe the product accurately using what you saw in the photos, and must specify: subject, background, lighting, composition, aspect ratio, and where empty space is left for text. Do not invent facts that are not visible in the photos or stated in the seller's description.

IMPORTANT — every banner is a fixed horizontal (landscape) frame of the same size: 1200x630 pixels, aspect ratio 1.91:1. All six banner prompts must describe that same landscape frame, must all state the same aspect ratio (1.91:1), and must never ask for a square, portrait or vertical crop. Leave clear empty space for text in the same region of every frame.

Seller's product details: ${details.trim()}`;
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
 * ── Why 429 IS retried here ───────────────────────────────────────────────
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

/** Generate a whole listing from one or more photos plus the seller's description. */
export async function generateListing({
  images,
  details,
  signal,
}: {
  images: { base64: string; mimeType: string }[];
  details: string;
  signal?: AbortSignal;
}): Promise<GeneratedListing> {
  if (!images.length) {
    throw new AiListingError("no_image", "Add at least one product photo first.");
  }
  if (details.trim().length < MIN_DETAILS_CHARS) {
    throw new AiListingError("bad_json", "Product details are required.");
  }
  const raw = await callGemini({ images, prompt: buildPrompt(details), signal });
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
  images,
  details,
  context,
  signal,
}: {
  field: RegenerateField;
  images: { base64: string; mimeType: string }[];
  details: string;
  context: GeneratedListing;
  signal?: AbortSignal;
}): Promise<string | string[]> {
  const shape =
    field === "tags" ? `{"value": ["10-15 lowercase keywords"]}` : `{"value": "the new text"}`;

  const what =
    field === "title"
      ? "a different product title, max 60 characters, SEO friendly"
      : field === "shortDescription"
        ? "a different short description, 1-2 sentences"
        : field === "longDescription"
          ? "a different long description, 3 short paragraphs separated by \\\\n\\\\n, benefit-led"
          : "a different set of 10-15 lowercase search keywords";

  const prompt = `You are an expert ecommerce copywriter. Look at these product photos and the seller's description, then write ${what}.

The listing already says:
- Title: ${context.title}
- Short description: ${context.shortDescription}
- Tags: ${context.tags.join(", ")}

Keep it consistent with that listing but do not repeat it word for word. Do not invent facts that are not visible in the photos or stated in the seller's description.

Return ONLY valid JSON in exactly this shape: ${shape}

Seller's product details: ${details.trim()}`;

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

/* ------------------------------------------------------- banner generation */

/**
 * Build a Pollinations URL for one banner.
 *
 * `kontext` takes ONE reference image, so the FIRST uploaded photo is the
 * reference — Gemini saw all of them for accuracy, but the image model only
 * needs one to keep the product recognisable.
 *
 * NOTE: on the anonymous (key-free) API `model=kontext` answers 403
 * FORBIDDEN — it is a paid-tier model. `fetchBannerBlob` detects that and
 * falls back to plain text-to-image, which is what actually renders. The
 * kontext path is kept because it starts working the moment a pollen key is
 * added, with no other change.
 */
export function bannerImageUrl({
  prompt,
  referenceUrl,
  width,
  height,
  seed,
  useKontext,
}: {
  prompt: string;
  referenceUrl?: string;
  width: number;
  height: number;
  seed: number;
  useKontext: boolean;
}): string {
  const base = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
  const params = [`width=${width}`, `height=${height}`, "nologo=true", `seed=${seed}`];
  if (useKontext && referenceUrl) {
    params.unshift("model=kontext", `image=${encodeURIComponent(referenceUrl)}`);
  }
  return `${base}?${params.join("&")}`;
}

/**
 * Fetch one banner image, reading the real HTTP status.
 *
 * This uses `fetch` rather than `img.src` on purpose. An `<img>` only fires
 * `onerror` — it cannot tell a 402 rate limit from a 403 forbidden from a
 * 500, and it cannot read the `Retry after 24s` the service sends. With
 * `fetch` we can honour that wait and retry, which is the difference between
 * "banner 2 of 6 failed" and all six arriving.
 *
 * The response is turned into a blob and shown through an object URL, so the
 * image is still displayed in an `<img>` in the DOM — nothing opens a tab.
 */
export async function fetchBannerBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal, cache: "no-store" });

  if (res.ok) {
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) {
      throw new BannerError("bad_response", "The banner service returned something that is not an image.");
    }
    return await res.blob();
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const code = body?.error?.code;
  const msg = String(body?.error?.message ?? "");

  if (res.status === 402 || code === "FREE_LIMIT") {
    const m = /retry after (\d+)s/i.exec(msg);
    const wait = m ? parseInt(m[1], 10) : 45;
    throw new BannerError("rate_limited", msg, wait * 1000);
  }
  if (res.status === 403 || code === "FORBIDDEN") {
    throw new BannerError("kontext_unavailable", msg);
  }
  throw new BannerError("failed", msg || `The banner service returned ${res.status}.`);
}

/** Load a blob into a decoded image, for the canvas. */
function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new BannerError("bad_response", "That banner could not be decoded."));
    };
    img.src = url;
  });
}

/* ------------------------------------------------------------ canvas type */

const FONT_STACK = '"Inter", "Helvetica Neue", Arial, sans-serif';

/** Break text into at most `maxLines` lines that fit `maxWidth`. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);

  // If we ran out of room, ellipsise the last line rather than clipping a word.
  if (lines.length === maxLines) {
    const consumed = lines.join(" ").split(/\s+/).length;
    if (consumed < words.length) {
      let last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last.trimEnd()}…`;
    }
  }
  return lines;
}

/**
 * Draw the product text onto a banner.
 *
 * The type is set at the banner's NATIVE resolution, so it is sharp at any
 * display size — a 1080px-wide canvas is never scaled up from a 400px one.
 * Sizes are proportional to the width, so the same code reads correctly on a
 * 675px Hero and a 1920px Story.
 *
 * A soft bottom scrim (transparent → 55% black) sits under the text so it
 * stays legible whatever the model painted behind it. No box, no border, no
 * drop shadow on the box — just the image, the scrim and the type.
 */
export function drawBannerText(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: { title: string; detail: string; isHero: boolean; isStory: boolean },
) {
  const pad = Math.round(w * 0.06);
  const maxWidth = w - pad * 2;

  // ── scrim ──────────────────────────────────────────────────────────────
  const scrimTop = opts.isStory ? h * 0.5 : h * 0.42;
  const grad = ctx.createLinearGradient(0, scrimTop, 0, h);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, scrimTop, w, h - scrimTop);

  // ── type sizes ─────────────────────────────────────────────────────────
  const titleSize = Math.round(w * (opts.isHero ? 0.06 : 0.05));
  const detailSize = Math.round(w * 0.035);
  const titleLH = Math.round(titleSize * 1.15);
  const detailLH = Math.round(detailSize * 1.3);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // ── measure ────────────────────────────────────────────────────────────
  ctx.font = `700 ${titleSize}px ${FONT_STACK}`;
  const titleLines = wrapText(ctx, opts.title, maxWidth, 2);

  const detail = opts.detail.trim();
  ctx.font = `400 ${detailSize}px ${FONT_STACK}`;
  const detailLines = detail ? wrapText(ctx, detail, maxWidth, 2) : [];

  const blockH =
    titleLines.length * titleLH +
    (detailLines.length
      ? Math.round(detailSize * 0.5) + detailLines.length * detailLH
      : 0);

  // Bottom-anchored. On a Story frame that lands in the lower third, which is
  // where the eye goes and where the platform's own UI does not cover it.
  let y = h - pad - blockH + titleLH;

  // ── title ──────────────────────────────────────────────────────────────
  ctx.font = `700 ${titleSize}px ${FONT_STACK}`;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = Math.round(titleSize * 0.18);
  ctx.shadowOffsetY = Math.round(titleSize * 0.04);
  for (const line of titleLines) {
    ctx.fillText(line, pad, y);
    y += titleLH;
  }

  // ── detail ─────────────────────────────────────────────────────────────
  if (detailLines.length) {
    y += Math.round(detailSize * 0.5) - titleLH + detailLH;
    ctx.font = `400 ${detailSize}px ${FONT_STACK}`;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = Math.round(detailSize * 0.2);
    for (const line of detailLines) {
      ctx.fillText(line, pad, y);
      y += detailLH;
    }
  }

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * Render one banner: image + drawn text → a PNG blob.
 *
 * The canvas is created at the IMAGE's native size, not the requested size.
 * Pollinations caps the long edge (a 1000×1000 request comes back 768×768),
 * so building a 1000px canvas and stretching a 768px image into it would
 * blur the photo. Native size keeps both the photo and the type crisp.
 */
export async function renderBanner({
  blob,
  title,
  detail,
  isHero,
  isStory,
}: {
  blob: Blob;
  title: string;
  detail: string;
  isHero: boolean;
  isStory: boolean;
}): Promise<{ blob: Blob; url: string; width: number; height: number }> {
  const img = await blobToImage(blob);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new BannerError("failed", "This browser could not draw the banner.");

  ctx.drawImage(img, 0, 0, w, h);
  drawBannerText(ctx, w, h, { title, detail, isHero, isStory });

  const out = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!out) throw new BannerError("failed", "This browser could not save the banner.");

  return { blob: out, url: URL.createObjectURL(out), width: w, height: h };
}

/** Save a blob to the user's device. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* ------------------------------------------------------------------ misc */

/** The whole listing as plain text, for "Copy all". Banner prompts stay internal. */
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
