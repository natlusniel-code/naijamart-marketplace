import "server-only";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AI_CACHE_TTL,
  AI_DEFAULT_RATE_LIMIT,
  AI_RATE_LIMITS,
  AI_TIMEOUT_MS,
  TEAMILY_AI_KEY,
  TEAMILY_AI_MODEL,
  TEAMILY_AI_URL,
  aiEnabled,
} from "./config";

/**
 * The single door to Teamily's AI.
 *
 * Every feature goes through `askAI()`. That is deliberate: timeout, rate
 * limiting, caching, logging and graceful degradation are implemented ONCE
 * here, so no feature can forget one of them and no feature can accidentally
 * make the site depend on the AI being up.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 * `askAI()` NEVER throws. It returns a discriminated result:
 *
 *     { ok: true,  data, cached, latencyMs }
 *     { ok: false, reason, latencyMs }
 *
 * `reason` is one of: 'disabled' | 'rate_limited' | 'timeout' | 'error' |
 * 'bad_response'. Callers switch on it and take their non-AI path. A caller
 * that ignores `ok` and reads `data` gets `undefined` — which is why every
 * feature below is written to handle a missing result rather than assume one.
 *
 * ── What is sent ────────────────────────────────────────────────────────────
 * The site's data stays in Supabase. We send only the specific rows a feature
 * needs, in the prompt, per request. Teamily never gets a database connection
 * and never queries our tables — the AI cannot "look up" an order, which is
 * exactly why the order-status assistant must be handed the order by us.
 */

export type AIResult<T> =
  | { ok: true; data: T; cached: boolean; latencyMs: number; model: string }
  | { ok: false; reason: AIFailureReason; latencyMs: number; detail?: string };

export type AIFailureReason =
  | "disabled"
  | "rate_limited"
  | "timeout"
  | "error"
  | "bad_response";

export type AskOptions = {
  /** Feature key — drives the rate limit, cache TTL and the audit log. */
  feature: string;
  /** Who is asking. Used for the per-user rate limit. */
  actorId: string;
  actorRole?: string;
  /** The instruction. Kept separate from the data so it is easy to audit. */
  system: string;
  /** The site's data for this request. Serialised into the prompt. */
  input: unknown;
  /** A short human-readable label for the audit log (never the full payload). */
  inputSummary?: string;
  /** A reference to the row this is about, for the audit log. */
  inputRef?: string;
  /** JSON schema-ish description of the shape we expect back. */
  schemaHint?: string;
  /** Override the cache TTL in seconds. 0 disables caching. */
  cacheTtlSeconds?: number;
  /** Override the timeout for this call. */
  timeoutMs?: number;
  /** Skip the cache read (still writes). Used when re-reading a receipt. */
  bypassCache?: boolean;
};

/** Stable cache key: feature + a hash of the exact input. */
function cacheKey(feature: string, system: string, input: unknown): string {
  const h = createHash("sha256")
    .update(system)
    .update("\u0000")
    .update(JSON.stringify(input ?? null))
    .digest("hex")
    .slice(0, 40);
  return `${feature}:${h}`;
}

/**
 * Pull the first JSON object/array out of a model reply.
 *
 * Models wrap JSON in prose or fences often enough that a bare `JSON.parse`
 * fails on otherwise-good answers. This is tolerant, but it still returns
 * `null` rather than guessing — a caller that gets `null` takes its fallback.
 */
export function extractJSON<T>(text: string): T | null {
  if (!text) return null;
  const trimmed = text.trim();

  // Strip a ```json fence if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(body) as T;
  } catch {
    // Fall through to brace matching.
  }

  // Find the outermost {...} or [...].
  const firstObj = body.indexOf("{");
  const firstArr = body.indexOf("[");
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) return null;

  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Consume one unit of the per-actor rate limit. Fails OPEN on DB error. */
async function consumeRateLimit(
  actorId: string,
  feature: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const limit = AI_RATE_LIMITS[feature] ?? AI_DEFAULT_RATE_LIMIT;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("ai_consume_rate_limit", {
      p_actor: actorId,
      p_feature: feature,
      p_limit: limit,
      p_window: "1 hour",
    });
    if (error) {
      // A broken rate limiter must not take the feature down with it.
      console.error("ai_consume_rate_limit failed:", error.message);
      return { allowed: true, remaining: limit };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return { allowed: !!row?.allowed, remaining: Number(row?.remaining ?? 0) };
  } catch (e) {
    console.error("ai_consume_rate_limit threw:", e);
    return { allowed: true, remaining: limit };
  }
}

/** Read a cached answer. Returns null on miss, expiry, or any error. */
async function readCache<T>(key: string): Promise<T | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("ai_cache_get", { p_key: key });
    if (error || data == null) return null;
    return data as T;
  } catch {
    return null;
  }
}

/** Write a cached answer. Best-effort — a failure is not worth reporting. */
async function writeCache(key: string, feature: string, payload: unknown, ttl: number) {
  if (ttl <= 0) return;
  try {
    const supabase = createAdminClient();
    await supabase.rpc("ai_cache_put", {
      p_key: key,
      p_feature: feature,
      p_payload: payload,
      p_ttl: `${ttl} seconds`,
    });
  } catch {
    /* cache is an optimisation, never a requirement */
  }
}

/** Append to the audit log. Best-effort. */
async function logAction(opts: {
  feature: string;
  actorId: string;
  actorRole?: string;
  inputRef?: string;
  inputSummary?: string;
  output: unknown;
  available: boolean;
  model?: string;
  latencyMs: number;
  cached: boolean;
  codeDecision?: string;
  codeReason?: string;
}) {
  try {
    const supabase = createAdminClient();
    await supabase.from("ai_action_log").insert({
      feature: opts.feature,
      actor_id: opts.actorId || null,
      actor_role: opts.actorRole ?? null,
      input_ref: opts.inputRef ?? null,
      input_summary: opts.inputSummary ?? null,
      ai_output: opts.output ?? null,
      ai_available: opts.available,
      ai_model: opts.model ?? null,
      latency_ms: opts.latencyMs,
      cached: opts.cached,
      code_decision: opts.codeDecision ?? null,
      code_reason: opts.codeReason ?? null,
    });
  } catch {
    /* logging must never break a request */
  }
}

/**
 * Call Teamily and return structured JSON.
 *
 * Never throws. Never blocks longer than `timeoutMs`. Never calls the network
 * when the AI is not configured.
 */
export async function askAI<T>(opts: AskOptions): Promise<AIResult<T>> {
  const started = Date.now();
  const ttl = opts.cacheTtlSeconds ?? AI_CACHE_TTL[opts.feature] ?? 0;
  const key = cacheKey(opts.feature, opts.system, opts.input);

  // ── 1. Not configured: take the fallback immediately, no network call ──
  if (!aiEnabled) {
    return { ok: false, reason: "disabled", latencyMs: 0 };
  }

  // ── 2. Cache ──────────────────────────────────────────────────────────
  if (ttl > 0 && !opts.bypassCache) {
    const hit = await readCache<T>(key);
    if (hit != null) {
      const latencyMs = Date.now() - started;
      await logAction({
        feature: opts.feature,
        actorId: opts.actorId,
        actorRole: opts.actorRole,
        inputRef: opts.inputRef,
        inputSummary: opts.inputSummary,
        output: hit,
        available: true,
        latencyMs,
        cached: true,
      });
      return { ok: true, data: hit, cached: true, latencyMs, model: "cache" };
    }
  }

  // ── 3. Rate limit ─────────────────────────────────────────────────────
  const rl = await consumeRateLimit(opts.actorId || "anon", opts.feature);
  if (!rl.allowed) {
    return { ok: false, reason: "rate_limited", latencyMs: Date.now() - started };
  }

  // ── 4. The call, with a hard timeout ──────────────────────────────────
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? AI_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let raw = "";
  let model = TEAMILY_AI_MODEL;

  try {
    const res = await fetch(`${TEAMILY_AI_URL}/v1/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TEAMILY_AI_KEY}`,
      },
      body: JSON.stringify({
        model: TEAMILY_AI_MODEL,
        // The instruction and the site's data travel together, per request.
        messages: [
          { role: "system", content: opts.system },
          {
            role: "user",
            content:
              (opts.schemaHint ? `Return JSON matching: ${opts.schemaHint}\n\n` : "") +
              `DATA:\n${JSON.stringify(opts.input ?? null, null, 2)}`,
          },
        ],
        // Ask for JSON where the gateway supports it; the parser tolerates
        // prose anyway, so this is an optimisation not a requirement.
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: controller.signal,
      // Never let Next cache an AI response at the fetch layer.
      cache: "no-store",
    });

    if (!res.ok) {
      const detail = `HTTP ${res.status}`;
      const latencyMs = Date.now() - started;
      await logAction({
        feature: opts.feature,
        actorId: opts.actorId,
        actorRole: opts.actorRole,
        inputRef: opts.inputRef,
        inputSummary: opts.inputSummary,
        output: null,
        available: false,
        latencyMs,
        cached: false,
        codeDecision: "fallback",
        codeReason: detail,
      });
      return { ok: false, reason: "error", latencyMs, detail };
    }

    const body = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      content?: string;
      output?: string;
    };
    model = body.model || TEAMILY_AI_MODEL;
    raw = body.choices?.[0]?.message?.content ?? body.content ?? body.output ?? "";
  } catch (e: unknown) {
    const latencyMs = Date.now() - started;
    const aborted = e instanceof Error && e.name === "AbortError";
    const reason: AIFailureReason = aborted ? "timeout" : "error";
    await logAction({
      feature: opts.feature,
      actorId: opts.actorId,
      actorRole: opts.actorRole,
      inputRef: opts.inputRef,
      inputSummary: opts.inputSummary,
      output: null,
      available: false,
      latencyMs,
      cached: false,
      codeDecision: "fallback",
      codeReason: reason,
    });
    return {
      ok: false,
      reason,
      latencyMs,
      detail: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }

  // ── 5. Parse ──────────────────────────────────────────────────────────
  const parsed = extractJSON<T>(raw);
  const latencyMs = Date.now() - started;

  if (parsed == null) {
    await logAction({
      feature: opts.feature,
      actorId: opts.actorId,
      actorRole: opts.actorRole,
      inputRef: opts.inputRef,
      inputSummary: opts.inputSummary,
      output: { unparsed: raw.slice(0, 500) },
      available: true,
      model,
      latencyMs,
      cached: false,
      codeDecision: "fallback",
      codeReason: "unparseable response",
    });
    return { ok: false, reason: "bad_response", latencyMs };
  }

  await writeCache(key, opts.feature, parsed, ttl);
  await logAction({
    feature: opts.feature,
    actorId: opts.actorId,
    actorRole: opts.actorRole,
    inputRef: opts.inputRef,
    inputSummary: opts.inputSummary,
    output: parsed,
    available: true,
    model,
    latencyMs,
    cached: false,
  });

  return { ok: true, data: parsed, cached: false, latencyMs, model };
}

/**
 * Record what CODE decided about an AI output.
 *
 * Kept separate from `askAI` so the decision is logged even when the AI was
 * unavailable and the fallback ran — the audit trail then shows both halves.
 */
export async function logDecision(opts: {
  feature: string;
  actorId: string;
  actorRole?: string;
  inputRef?: string;
  codeDecision: string;
  codeReason?: string;
  output?: unknown;
}) {
  await logAction({
    feature: opts.feature,
    actorId: opts.actorId,
    actorRole: opts.actorRole,
    inputRef: opts.inputRef,
    output: opts.output ?? null,
    available: true,
    latencyMs: 0,
    cached: false,
    codeDecision: opts.codeDecision,
    codeReason: opts.codeReason,
  });
}
