import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where a user should land after authenticating.
 *
 * Sellers belong in the Seller Hub, not the storefront — that is where their
 * orders, listings and payouts live. Buyers keep going to the marketplace.
 *
 * The check is deliberately server-truth based: we ask the database whether
 * this user owns a shop, rather than trusting a `role` claim in the JWT or in
 * `user_metadata`. A seller who signed up before the role column existed, or
 * whose metadata was never written, still gets routed correctly.
 *
 * Returns a path (never an absolute URL) so callers can prefix their own
 * origin.
 */
export async function postAuthDestination(
  supabase: SupabaseClient,
  userId: string,
  requested?: string | null,
): Promise<string> {
  // An explicit, safe `next` always wins — the user asked for that page.
  if (requested && requested.startsWith("/") && !requested.startsWith("//")) {
    return requested;
  }

  const { data: shop } = await supabase
    .from("shops")
    .select("id,status")
    .eq("owner_id", userId)
    .maybeSingle();

  if (shop) {
    // A shop that is still being set up belongs in onboarding, not the hub —
    // the hub redirects there anyway, but going direct avoids a flash.
    return shop.status === "draft" ? "/seller/onboarding" : "/seller";
  }

  return "/";
}
