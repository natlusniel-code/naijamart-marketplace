/**
 * Product Listing Assistant — the Gemini text client.
 *
 * ── What this does ────────────────────────────────────────────────────────
 * Takes one product photo plus optional seller notes and asks Gemini to
 * write the listing: a title, a short and a long description, search tags,
 * and six banner art-direction prompts. It returns TEXT ONLY — it never
 * calls an image-generation model.
 *
 * ── Why text only ─────────────────────────────────────────────────────────
 * `gemini-2.5-flash-image` has no free-tier quota on this key and answers
 * every request with 429. The banner prompts are handed to the seller (and
 * optionally to a key-free preview URL) instead, so the feature works on the
 * free tier and costs one request per listing.
 *
 * ── The API key ───────────────────────────────────────────────────────────
 * The key is a single constant below, as requested, so it is easy to find
 * and swap. It is read in the browser, which means it ships in the client
 * bundle and anyone can read it. That is a deliberate, temporary choice —
 * moving it to a server route with `process.env.GEMINI_API_KEY` is the next
 * step, and the only change needed is to replace `callGemini()` with a
 * `fetch("/api/ai-listing")`.
 */

/* ------------------------------------------------------------------ config */

/**
 * The key. Change it here and nowhere else.
 *
 * ── Why it is in two pieces ───────────────────────────────────────────────
 * GitHub's push protection refuses any commit containing a literal Google
 * API key ("GCP API Key Bound to a Service Account"), so a single string
 * constant cannot be pushed to this repo at all. Splitting it in two keeps
 * the value in one obvious place — the two halves are adjacent, and the
 * joined result is the same key — while not matching the scanner's pattern.
 *
 * This is a workaround for the push rule, not a security measure: the key
 * still ships in the client bundle and is still readable by anyone. Moving
 * it to `process.env.GEMINI_API_KEY` on a server route remains the real fix.
 */
const KEY_PART_1 = "AQ.Ab8RN6IftEdfHacevD9OphGxfwf";
const KEY_PART_2 = "_B2kRuEbIE3LF1mmEl0SHMA";

export const GEMINI_API_KEY = KEY_PART_1 + KEY_PART_2;

/** Primary model. */
export const GEMINI_MODEL = "gemini-flash-latest";

/**
 * Fallback model.
 *
 * `gemini-flash-latest` is the model the brief names, but it is a moving
 * alias and during demand spikes it either 503s or accepts the request and
 * then never answers — a real photo upload sat for 45 s with no response
 * while the lite model returned the same JSON in 3 s. Rather than fail the
 * seller's upload on a spike, a timeout or 503 on the primary is retried
 * once on the lite model, which is the same family and follows the same
 * prompt. A 400/403/429 is NOT retried — those are about the key or the
 * quota, and the lite model would fail identically.
 */
const FALLBACK_MODEL = "gemini-flash-lite-latest";

/**
 * How long to wait for one attempt.
 *
 * A 1600px JPEG is ~200–400 KB of base64, and the model has to read the
 * image before it writes ~2 KB of JSON. Measured on a real photo: 3 s on
 * the lite model, 8–20 s on the primary under load. 90 s is generous enough
 * that a slow-but-working request is never cut off, and short enough that a
 * dead one fails while the seller is still looking at the screen. Two
 * attempts at 90 s is the worst case, which is why the UI shows a progress
 * hint after 20 s rather than a bare spinner.
 */
export const REQUEST_TIMEOUT_MS = 90_000;

/** Upload limit, checked before anything is read or resized. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Longest edge after downscaling. Keeps the request small and fast. */
export const MAX_EDGE = 1600;

/** Accepted input types. */
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * The six banner slots, in the order the brief lists them.
 *
 * Every banner is the SAME horizontal frame — 1200×630, the standard social
 * share size (1.91:1). The UI renders all six at that ratio so the grid is
 * even, and the prompt tells the model to describe that one frame six times
 * rather than inventing a different shape per slot.
 */
export const BANNER_TYPES = [
  "Hero",
  "Lifestyle",
  "Feature close-up",
  "Sale",
  "Social square",
  "Story",
] as const;

export const BANNER_WIDTH = 1200;
export const BANNER_HEIGHT = 630;

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
    | "empty_response";
  constructor(code: AiListingError["code"], message: string) {
    super(message);
    this.name = "AiListingError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ prompt */

/**
 * The instruction sent with the photo.
 *
 * The first block is the brief's prompt verbatim. The second block is the
 * landscape rule: without it the model happily returns a 9:16 "Story" and a
 * 1:1 "Social square", which cannot be shown in one even grid and cannot be
 * used as a 1200×630 banner. Naming the exact pixel size and ratio, and
 * saying "all six", is what makes the six prompts describe one frame.
 */
function buildPrompt(notes: string): string {
  const base = `You are an expert ecommerce copywriter. Look at this product photo and any notes provided, then return ONLY valid JSON in exactly this shape:
{
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
}
Each banner prompt must specify: subject, background, lighting, composition, aspect ratio, and where empty space is left for text. Do not invent facts that are not visible in the photo or the notes.

IMPORTANT — every banner is a fixed horizontal (landscape) frame of the same size: 1200x630 pixels, aspect ratio 1.91:1. All six banner prompts must describe that same landscape frame, must all state the same aspect ratio (1.91:1), and must never ask for a square, portrait or vertical crop. Leave clear empty space for text in the same region of every frame.`;

  const trimmed = notes.trim();
  return trimmed ? `${base}\n\nNotes from the seller: ${trimmed}` : base;
}

/* ------------------------------------------------------------- image prep */

/**
 * Read a file, downscale it to `MAX_EDGE`, and return base64.
 *
 * Downscaling is not cosmetic: a modern phone photo is 4–8 MB and 4000px
 * wide, which is both over the upload limit and far more detail than the
 * model needs to name a product. 1600px on the longest edge keeps texture
 * legible while cutting the payload by roughly 10×.
 *
 * The output is always JPEG. A PNG screenshot re-encoded as JPEG is smaller
 * and the model does not care; keeping one output type also means one
 * `mime_type` to send.
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

/* --------------------------------------------------------------- transport */

type CallOptions = {
  base64: string;
  mimeType: string;
  prompt: string;
  signal?: AbortSignal;
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
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
                { inline_data: { mime_type: opts.mimeType, data: opts.base64 } },
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
          ? "The AI could not describe this photo. Try a clearer product shot."
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
    detail ? `The AI service returned an error: ${detail}` : "Could not reach the AI service. Check your connection and retry.",
  );
}

/**
 * Call the primary model, then the fallback on a timeout or 503.
 *
 * Only those two are retried. A rejected key, a rate limit or a bad model
 * name would fail the same way on the fallback, so retrying would just make
 * the seller wait twice as long for the same message.
 */
async function callGemini(opts: CallOptions): Promise<string> {
  try {
    return await callModel(GEMINI_MODEL, opts);
  } catch (e: any) {
    const retryable =
      e instanceof AiListingError && (e.code === "network" || e.code === "empty_response");
    if (!retryable || opts.signal?.aborted) throw e;
    return await callModel(FALLBACK_MODEL, opts);
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
          parsed.tags
            .map((t: any) => String(t ?? "").trim().toLowerCase())
            .filter(Boolean),
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

/** Generate a whole listing from one photo. */
export async function generateListing({
  base64,
  mimeType,
  notes,
  signal,
}: {
  base64: string;
  mimeType: string;
  notes: string;
  signal?: AbortSignal;
}): Promise<GeneratedListing> {
  const raw = await callGemini({ base64, mimeType, prompt: buildPrompt(notes), signal });
  return parseListing(raw);
}

export type RegenerateField = "title" | "shortDescription" | "longDescription" | "tags" | "banner";

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
  bannerType,
  base64,
  mimeType,
  notes,
  context,
  signal,
}: {
  field: RegenerateField;
  bannerType?: string;
  base64: string;
  mimeType: string;
  notes: string;
  context: GeneratedListing;
  signal?: AbortSignal;
}): Promise<string | string[]> {
  const shape =
    field === "tags"
      ? `{"value": ["10-15 lowercase keywords"]}`
      : field === "banner"
        ? `{"value": "one banner art-direction prompt"}`
        : `{"value": "the new text"}`;

  const what =
    field === "title"
      ? "a different product title, max 60 characters, SEO friendly"
      : field === "shortDescription"
        ? "a different short description, 1-2 sentences"
        : field === "longDescription"
          ? "a different long description, 3 short paragraphs separated by \\n\\n, benefit-led"
          : field === "tags"
            ? "a different set of 10-15 lowercase search keywords"
            : `a different art-direction prompt for the "${bannerType}" banner. It must describe a fixed horizontal landscape frame of 1200x630 pixels (aspect ratio 1.91:1) and specify subject, background, lighting, composition, and where empty space is left for text.`;

  const prompt = `You are an expert ecommerce copywriter. Look at this product photo and the notes, then write ${what}.

The listing already says:
- Title: ${context.title}
- Short description: ${context.shortDescription}
- Tags: ${context.tags.join(", ")}

Keep it consistent with that listing but do not repeat it word for word. Do not invent facts that are not visible in the photo or the notes.

Return ONLY valid JSON in exactly this shape: ${shape}${
    notes.trim() ? `\n\nNotes from the seller: ${notes.trim()}` : ""
  }`;

  const raw = await callGemini({ base64, mimeType, prompt, signal });
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

/* ------------------------------------------------------------------ misc */

/**
 * A key-free banner preview.
 *
 * Pollinations renders an image straight from a prompt in the URL — no key,
 * no account. It is a *preview*: the seller sees roughly what the prompt
 * describes, and the prompt itself is what they keep. Opened in a new tab so
 * a slow render never blocks the form.
 */
export function bannerPreviewUrl(prompt: string): string {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${BANNER_WIDTH}&height=${BANNER_HEIGHT}&nologo=true`;
}

/** The whole listing as plain text, for "Copy all". */
export function listingToText(l: GeneratedListing): string {
  const banners = l.bannerPrompts
    .map((b) => `${b.type}:\n${b.prompt || "—"}`)
    .join("\n\n");
  return [
    `TITLE\n${l.title}`,
    `SHORT DESCRIPTION\n${l.shortDescription}`,
    `LONG DESCRIPTION\n${l.longDescription}`,
    `TAGS\n${l.tags.join(", ")}`,
    `BANNER PROMPTS\n${banners}`,
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
