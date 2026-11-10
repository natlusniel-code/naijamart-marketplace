import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth + email-confirmation landing point.
 *
 * Reached two ways, both with `?code=` :
 *  - Google / OAuth: Supabase redirects here after the provider round-trip.
 *  - Email confirmation link: `emailRedirectTo` points here, so the user lands
 *    in the app already signed in instead of on a bare token page.
 *
 * Supabase can also arrive with `?error=&error_description=` (user cancelled,
 * provider not enabled, expired link). Those are handled below so the user gets
 * an in-app message rather than a raw JSON body.
 */

/** Only allow same-origin relative paths — never an absolute URL. */
function safeNext(value: string | null): string {
  if (!value) return "/";
  // Reject protocol-relative (//evil.com) and absolute (https://evil.com).
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const role = searchParams.get("role");
  const next = safeNext(searchParams.get("next"));

  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError && !code) {
    const reason = /provider is not enabled|unsupported provider/i.test(providerError)
      ? "google_disabled"
      : "auth";
    return NextResponse.redirect(`${origin}/signin?error=${reason}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/signin?error=auth`);
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Expired or already-used confirmation link.
    return NextResponse.redirect(`${origin}/signin?error=expired`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // OAuth first login: Supabase fills the profile trigger from user_metadata,
  // but the role choice lives in our query string — apply it here.
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, state, city")
      .eq("id", user.id)
      .maybeSingle();

    const meta = user.user_metadata ?? {};
    const patch: Record<string, string> = {};
    if (!prof?.avatar_url && meta.avatar_url) patch.avatar_url = meta.avatar_url;
    if (!prof?.full_name && meta.full_name) patch.full_name = meta.full_name;
    if (role === "seller") patch.role = "seller";
    if (role === "admin") patch.role = "admin";
    if (Object.keys(patch).length && prof) {
      await supabase.from("profiles").update(patch).eq("id", user.id);
    }
  }

  // Admin sign-up: the account exists but `admin_users` is the only source of
  // admin truth. `claim_first_admin()` promotes the caller ONLY while that
  // table is empty, so this is the one-shot bootstrap.
  //
  // NOTE: the admin console no longer requires a session — /admin-fuckliving
  // loads directly — so there is no admin sign-in page to bounce to any more.
  // A `role=admin` signup therefore just lands on the console.
  if (role === "admin" && user) {
    await supabase.rpc("claim_first_admin");
    return NextResponse.redirect(`${origin}/admin-fuckliving`);
  }

  // A seller who just confirmed should continue their shop setup; a buyer goes
  // where they were headed (or home).
  const dest = role === "seller" ? "/seller/onboarding" : next;
  return NextResponse.redirect(`${origin}${dest}`);
}
