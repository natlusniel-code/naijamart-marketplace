/**
 * The seller onboarding gate — one source of truth for "where does this seller
 * belong right now?".
 *
 * ── Why this module exists ───────────────────────────────────────────────────
 * A seller must NOT see the Seller Hub until an admin has approved the shop.
 * Before this module the only check was "does a shop row exist?", and because
 * `shops.status` defaults to `'pending'` (not `'draft'`), a seller who had
 * merely created their business profile was treated as a live seller and
 * dropped straight into the hub. The email-confirmation callback had the same
 * hole: it redirected every `role=seller` to `/seller/onboarding`, and the
 * onboarding page then derived `step = 4` for an approved shop — so the two
 * paths disagreed and neither enforced approval.
 *
 * Every entry point now asks this module instead of re-deriving the rule:
 *   - `/auth/callback` (email confirmation + OAuth)
 *   - `postAuthDestination()` (sign-in, signup with a live session)
 *   - `src/app/seller/layout.tsx` (every seller-only page)
 *   - `src/app/seller/onboarding/page.tsx` (which step to render)
 *
 * ── The flow ────────────────────────────────────────────────────────────────
 *   1. Business profile (shop details)      → step 1
 *   2. Verification (NIN/CAC + bank)        → step 2
 *   3. Plan selection + payment             → step 3
 *   4. Waiting for admin approval           → step 4
 *   5. Approved                             → the Seller Hub
 *
 * `shops.status` is the approval flag (`pending` | `approved` | `suspended` |
 * `rejected`) and `shops.subscription_status` is the plan-payment flag
 * (`none` | `pending` | `active` | `expired`). Both are written by the app and
 * by the admin console, never by the client's own claims.
 */

export type SellerShop = {
  status?: string | null;
  verified?: boolean | null;
  subscription_status?: string | null;
  bank_account_number?: string | null;
} | null;

export type OnboardingStep = 1 | 2 | 3 | 4;

/**
 * True only when an admin has approved the shop AND verified it.
 *
 * ── Why both flags ─────────────────────────────────────────────────────────
 * `status` is the approval decision and `verified` is the identity check. They
 * are separate columns and the admin console can set one without the other, so
 * checking `status` alone let a shop that was approved but never identity-
 * verified into the hub — the exact "pending seller in the hub" case. A seller
 * is live only when both are true.
 */
export function isApprovedSeller(shop: SellerShop): boolean {
  return shop?.status === "approved" && shop?.verified === true;
}

/**
 * The onboarding step a seller is currently on, derived from their shop row.
 * Only meaningful for a seller who is NOT approved yet.
 */
export function onboardingStepFor(shop: SellerShop): OnboardingStep {
  // No shop row at all: they have not created the business profile yet.
  if (!shop) return 1;

  // Plan submitted (or the shop was rejected/suspended): they are waiting on a
  // human. Step 4 is the "under review" screen.
  if (shop.subscription_status === "pending") return 4;
  if (shop.status === "rejected" || shop.status === "suspended") return 4;

  // Approved but not identity-verified: still waiting on a human. Without this
  // the seller fell through to step 3 (plan) and was asked to pay again for a
  // shop that had already been approved.
  if (shop.status === "approved" && shop.verified !== true) return 4;

  // Business profile exists but the verification details are missing.
  if (!shop.bank_account_number) return 2;

  // Profile + verification done, plan not paid yet.
  return 3;
}

/**
 * Where a seller must be sent. Returns `null` when they are approved and may
 * use the Seller Hub.
 */
export function sellerGatePath(shop: SellerShop): string | null {
  if (isApprovedSeller(shop)) return null;
  return `/seller/onboarding?step=${onboardingStepFor(shop)}`;
}

/** Convenience for server components: the path to redirect to, or null. */
export function sellerRedirectTarget(shop: SellerShop): string | null {
  return sellerGatePath(shop);
}
