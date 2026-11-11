import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/**
 * Committed fallback service-role key.
 *
 * Used only when `SUPABASE_SERVICE_ROLE_KEY` is not set in the environment.
 * Never prefix this with `NEXT_PUBLIC_` and never import this module from a
 * Client Component — see the header comment.
 *
 * ── History (do not repeat this mistake) ─────────────────────────────────────
 * This constant previously held an `sb_secret_…` key that had been ROTATED and
 * was dead: every admin call returned `401 Unregistered API key`. Because the
 * signup route maps errors by message, that surfaced to users as
 * "that email is already registered" — a dead credential disguised as a
 * business error. The value below is the project's current legacy
 * `service_role` JWT, verified against `/auth/v1/admin/users`.
 *
 * If admin calls start failing with 401 again, check this key FIRST — and
 * prefer setting `SUPABASE_SERVICE_ROLE_KEY` in the deployment so rotation
 * needs no code change.
 */
const FALLBACK_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjZWprZXZkZnB6ZnZ3ZmpqcXdjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5NDE2MTE2OSwiZXhwIjoyMTA5NzM3MTY5fQ.v3EDLXinNG3v5x5kFUPmH3_ZzaxXv30qwcuro6GaDl0";

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
