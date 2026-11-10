import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Refreshes the Supabase auth session on every request.
 *
 * Two hard rules learned from the production `MIDDLEWARE_INVOCATION_FAILED`:
 *
 *  1. The Supabase URL/key come from `./config`, which carries a literal
 *     fallback. Reading `process.env.NEXT_PUBLIC_*` directly here is unsafe:
 *     those are inlined at build time, so a host without the variables
 *     compiles `undefined` into the bundle and `createServerClient` throws.
 *
 *  2. The whole thing is wrapped in try/catch. Middleware runs in front of
 *     every route, so any unhandled throw — a bad env var, a network blip, a
 *     malformed cookie — turns into a 500 for the entire site. A failed session
 *     refresh must degrade to "anonymous visitor", never to a dead site.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  try {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    // Touching getUser() is what actually refreshes an expired token and
    // writes the rotated cookies onto `response`.
    await supabase.auth.getUser();
  } catch (error) {
    // Never let an auth failure take the site down.
    console.error("[middleware] Supabase session refresh failed:", error);
  }

  return response;
}
