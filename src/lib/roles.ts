/**
 * Who is a seller?
 *
 * ── One account, one role ─────────────────────────────────────────────
 * `public.profiles` is the single account table and `role` is the
 * discriminator. There is no separate buyer table and seller table: a buyer
 * and a seller are the same row with a different `role`. "Move the account
 * from the buyer side to the seller side" therefore means flipping `role` on
 * that one row — never creating a second record.
 *
 * The database enforces that (sql/0014): creating a `shops` row promotes its
 * owner to `seller` in the same transaction, and `tg_profiles_guard` refuses
 * to store a shop owner as a buyer. So `role` and shop ownership can no
 * longer disagree.
 *
 * ── Why this helper still checks both ─────────────────────────────────
 * A page can read a profile that was fetched a moment before the promotion
 * committed (a stale cookie session, a cached RSC payload, a request that
 * raced the onboarding insert). Treating shop ownership as a seller signal
 * too makes those reads self-healing instead of stranding a real seller on
 * the storefront — and because the database guarantees the two agree, it can
 * never misclassify a genuine buyer, who by definition owns no shop.
 *
 * The rule, in one line: a seller is an account with `role = 'seller'` (or an
 * admin) **or** an account that owns a shop. A buyer is everything else.
 */

export type RoleProfile = { role?: string | null } | null | undefined;
export type RoleShop = { id?: string | null } | null | undefined;

/** True when this account operates as a seller. */
export function isSellerAccount(profile: RoleProfile, shop: RoleShop): boolean {
  const role = profile?.role ?? null;
  if (role === "seller" || role === "admin") return true;
  // A shop row is proof of a seller even if the role read is stale.
  return Boolean(shop?.id);
}

/**
 * True only for a plain buyer: no seller role and no shop.
 *
 * This is the check that keeps a buyer out of the Seller Hub and its
 * seller-only account settings page.
 */
export function isBuyerAccount(profile: RoleProfile, shop: RoleShop): boolean {
  return !isSellerAccount(profile, shop);
}
