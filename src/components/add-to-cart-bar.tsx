"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addToCart } from "@/lib/cart";
import { naira, cn } from "@/lib/utils";
import { Spinner } from "@/components/ui";

export function AddToCartBar({
  listing,
  shop,
  signedIn,
}: {
  listing: { id: string; title: string; price: number; original_price?: number | null; images: string[] };
  shop: { id: string; slug: string; name: string; logo_url: string | null; city: string | null; state: string | null; delivery_fee: number; free_delivery_threshold: number | null; pickup_available: boolean };
  signedIn: boolean;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);

  function add(then?: "cart" | "checkout") {
    addToCart({
      shopId: shop.id,
      shopSlug: shop.slug,
      shopName: shop.name,
      shopLogo: shop.logo_url,
      city: shop.city ?? "",
      state: shop.state ?? "",
      deliveryFee: shop.delivery_fee,
      freeThreshold: shop.free_delivery_threshold,
      pickupAvailable: shop.pickup_available,
      listingId: listing.id,
      title: listing.title,
      price: listing.price,
      originalPrice: listing.original_price ?? null,
      image: listing.images?.[0] ?? null,
      quantity: qty,
    });
    if (then === "checkout") {
      setBusy(true);
      router.push("/cart");
      return;
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <div className="sticky bottom-[62px] z-30 -mx-4 border-t border-[var(--line)] bg-white/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-2xl md:border md:shadow-card">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-[var(--line)] px-1">
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-600 hover:bg-slate-50"
            aria-label="Decrease quantity"
          >
            −
          </button>
          <span className="w-6 text-center text-[14px] font-bold">{qty}</span>
          <button
            onClick={() => setQty((q) => q + 1)}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-600 hover:bg-slate-50"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>

        <button onClick={() => add()} disabled={busy} className={cn("nm-btn-ghost flex-1 !py-2.5", added && "!border-brand-500 !bg-brand-50 !text-brand-700")}>
          {busy ? <Spinner /> : added ? "Added ✓" : "Add to cart"}
        </button>
        <button onClick={() => add("checkout")} className="nm-btn-primary flex-1 !py-2.5">
          Buy now
        </button>
      </div>
      <p className="mt-2 text-center text-[11.5px] text-ink-400">
        {naira(listing.price * qty)} · money held in escrow until you confirm delivery
      </p>
    </div>
  );
}
