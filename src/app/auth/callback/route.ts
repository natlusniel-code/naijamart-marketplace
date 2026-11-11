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

  // ── Password recovery takes precedence over every role rule ──────────────
  // A recovery link is not a sign-in: the user asked to change their password,
  // and the session it creates exists only to authorise that change. Routing
  // them by role here would drop a seller into the hub (or a buyer onto the
  // storefront) with the reset form never shown, and the link would be spent.
  //
  // `next` is `/reset?mode=update` (set by resetPasswordForEmail), so this
  // check must run BEFORE the buyer/seller branching below.
  if (next.startsWith("/reset")) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // OAuth first login: Supabase fills the profile trigger from user_metadata,
  // but the role choice lives in our query string — apply it here.
  //
  // ── Why this upserts instead of only updating ─────────────────────────────
  // The old code did `if (Object.keys(patch).length && prof)`, so when the
  // `handle_new_user` trigger had not committed yet (a real race on a first
  // OAuth login) `prof` was null and the role was silently dropped. A seller
  // who signed up with Google then had no `role = 'seller'`, was classified as
  // a buyer by `isBuyerAccount`, and landed on the storefront instead of the
  // business-details step. Upserting makes the role stick whether or not the
  // trigger has run.
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, state, city, role")
      .eq("id", user.id)
      .maybeSingle();

    const meta = user.user_metadata ?? {};
    const patch: Record<string, string> = {};
    if (!prof?.avatar_url && meta.avatar_url) patch.avatar_url = meta.avatar_url;
    if (!prof?.full_name && meta.full_name) patch.full_name = meta.full_name;
    // Only ever PROMOTE to seller/admin from the query string — never demote.
    // A returning seller who signs in through a buyer link must not lose their
    // role, and `role` is a server-side fact the client should not be able to
    // downgrade.
    if (role === "seller" && prof?.role !== "seller" && prof?.role !== "admin") {
      patch.role = "seller";
    }
    if (role === "admin") patch.role = "admin";

    if (Object.keys(patch).length) {
      if (prof) {
        await supabase.from("profiles").update(patch).eq("id", user.id);
      } else {
        // The trigger has not created the row yet (or is not deployed). Create
        // it so the role and the OAuth name/avatar are not lost.
        await supabase.from("profiles").upsert(
          {
            id: user.id,
            email: user.email ?? null,
            full_name:
              patch.full_name ?? meta.full_name ?? user.email?.split("@")[0] ?? "There",
            avatar_url: patch.avatar_url ?? meta.avatar_url ?? null,
            role: patch.role ?? "buyer",
          },
          { onConflict: "id" },
        );
      }
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
      .select("id,status,verified,subscription_status,bank_account_number")
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
  //
  // The gate is asked again rather than testing `status === "draft"`: that
  // test was wrong twice over — `shops.status` defaults to `'pending'`, never
  // `'draft'`, so the branch never fired, and it ignored `verified` entirely.
  // A seller who is not approved AND verified must go to onboarding, not the
  // hub.
  if (user) {
    const { data: shop } = await supabase
      .from("shops")
      .select("id,status,verified,subscription_status,bank_account_number")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (shop) {
      const gate = sellerGatePath(shop);
      return NextResponse.redirect(`${origin}${gate ?? "/seller"}`);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
