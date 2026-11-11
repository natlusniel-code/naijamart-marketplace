import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sellerGatePath } from "@/lib/seller-gate";
import { isBuyerAccount } from "@/lib/roles";

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

  // A buyer is a buyer even if a `shops` row points at their account. Without
  // this check the shop lookup below sent such an account into the Seller Hub
  // (and its seller-only settings page) straight after signing in.
  //
  // `isBuyerAccount` (src/lib/roles.ts) is the one shared rule: a seller is an
  // account with role 'seller'/'admin' OR one that owns a shop. The database
  // keeps those two in agreement (sql/0014), so a genuine buyer — who owns no
  // shop — is always sent to the storefront, and a real seller is never
  // mistaken for one by a stale role read.
  if (user) {
    const [{ data: prof }, { data: shop }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supabase.from("shops").select("id").eq("owner_id", user.id).maybeSingle(),
    ]);
    if (isBuyerAccount(prof, shop)) {
      return NextResponse.redirect(`${origin}${next !== "/" ? next : "/"}`);
    }
  }

  // A seller who just confirmed must continue their shop setup — business
  // profile first, then the plan, then the approval wait. They must NOT land in
  // the Seller Hub: that is only for an admin-approved shop.
  //
  // The gate is asked of the shop row, not of the `role` query string, so this
  // also holds for a seller who confirms on a different device, or who signs in
  // again before approval. `role=seller` is only the fallback for a seller who
  // has no shop row yet (i.e. they have not created the business profile).
  if (user) {
    const { data: shop } = await supabase
      .from("shops")
      .select("id,status,subscription_status,bank_account_number")
      .eq("owner_id", user.id)
      .maybeSingle();

    const gate = sellerGatePath(shop);
    if (gate) {
      // Approved sellers get `null` and fall through to the normal routing.
      if (shop || role === "seller") {
        return NextResponse.redirect(`${origin}${gate}`);
      }
    }
  }

  if (role === "seller") {
    return NextResponse.redirect(`${origin}/seller/onboarding?step=1`);
  }

  if (next !== "/") {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // No explicit destination: sellers belong in the Seller Hub, buyers on the
  // storefront. Asked of the database, not of a role claim, so an existing
  // seller signing in with Google lands in the right place.
  if (user) {
    const { data: shop } = await supabase
      .from("shops")
      .select("id,status")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (shop) {
      return NextResponse.redirect(
        `${origin}${shop.status === "draft" ? "/seller/onboarding" : "/seller"}`,
      );
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
