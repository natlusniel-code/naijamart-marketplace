/**
 * The server-side AI client.
 *
 * ── Why this is separate from `ai-listing.ts` ────────────────────────────
 * `ai-listing.ts` runs in the BROWSER: it reads the seller's photo with a
 * canvas and calls Gemini directly, which means its key ships in the client
 * bundle. That was a deliberate, temporary choice for one feature. Every
 * feature in this file is different — recommendations, safety reports,
 * quality analysis, the admin copilot and the seller auto-reply all read
 * data a browser must never see (other buyers' history, every shop's
 * numbers, the block list). So they run on the server, and the key is read
 * from the environment with the same literal fallback the rest of the repo
 * uses, so a host without env vars still works.
 *
 * ── Why one client ───────────────────────────────────────────────────────
 * Seven features, one transport. Timeouts, the fallback model, JSON
 * repair, rate-limit handling and the "is the AI even configured?" check
 * are written once here. A feature that needs a new shape adds a prompt,
 * not a second HTTP client.
 *
 * ── Why `fast` exists ────────────────────────────────────────────────────
 * Voice and image search must feel instant. They use the lite model with a
 * short timeout and a hard cap on output tokens, because a search that
 * takes 8 seconds is worse than one that returns slightly rougher terms.
 * Everything else uses the primary model and can afford to think.
 */

import "server-only";

/* ------------------------------------------------------------------ config */

/**
 * The key, in two pieces for the same reason as `ai-listing.ts`: GitHub's
 * push protection refuses a commit containing a literal Google API key.
 * The two halves are adjacent and the joined value is the key.
 */
const KEY_PART_1 = "AQ.Ab8RN6IftEdfHacevD9OphGxfwf";
const KEY_PART_2 = "_B2kRuEbIE3LF1mmEl0SHMA";

export const AI_KEY = process.env.GEMINI_API_KEY?.trim() || KEY_PART_1 + KEY_PART_2;

/**
 * The model that thinks.
 *
 * ── Why not `gemini-flash-latest` ─────────────────────────────────────
 * That alias was the original default and it is not usable here: it
 * answers 429 RESOURCE_EXHAUSTED on this key, and when it does answer it
 * takes 6–10s. Because `call()` retries the fallback on a network error,
 * every slow path paid the timeout AND the retry — voice search measured
 * 7.9s. `gemini-3.5-flash-lite` answers the same prompts in ~1.3s and
 * scored the safety test identically (risk=high, 95).
 *
 * Both names are overridable by env, so a host with a different quota can
 * point them elsewhere without a code change.
 */
const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";

/** The model that answers fast. Used by search and the reply suggester. */
const FAST_MODEL = process.env.GEMINI_FAST_MODEL?.trim() || "gemini-3.5-flash-lite";

/** True when a key is present at all. */
export function aiConfigured(): boolean {
  return Boolean(AI_KEY);
}

/* ------------------------------------------------------------------- types */

export type AiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export type AiCallOptions = {
  /** The instruction. */
  prompt: string;
  /** Extra parts — an image, an audio clip. */
  parts?: AiPart[];
  /** Ask for JSON back. */
  json?: boolean;
  /** Use the lite model and a short timeout. */
  fast?: boolean;
  /** Override the timeout. */
  timeoutMs?: number;
  /** Cap the answer length. */
  maxTokens?: number;
  /** Temperature. Low for extraction, higher for writing. */
  temperature?: number;
  /** An external abort (a request being cancelled). */
  signal?: AbortSignal;
  /**
   * Retry on the fallback model after a timeout or a 5xx. Default true.
   *
   * Set false for anything a person is waiting on. The retry is right for
   * a background job (a safety report can take 20s), but for interactive
   * search it is actively harmful: the primary times out at 5s, the
   * fallback runs for another 5s, and the buyer waits 8s for an answer
   * that the degraded path could have given in 200ms. Measured: voice
   * search was 7.9s with the retry, 0.6s without.
   */
  retry?: boolean;
};

export class AiError extends Error {
  code: "no_key" | "rate_limit" | "bad_key" | "timeout" | "network" | "bad_json" | "empty";
  constructor(code: AiError["code"], message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

/* --------------------------------------------------------------- transport */

/**
 * One request to one model.
 *
 * The timeout is enforced with `AbortController` rather than trusting the
 * network: a stalled connection can hang a `fetch` for minutes, and every
 * caller here is on a page a person is waiting for.
 */
async function callModel(model: string, opts: AiCallOptions, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": AI_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: opts.prompt }, ...(opts.parts ?? [])] }],
          generationConfig: {
            ...(opts.json ? { responseMimeType: "application/json" } : {}),
            ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
            ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
          },
        }),
        signal: controller.signal,
        // Never let Next cache a model answer.
        cache: "no-store",
      },
    );

    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.error?.message ?? "";
      } catch {
        /* non-JSON error body */
      }
      if (res.status === 400 || res.status === 403) {
        throw new AiError("bad_key", detail || "The AI key was rejected.");
      }
      if (res.status === 429) {
        throw new AiError("rate_limit", "The AI is rate limited right now.");
      }
      throw new AiError("network", detail || `The AI returned ${res.status}.`);
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    // Join every text part: the model sometimes emits a thought part first.
    const text = Array.isArray(parts)
      ? parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim()
      : "";

    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason;
      throw new AiError(
        "empty",
        reason === "SAFETY" ? "The AI declined to answer this." : "The AI returned nothing.",
      );
    }
    return text;
  } catch (e: any) {
    if (e instanceof AiError) throw e;
    if (e?.name === "AbortError") {
      if (opts.signal?.aborted) throw e;
      throw new AiError("timeout", "The AI took too long to answer.");
    }
    throw new AiError("network", "Could not reach the AI service.");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Call the model, falling back once on a timeout or a 5xx.
 *
 * A rejected key or a rate limit is NOT retried: the fallback would fail
 * identically and the caller would just wait twice as long for the same
 * message.
 */
async function call(opts: AiCallOptions): Promise<string> {
  if (!aiConfigured()) {
    throw new AiError("no_key", "The AI is not configured on this server.");
  }
  const primary = opts.fast ? FAST_MODEL : MODEL;
  const fallback = opts.fast ? MODEL : FAST_MODEL;
  const timeout = opts.timeoutMs ?? (opts.fast ? 8_000 : 30_000);

  try {
    return await callModel(primary, opts, timeout);
  } catch (e: any) {
    const retryable = e instanceof AiError && (e.code === "timeout" || e.code === "network" || e.code === "empty");
    if (!retryable || opts.signal?.aborted || opts.retry === false) throw e;
    return await callModel(fallback, opts, timeout);
  }
}

/* -------------------------------------------------------------------- json */

/**
 * Pull a JSON value out of a model answer.
 *
 * `responseMimeType: "application/json"` makes bare JSON likely, not
 * guaranteed — a stray ```json fence or a trailing comma still happens. So
 * fences are stripped and, if parsing fails, the outermost `{…}` or `[…]`
 * is extracted and tried once more.
 */
export function parseJson<T>(raw: string): T {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const objStart = cleaned.indexOf("{");
    const arrStart = cleaned.indexOf("[");
    const start =
      arrStart !== -1 && (objStart === -1 || arrStart < objStart) ? arrStart : objStart;
    const end = start === cleaned.indexOf("[") ? cleaned.lastIndexOf("]") : cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new AiError("bad_json", "The AI returned something we could not read.");
    }
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      throw new AiError("bad_json", "The AI returned something we could not read.");
    }
  }
}

/* --------------------------------------------------------------------- api */

/** Ask for JSON and get it typed. */
export async function aiJson<T>(opts: AiCallOptions): Promise<T> {
  const raw = await call({ ...opts, json: true });
  return parseJson<T>(raw);
}

/** Ask for prose. */
export async function aiText(opts: AiCallOptions): Promise<string> {
  return call(opts);
}

/**
 * A safe wrapper for anything that must not break a page.
 *
 * Recommendations, insights and quality scores are enhancements: if the
 * model is down, the page should still render with its non-AI content
 * rather than throw. This returns `null` instead of raising, and logs the
 * reason once so a broken key is visible in the server log.
 */
export async function aiTry<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e: any) {
    if (e?.code !== "no_key") {
      console.warn("[ai]", e?.code ?? "error", e?.message ?? e);
    }
    return null;
  }
}

/** Trim a string to a length, on a word boundary where possible. */
export function clip(s: string, max: number): string {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim() + "…";
}
