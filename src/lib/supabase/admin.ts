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
 *  1. `SUPABASE_SERVICE_ROLE_KEY` is a NON-public variable. Next.js only inlines
 *     `NEXT_PUBLIC_*` into the browser bundle, so this module must never be
 *     imported from a Client Component. The build enforces this too: a
 *     `server-only` import turns any accidental client-side import into a
 *     compile error rather than a leaked key.
 *  2. Every mutation goes through a Server Action in `src/app/admin-fuckliving/
 *     actions.ts`, which runs on the server. The browser never sees the key and
 *     never calls Supabase directly for admin work.
 *  3. It degrades loudly, not silently: if the key is missing the console still
 *     renders (see `hasAdminKey`) but says so on every page, instead of showing
 *     an empty dashboard that looks like "no orders yet".
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/**
 * Deliberately NOT defaulted to a literal here, unlike `config.ts`.
 *
 * The publishable key is safe to ship in the bundle; a service-role key is not.
 * Baking a fallback in would put a full-admin database credential into a public
 * repository. It must come from the environment.
 */
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** True when the admin console can actually reach the database. */
export const hasAdminKey = SERVICE_ROLE_KEY.length > 0;

/**
 * Service-role client: bypasses RLS. Server-side only — never pass this to a
 * Client Component, never serialise it, never read it from the browser.
 *
 * `persistSession: false` + `autoRefreshToken: false` because this client has no
 * user to persist a session for; it authenticates as the key itself.
 *
 * ── When the key is missing ──────────────────────────────────────────────────
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
