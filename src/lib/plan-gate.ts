/**
 * The seller subscription gate.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 * Every seller-only feature is premium. A seller may use one only when:
 *
 *   1. the shop is approved and identity-verified (the existing gate), AND
 *   2. `subscription_status = 'active'`, AND
 *   3. the subscription has not lapsed, AND
 *   4. the plan they hold actually includes that feature.
 *
 * ── Why this is a separate module from `seller-gate.ts` ──────────────────
 * `seller-gate.ts` answers "may this seller into the hub at all?" — an
 * onboarding question. This answers "may this seller use THIS feature?" —
 * a billing question. They fail differently: an unapproved seller is sent
 * to onboarding, an unpaid seller is sent to the subscription page, and a
 * Basic seller is shown an upgrade prompt. Mixing them would make one
 * redirect do three jobs.
 *
 * ── Why the feature list is read from the database ───────────────────────
 * The admin edits the Premium price and the feature list. If the gate
 * hardcoded "premium gets AI", an admin who moved a feature to Basic would
 * change the marketing page and nothing else. So the gate asks
 * `seller_has_feature` (sql/0035), which reads the same `seller_plans`
 * rows the comparison screen renders.
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PlanId = "basic" | "premium";

export type SellerPlan = {
  id: PlanId;
  name: string;
  tagline: string | null;
  price: number;
  features: { key?: string; label: string; included: boolean }[];
  recommended: boolean;
};

/**
 * The feature keys the app gates on.
 *
 * These are the `key` values stored on each plan's feature rows, NOT the
 * display labels. Matching on labels was the original approach and it broke
 * the moment a label was reworded — "AI seller analytics & insights" did not
 * match the key "AI seller analytics", so a paying Premium seller was
 * refused. Keys are stable; labels are presentation.
 */
export const FEATURES = {
  /** The AI product listing assistant (the existing one). */
  aiListing: "aiListing",
  /** AI seller analytics and insights. */
  aiInsights: "aiInsights",
  /** AI auto-reply when the seller is offline, and suggested replies. */
  aiReply: "aiReply",
  /** Priority placement in search. */
  priority: "priority",
  /** The verified Premium badge. */
  badge: "badge",
} as const;

export type FeatureKey = keyof typeof FEATURES;

/**
 * The plans as they exist before the admin has touched anything.
 *
 * ── Why a fallback and not just the table ─────────────────────────────
 * `seller_plans` is seeded by sql/0035, so in a migrated database the read
 * always returns two rows. But if the read fails — a migration not yet
 * applied, a transient error — the admin's plan editor rendered an empty
 * card with no price field at all, which looks like a broken page and
 * leaves no way to set the Premium price. Falling back to these defaults
 * means the editor always has something to edit, and the seller's
 * comparison screen always has two plans to show.
 *
 * The Premium price here is the brief's 7500. It is only a default: the
 * moment the admin saves, the table is the source of truth.
 */
export const DEFAULT_PLANS: SellerPlan[] = [
  {
    id: "basic",
    name: "Basic",
    tagline: "Everything you need to start selling.",
    price: 0,
    recommended: false,
    features: [
      { key: "listings", label: "Unlimited product & service listings", included: true },
      { key: "orders", label: "Order management and escrow payouts", included: true },
      { key: "chat", label: "Buyer chat and the chat guard", included: true },
      { key: "analytics", label: "Basic analytics (views, clicks, orders)", included: true },
      { key: "aiListing", label: "AI product listing assistant", included: false },
      { key: "aiInsights", label: "AI seller analytics & insights", included: false },
      { key: "aiReply", label: "AI auto-reply and suggested replies", included: false },
      { key: "priority", label: "Priority placement in search", included: false },
      { key: "badge", label: "Verified Premium badge", included: false },
    ],
  },
  {
    id: "premium",
    name: "Premium",
    tagline: "Every AI tool, and first place in search.",
    price: 7500,
    recommended: true,
    features: [
      { key: "listings", label: "Unlimited product & service listings", included: true },
      { key: "orders", label: "Order management and escrow payouts", included: true },
      { key: "chat", label: "Buyer chat and the chat guard", included: true },
      { key: "analytics", label: "Basic analytics (views, clicks, orders)", included: true },
      { key: "aiListing", label: "AI product listing assistant", included: true },
      { key: "aiInsights", label: "AI seller analytics & insights", included: true },
      { key: "aiReply", label: "AI auto-reply and suggested replies", included: true },
      { key: "priority", label: "Priority placement in search", included: true },
      { key: "badge", label: "Verified Premium badge", included: true },
    ],
  },
];

/** Both plans, in display order. */
export async function getSellerPlans(): Promise<SellerPlan[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("seller_plans")
    .select("id,name,tagline,price,features,recommended,sort_order")
    .eq("active", true)
    .order("sort_order");

  const rows = (data ?? []).map((p: any) => ({
    id: p.id as PlanId,
    name: p.name,
    tagline: p.tagline,
    price: Number(p.price ?? 0),
    features: Array.isArray(p.features) ? p.features : [],
    recommended: Boolean(p.recommended),
  }));

  // A missing or unreadable table must not leave the admin with an empty
  // editor, nor the seller with an empty comparison screen.
  return rows.length > 0 ? rows : DEFAULT_PLANS;
}

/** One plan by id. */
export async function getSellerPlan(id: PlanId): Promise<SellerPlan | null> {
  const plans = await getSellerPlans();
  return plans.find((p) => p.id === id) ?? null;
}

/**
 * Does this shop have this feature right now?
 *
 * Delegates to the database so the answer matches the RLS policies and the
 * admin's edits. A failure returns false — a gate that fails open is not a
 * gate.
 */
export async function shopHasFeature(shopId: string, feature: FeatureKey): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("seller_has_feature", {
    p_shop_id: shopId,
    p_feature: FEATURES[feature],
  });
  if (error) return false;
  return data === true;
}

/**
 * The subscription state of a shop, in the terms the UI needs.
 *
 * `active` is the only state that unlocks features. `pending` means a
 * receipt is waiting for an admin; `expired` means it lapsed; `none` means
 * they never paid.
 */
export type SubscriptionState = {
  status: "none" | "pending" | "active" | "expired";
  plan: PlanId;
  /** True only when paid, current, and the shop is approved. */
  active: boolean;
  expiresAt: string | null;
  /** Days left, when active. Null otherwise. */
  daysLeft: number | null;
};

export function subscriptionState(shop: {
  subscription_status?: string | null;
  subscription_expires_at?: string | null;
  plan?: string | null;
  status?: string | null;
  verified?: boolean | null;
} | null): SubscriptionState {
  const status = (shop?.subscription_status ?? "none") as SubscriptionState["status"];
  const plan = (shop?.plan === "premium" ? "premium" : "basic") as PlanId;
  const expiresAt = shop?.subscription_expires_at ?? null;

  const notLapsed = !expiresAt || new Date(expiresAt).getTime() > Date.now();
  const approved = shop?.status === "approved" && shop?.verified === true;

  const active = status === "active" && notLapsed && approved;

  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000))
    : null;

  return { status, plan, active, expiresAt, daysLeft };
}

/**
 * The path a seller should be sent to when a feature is locked.
 *
 * A seller with no subscription goes to the plan comparison; one whose
 * subscription lapsed goes to renew; a Basic seller goes to upgrade. All
 * three land on the same page, but the query string lets it open on the
 * right tab with the right message.
 */
export function upgradePath(state: SubscriptionState): string {
  if (state.status === "expired") return "/seller/subscription?renew=1";
  if (state.status === "pending") return "/seller/subscription?pending=1";
  if (state.status === "active" && state.plan === "basic") {
    return "/seller/subscription?upgrade=1";
  }
  return "/seller/subscription";
}
