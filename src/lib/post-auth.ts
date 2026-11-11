import type { SupabaseClient } from "@supabase/supabase-js";
import { sellerGatePath } from "./seller-gate";

/**
 * Where a user should land after authenticating.
 *
 * Sellers belong in the Seller Hub, not the storefront — that is where their
 * orders, listings and payouts live. Buyers keep going to the marketplace.
 *
 * ── Why this takes a `role` hint ──────────────────────────────────────────────
 * The shop lookup alone is NOT enough, and that was the seller-signup bug:
 * a brand-new seller has no `shops` row yet (the row is created in step 1 of
 * onboarding), so `shop` came back null and every new seller was dumped on the
 * storefront as if they were a buyer. The shop row only exists *after* the
 * seller has started onboarding, so it can never answer "where does a seller
 * who has not started yet go?".
 *
 * So: the shop is still the source of truth for an EXISTING seller (it knows
 * whether they are mid-onboarding or approved), and the profile role is the
 * fallback for a seller who has no shop yet. Both are server-side facts — the
 * role comes from `public.profiles`, not from a JWT claim or `user_metadata`,
 * which a client can write.
 *
 * Returns a path (never an absolute URL) so callers can prefix their own
 * origin.
 */
export async function postAuthDestination(
  supabase: SupabaseClient,
  userId: string,
  requested?: string | null,
  role?: string | null,
): Promise<string> {
  // An explicit, safe `next` always wins — the user asked for that page.
  if (requested && requested.startsWith("/") && !requested.startsWith("//")) {
    return requested;
  }

  // ── The role decides first ──────────────────────────────────────────────────
  // A buyer is a buyer even if a `shops` row happens to point at their account
  // (a shop they opened earlier, a shop an admin re-assigned, a seeded row).
  // Before this check the shop lookup ran first, so such an account was sent
  // into the Seller Hub — and from there into the seller-only account settings
  // page — the moment they signed in. Buyers belong on the storefront.
  let effectiveRole = role ?? null;
  if (!effectiveRole) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    effectiveRole = profile?.role ?? null;
  }

  if (effectiveRole === "buyer") return "/";

  const { data: shop } = await supabase
    .from("shops")
    .select("id,status,subscription_status,bank_account_number")
    .eq("owner_id", userId)
    .maybeSingle();

  if (shop) {
    // An unapproved shop belongs in onboarding, at the exact step it is on —
    // business profile → verification → plan → pending approval. Only an
    // admin-approved shop may see the Seller Hub.
    const gate = sellerGatePath(shop);
    if (gate) return gate;
    return "/seller";
  }

  // No shop yet. If this account is a seller, they are at step 0 of the
  // business-details → plan payment → pending-approval flow, so send them
  // there instead of the storefront.
  if (effectiveRole === "seller") return "/seller/onboarding?step=1";

  return "/";
}
