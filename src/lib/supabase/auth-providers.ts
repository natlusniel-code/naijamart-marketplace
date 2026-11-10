"use client";

/**
 * Which sign-in methods this Supabase project actually has switched on.
 *
 * Why this exists
 * ---------------
 * `signInWithOAuth({ provider: "google" })` does NOT validate the provider
 * before it acts. It builds `${SUPABASE_URL}/auth/v1/authorize?provider=google`
 * and immediately navigates the browser there. When the provider is disabled,
 * Supabase answers that navigation with a raw JSON body:
 *
 *   {"code":400,"error_code":"validation_failed",
 *    "msg":"Unsupported provider: provider is not enabled"}
 *
 * The browser renders that JSON as a page, and the user loses the app. The
 * `if (error)` branch never runs, because nothing threw — the tab already
 * navigated away. So the only reliable fix is to ask the project what it
 * supports *before* offering the button.
 *
 * `GET /auth/v1/settings` is public, CORS-enabled, and returns:
 *   { "external": { "email": true, "google": false, ... }, ... }
 */

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export type AuthProviders = {
  email: boolean;
  google: boolean;
};

/**
 * What we assume if the settings call fails. Google is FALSE on purpose:
 * failing closed hides a button instead of sending the user to a JSON error
 * page. Email stays true so the working path is never blocked.
 */
const FAIL_CLOSED: AuthProviders = { email: true, google: false };

let cached: AuthProviders | null = null;
let inflight: Promise<AuthProviders> | null = null;

/** Fetch (once per page load) which providers are enabled on the project. */
export async function fetchAuthProviders(): Promise<AuthProviders> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: SUPABASE_ANON_KEY },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`auth settings responded ${res.status}`);

      const json = (await res.json()) as { external?: Record<string, boolean> };
      const external = json.external ?? {};

      const result: AuthProviders = {
        email: external.email !== false,
        google: external.google === true,
      };
      cached = result;
      return result;
    } catch (error) {
      // Deliberately not cached: a network blip should not permanently hide a
      // provider that is in fact enabled. We still fail closed for THIS render.
      console.warn("[auth] could not read provider settings:", error);
      return FAIL_CLOSED;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Remember that Google failed at runtime, so the button disappears at once. */
export function markGoogleUnavailable(): void {
  cached = { email: true, google: false };
}

/** True when a caught error is really "provider not enabled", not a real bug. */
export function isUnsupportedProviderError(message: string): boolean {
  const m = (message || "").toLowerCase();
  return (
    m.includes("provider is not enabled") ||
    m.includes("unsupported provider") ||
    m.includes("validation_failed")
  );
}
