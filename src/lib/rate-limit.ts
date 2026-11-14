/**
 * A small in-memory rate limiter.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * `/api/ai/search` and `/api/ai/reply` each cost a model call. Without a
 * limit, anyone who finds the endpoint can burn the AI quota from a script
 * — and the search endpoint is reachable without signing in, because a
 * visitor should be able to try a photo search before creating an account.
 *
 * ── Why in-memory is the right size here ──────────────────────────────
 * This is a single Next.js server. A per-process map is enough to stop a
 * loop from one client, which is the realistic abuse. It is NOT a
 * distributed limiter: on several instances each has its own budget. If
 * this ever runs multi-instance, move the counter to Postgres or Redis —
 * the call sites do not change.
 *
 * ── Why a sliding window ──────────────────────────────────────────────
 * A fixed window lets a client send the full budget at 59.9s and again at
 * 60.1s. A sliding window of timestamps is barely more code and does not
 * have that edge.
 */

type Bucket = { hits: number[]; };

const buckets = new Map<string, Bucket>();

/** Drop empty buckets so the map cannot grow without bound. */
function sweep(now: number, windowMs: number) {
  if (buckets.size < 500) return;
  for (const [key, b] of buckets) {
    b.hits = b.hits.filter((t) => now - t < windowMs);
    if (b.hits.length === 0) buckets.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  /** Requests left in the window. */
  remaining: number;
  /** Seconds until the oldest hit falls out, when blocked. */
  retryAfter: number;
};

/**
 * Count one hit against `key`.
 *
 * @param key      Usually `"<route>:<ip or user id>"`.
 * @param limit    How many hits are allowed per window.
 * @param windowMs The window length.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now, windowMs);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  bucket.hits.push(now);
  return { ok: true, remaining: limit - bucket.hits.length, retryAfter: 0 };
}

/**
 * A stable key for the caller.
 *
 * Prefers the signed-in user, so one account cannot dodge the limit by
 * changing IP. Falls back to the forwarded address for anonymous visitors.
 */
export function clientKey(request: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `ip:${ip}`;
}
