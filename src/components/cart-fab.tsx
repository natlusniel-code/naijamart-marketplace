"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cartCount, readCart, type Cart } from "@/lib/cart";
import { naira } from "@/lib/utils";

/**
 * Floating cart button.
 *
 * ── Why it is a small circle now ─────────────────────────────────────────────
 * The previous version was a full-width pill pinned to the horizontal centre
 * (`left-1/2 -translate-x-1/2`, "View cart · ₦12,000"). On a phone it sat right
 * on top of the bottom tab bar and covered listing cards and the "Add to cart"
 * bar; on desktop it floated over the middle of the content column. It was
 * always visible once the cart had anything in it, so it permanently blocked
 * whatever was underneath.
 *
 * This version is a 48px circle in the bottom-RIGHT corner with a count badge
 * on its top-right edge. It is deliberately out of the reading column:
 *
 *   - mobile:  sits above the fixed tab bar (`bottom` clears the bar height
 *              plus `env(safe-area-inset-bottom)`), inset from the right edge
 *   - desktop: sits in the bottom-right corner, clear of the max-w-7xl content
 *
 * The badge shows the total item count (1, 2, 3, …) and the whole button is
 * hidden when the cart is empty, so nothing is drawn at all in the common case.
 * The price is no longer printed on the button — it lives on /cart — which is
 * what keeps the footprint small.
 */
export function CartFab() {
  const [cart, setCart] = useState<Cart>({});
  const path = usePathname() || "/";

  useEffect(() => {
    const sync = () => setCart(readCart());
    sync();
    window.addEventListener("nm:cart", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("nm:cart", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // The cart page itself has nothing to link to, and a listing page already
  // has a sticky "Add to cart / Buy now" bar in the same corner — a floating
  // button there would sit on top of it. Everywhere else it is shown.
  const hidden = path === "/cart" || path.startsWith("/listing/");

  const n = cartCount(cart);
  if (!n || hidden) return null;

  const total = Object.values(cart).reduce(
    (sum, s) => sum + s.lines.reduce((m, l) => m + l.price * l.quantity, 0),
    0,
  );

  return (
    <Link
      href="/cart"
      aria-label={`View cart — ${n} item${n === 1 ? "" : "s"}, ${naira(total)}`}
      title={`View cart · ${naira(total)}`}
      className="group fixed right-4 z-40 grid h-12 w-12 place-items-center rounded-full bg-brand-600 text-white shadow-lift ring-1 ring-black/5 transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 md:right-6"
      style={{
        // Clear the fixed mobile tab bar (≈56px) plus the iOS home indicator.
        bottom: "calc(4.5rem + env(safe-area-inset-bottom))",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[22px] w-[22px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 4h2.2l2.1 10.4a1.6 1.6 0 0 0 1.6 1.3h8.3a1.6 1.6 0 0 0 1.6-1.3L20.5 7H6" />
        <circle cx="9.5" cy="19.5" r="1.4" />
        <circle cx="17.5" cy="19.5" r="1.4" />
      </svg>

      {/* Count badge — sits on the top-right edge of the circle, outside it, so
          it never covers the icon itself. */}
      <span
        className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10.5px] font-bold leading-none text-white ring-2 ring-white"
        aria-hidden="true"
      >
        {n > 99 ? "99+" : n}
      </span>
    </Link>
  );
}
