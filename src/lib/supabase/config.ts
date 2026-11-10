/**
 * Public Supabase configuration.
 *
 * Both values are `NEXT_PUBLIC_*`: they are shipped to the browser by design and
 * are protected by Row Level Security, not by secrecy. They are declared here
 * with a literal fallback so the Edge middleware bundle ALWAYS contains a usable
 * value.
 *
 * Why the fallback matters — this was the cause of the production
 * `500 MIDDLEWARE_INVOCATION_FAILED`:
 *
 *   Next.js inlines `process.env.NEXT_PUBLIC_*` at BUILD time. If the Vercel
 *   project has no such variables, the middleware bundle is compiled with
 *   `undefined`, and `createServerClient(undefined, undefined)` throws
 *   "Your project's URL and Key are required to create a Supabase client!"
 *   on EVERY request. Because middleware runs before every route, the whole
 *   site returns 500 — including pages that never touch Supabase.
 *
 * The fallback makes the build deterministic: the app works whether or not the
 * host has the variables set, and setting them still overrides the default.
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ecejkevdfpzfvwfjjqwc.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_nTmbEq4kh7viHqVFiSxtmw_m7Yh5-QI";

/** True when both values resolved to something non-empty. */
export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
