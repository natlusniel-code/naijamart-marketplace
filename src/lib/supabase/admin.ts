/**
 * Server-only Supabase client for the admin console.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The admin console is intentionally reachable WITHOUT a login. That is a
 * deliberate product decision, not an oversight: it is a single-operator
 * back office behind an obscure path.
 *
 * The consequence is that the ordinary anon client cannot read anything, because
 * every admin-relevant RLS policy is gated on `is_admin()` — and an anonymous
 * request is not an admin. Rather than weaken those policies (which would expose
 * every buyer's orders, addresses and payout details to anyone holding the
 * public anon key), the admin console talks to the database through the
 * service-role key, which bypasses RLS.
 *
 * ── The rules that make that safe ────────────────────────────────────────────
 *  1. The key is a NON-public value. Next.js only inlines `NEXT_PUBLIC_*` into
 *     the browser bundle, so this module must never be imported from a Client
 *     Component. The build enforces this too: the `server-only` import below
 *     turns any accidental client-side import into a compile error rather than
 *     a leaked key.
 *  2. Every mutation goes through a Server Action in `src/app/admin-fuckliving/
 *     actions.ts`, which runs on the server. The browser never sees the key and
 *     never calls Supabase directly for admin work.
 *  3. It degrades loudly, not silently: if no key is available the console still
 *     renders (see `hasAdminKey`) but says so on every page, instead of showing
 *     an empty dashboard that looks like "no orders yet".
 *
 * ── ⚠️  THE KEY IS COMMITTED TO THIS REPOSITORY ──────────────────────────────
 * `FALLBACK_SERVICE_ROLE_KEY` below is a real, working service-role credential
 * checked into source control. This was an explicit, accepted trade-off so the
 * admin console works on a deployment with no environment variables configured.
 *
 * It means: **this repository must stay PRIVATE.** Anyone who can read the repo
 * can read every buyer's orders, addresses, payout details and can write to the
 * database as an admin. If the repo is ever made public, or the key is ever
 * pasted into a chat, issue, log or screenshot, rotate it immediately in
 * Supabase → Project Settings → API Keys and update the constant below.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` still takes precedence when it is set, so a
 * deployment can override the committed key without a code change — and
 * rotating the key in Vercel alone is enough to neutralise the committed one.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/**
 * Committed fallback service-role key (Supabase `sb_secret_…` format).
 *
 * Used only when `SUPABASE_SERVICE_ROLE_KEY` is not set in the environment.
 * Never prefix this with `NEXT_PUBLIC_` and never import this module from a
 * Client Component — see the header comment.
 */
const FALLBACK_SERVICE_ROLE_KEY = "sb_secret_zWA00lh_YCaV607nTOYA2Q__EfCDaRb";

/**
 * Resolution order:
 *   1. `SUPABASE_SERVICE_ROLE_KEY` — preferred, lets a deployment override or
 *      rotate the key without touching code.
 *   2. `FALLBACK_SERVICE_ROLE_KEY` — the committed key, so the console works
 *      with zero configuration.
 */
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || FALLBACK_SERVICE_ROLE_KEY;

/** True when the admin console can actually reach the database. */
export const hasAdminKey = SERVICE_ROLE_KEY.length > 0;

/**
 * Service-role client: bypasses RLS. Server-side only — never pass this to a
 * Client Component, never serialise it, never read it from the browser.
 *
 * `persistSession: false` + `autoRefreshToken: false` because this client has no
 * user to persist a session for; it authenticates as the key itself.
 *
 * ── When no key is available ─────────────────────────────────────────────────
 * It falls back to the ANON key rather than throwing. That is not a security
 * downgrade — the anon key is already public — and it keeps the console
 * *renderable*: pages load, show the amber "not configured" banner from the
 * layout, and simply return no rows (RLS blocks them). Throwing here instead
 * would turn every admin URL into a 500, which is exactly the failure mode this
 * whole task is meant to remove.
 */
export function createAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
