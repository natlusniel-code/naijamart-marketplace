"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addToCart } from "@/lib/cart";
import { naira, cn } from "@/lib/utils";
import { Spinner } from "@/components/ui";
import type { GigPackage } from "@/lib/queries";

/**
 * The Basic / Standard / Premium selector on a gig page.
 *
 * Fiverr's shape: three tabs across the top, the chosen tier's price,
 * delivery time and feature list below, and one button that puts THAT tier
 * in the cart. The tier travels with the line, and `place_order` re-prices
 * it from `gig_packages` — the price shown here is never trusted by the
 * server.
 *
 * A gig with no packages falls back to a single "book at the starting
 * price" box, so a seller who never set tiers can still be booked.
 */
export function GigPackages({
  listingId,
  title,
  image,
  packages,
  shop,
  signedIn,
  canOrderInCity,
}: {
  listingId: string;
  title: string;
  image: string | null;
  packages: GigPackage[];
  shop: {
    id: string;
    slug: string;
    name: string;
    logo_url: string | null;
    city: string | null;
    state: string | null;
  };
  signedIn: boolean;
  canOrderInCity: boolean;
}) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const pkg = packages[active];
  // What the buyer actually pays. `effective_price` is a generated column in
  // the database (sql/0023), so this is the same number `place_order` charges.
  const pkgPrice = Number(pkg?.effective_price ?? pkg?.price ?? 0);
  const pkgList = Number(pkg?.price ?? 0);
  const pkgOff = Number(pkg?.discount_percent ?? 0);
  const pkgOnSale = pkgOff > 0 && pkgList > pkgPrice;

  function book() {
    if (!signedIn) {
      router.push(`/signin?next=${encodeURIComponent(`/listing/${listingId}`)}`);
      return;
    }
    setBusy(true);
    addToCart({
      shopId: shop.id,
      shopSlug: shop.slug,
      shopName: shop.name,
      shopLogo: shop.logo_url,
      city: shop.city ?? "",
      state: shop.state ?? "",
      // A gig is performed, not shipped: no courier fee, ever.
      deliveryFee: 0,
      freeThreshold: null,
      pickupAvailable: true,
      listingId,
      title: pkg ? `${title} — ${pkg.name}` : title,
      price: pkgPrice,
      originalPrice: pkgOnSale ? pkgList : null,
      image,
      quantity: 1,
      isService: true,
      packageTier: pkg?.tier ?? null,
    });
    setBusy(false);
    setAdded(true);
    router.push("/cart");
  }

  if (packages.length === 0) {
    return (
      <div className="nm-card p-4">
        <p className="text-[13px] text-ink-500">
          This provider has not set packages yet. Chat with them to agree a price.
        </p>
      </div>
    );
  }

  return (
    <div className="nm-card overflow-hidden">
      {/* tier tabs */}
      <div className="grid grid-cols-3 border-b border-[var(--line)]">
        {packages.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive(i)}
            aria-pressed={i === active}
            className={cn(
              "border-b-2 px-2 py-2.5 text-[12.5px] font-bold transition",
              i === active
                ? "border-brand-600 bg-brand-50/50 text-ink-900"
                : "border-transparent text-ink-400 hover:text-ink-700",
            )}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-[22px] font-extrabold tracking-tight text-ink-900">
              {naira(pkgPrice)}
            </p>
            {pkgOnSale && (
              <>
                <span className="text-[13px] font-medium text-ink-400 line-through">
                  {naira(pkgList)}
                </span>
                <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">
                  {Number.isInteger(pkgOff) ? pkgOff : pkgOff.toFixed(1)}% off
                </span>
              </>
            )}
          </div>
          {pkg.delivery_days != null && (
            <p className="text-[12px] font-semibold text-ink-500">
              {pkg.delivery_days}-day delivery
            </p>
          )}
        </div>

        {pkg.description && (
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{pkg.description}</p>
        )}

        {pkg.features?.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {pkg.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[12.5px] text-ink-600">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 13 4 4L19 7" />
                </svg>
                {f}
              </li>
            ))}
          </ul>
        )}

        {!canOrderInCity && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
            This provider works in a different city from yours. You can still chat, but
            home-visit bookings are limited to your own city.
          </p>
        )}

        <button
          type="button"
          onClick={book}
          disabled={busy}
          className="nm-btn-primary mt-3 w-full !py-2.5"
        >
          {busy ? <Spinner /> : added ? "Added ✓" : `Continue — ${naira(pkgPrice)}`}
        </button>

        <p className="mt-2 text-center text-[11px] text-ink-400">
          No delivery fee · money held in escrow until you confirm the work
        </p>
      </div>
    </div>
  );
}
