"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readCart, writeCart, setQuantity, setFulfilment, removeShop, shopSubtotal, shopDelivery, isServiceOnly, type Cart, type CartShop } from "@/lib/cart";
import { naira, discountPercent } from "@/lib/utils";
import { EmptyState, Alert, Badge } from "@/components/ui";
import { StartConversationButton } from "@/components/start-conversation-button";

export function CartView() {
  const [cart, setCart] = useState<Cart | null>(null);

  useEffect(() => {
    const sync = () => setCart(readCart());
    sync();
    window.addEventListener("nm:cart", sync);
    return () => window.removeEventListener("nm:cart", sync);
  }, []);

  if (cart === null) {
    return <div className="h-64 nm-skeleton rounded-2xl" />;
  }

  const shops = Object.values(cart);

  if (shops.length === 0) {
    return (
      <EmptyState
        icon="🛒"
        title="Your cart is empty"
        body="Add something from a verified seller and it will show up here. Your money stays in escrow until you confirm delivery."
        action="Start shopping"
        href="/"
      />
    );
  }

  const subtotal = shops.reduce((n, s) => n + shopSubtotal(s), 0);
  const delivery = shops.reduce((n, s) => n + shopDelivery(s), 0);
  // When the whole cart is gigs there is no delivery line at all — a "Free"
  // row would imply something is being shipped for nothing.
  const allServices = shops.length > 0 && shops.every(isServiceOnly);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] lg:items-start">
      <div className="space-y-4">
        {shops.map((s) => (
          <ShopGroup key={s.shopId} shop={s} />
        ))}

        <Alert tone="blue" title="Ordering from more than one shop?">
          Each shop ships separately and has its own delivery fee. You&apos;ll pay one transfer per shop so every
          shop&apos;s money is held in escrow on its own.
        </Alert>
      </div>

      {/* summary */}
      <div className="nm-card p-4 lg:sticky lg:top-20">
        <h2 className="text-[15px] font-bold text-ink-900">Order summary</h2>
        <dl className="mt-3 space-y-2 text-[13.5px]">
          <div className="flex justify-between">
            <dt className="text-ink-500">Subtotal</dt>
            <dd className="font-semibold text-ink-900">{naira(subtotal)}</dd>
          </div>
          {!allServices && (
            <div className="flex justify-between">
              <dt className="text-ink-500">Delivery</dt>
              <dd className="font-semibold text-ink-900">{delivery === 0 ? "Free" : naira(delivery)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-[var(--line)] pt-2 text-[15px]">
            <dt className="font-bold text-ink-900">Total</dt>
            <dd className="font-extrabold text-ink-900">{naira(subtotal + delivery)}</dd>
          </div>
        </dl>

        {/* A basket of services cannot be checked out: nothing is shipped and
            the price is only agreed once the provider answers. The action is
            therefore a conversation, not a payment — and it carries the plan
            the buyer picked, so the provider knows what is being asked for.
            A mixed or goods-only basket keeps the normal checkout. */}
        {allServices ? (
          <>
            <StartConversationButton
              shop={shops[0]}
              signedIn
              className="nm-btn-primary mt-4 w-full !py-3"
            />
            <p className="mt-2 text-center text-[11.5px] leading-relaxed text-ink-400">
              A service is agreed in chat. Send the plan to the provider, they reply with an
              offer, and you pay only once you accept it.
            </p>
          </>
        ) : (
          <>
            <Link href="/checkout" className="nm-btn-primary mt-4 w-full !py-3">
              Proceed to checkout
            </Link>
            <p className="mt-2 text-center text-[11.5px] leading-relaxed text-ink-400">
              You pay NaijaMart by bank transfer. We hold it until you confirm delivery.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ShopGroup({ shop }: { shop: CartShop }) {
  const sub = shopSubtotal(shop);
  const fee = shopDelivery(shop);
  const serviceOnly = isServiceOnly(shop);
  const remaining = shop.freeThreshold != null ? Math.max(0, shop.freeThreshold - sub) : 0;
  const pct = shop.freeThreshold ? Math.min(100, (sub / shop.freeThreshold) * 100) : 0;

  return (
    <div className="nm-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
        <Link href={`/shop/${shop.shopSlug}`} className="flex items-center gap-2 text-[13.5px] font-bold text-ink-900 hover:text-brand-600">
          <span>🏪</span> {shop.shopName}
        </Link>
        <button
          onClick={() => removeShop(shop.shopId)}
          className="text-[11.5px] font-semibold text-ink-400 hover:text-red-600"
        >
          Remove shop
        </button>
      </div>

      <div className="divide-y divide-[var(--line)]">
        {shop.lines.map((l) => (
          <div key={l.listingId} className="flex gap-3 px-4 py-3">
            <Link href={`/listing/${l.listingId}`} className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100">
              {l.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.image} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-lg text-slate-300">📦</div>
              )}
            </Link>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink-900">{l.title}</p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5 text-[13px] font-bold text-ink-900">
                {naira(l.price)}
                {discountPercent(l.price, l.originalPrice) > 0 && l.originalPrice != null && (
                  <span className="text-[11px] font-medium text-ink-400 line-through">{naira(l.originalPrice)}</span>
                )}
              </p>
              <div className="mt-1.5 flex items-center gap-1 rounded-lg border border-[var(--line)] px-1 w-fit">
                <button
                  onClick={() => setQuantity(shop.shopId, l.listingId, l.quantity - 1)}
                  className="grid h-7 w-7 place-items-center rounded text-ink-600 hover:bg-slate-50"
                  aria-label="Decrease"
                >−</button>
                <span className="w-5 text-center text-[12.5px] font-bold">{l.quantity}</span>
                <button
                  onClick={() => setQuantity(shop.shopId, l.listingId, l.quantity + 1)}
                  className="grid h-7 w-7 place-items-center rounded text-ink-600 hover:bg-slate-50"
                  aria-label="Increase"
                >+</button>
              </div>
            </div>
            <p className="shrink-0 text-[13px] font-bold text-ink-900">{naira(l.price * l.quantity)}</p>
          </div>
        ))}
      </div>

      {/* fulfilment.
          A service-only basket has no pickup/delivery choice to make: the
          provider performs the work, so there is nothing to ship and nothing
          to collect. Showing the toggle would offer the buyer a decision that
          cannot change the price or the outcome, so the whole block is
          replaced with a plain statement of how a gig is fulfilled. */}
      {serviceOnly ? (
        <div className="border-t border-[var(--line)] px-4 py-3">
          <p className="flex items-center gap-2 text-[12px] text-ink-500">
            <span className="text-brand-600">🛠️</span>
            Service — the provider does the work. No delivery or pickup, and no delivery fee.
          </p>
        </div>
      ) : (
        <div className="border-t border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-2">
            {shop.pickupAvailable && (
              <button
                onClick={() => setFulfilment(shop.shopId, "pickup")}
                className={`nm-chip !py-1 ${shop.fulfilment === "pickup" ? "nm-chip-active" : ""}`}
              >
                Pickup
              </button>
            )}
            <button
              onClick={() => setFulfilment(shop.shopId, "delivery")}
              className={`nm-chip !py-1 ${shop.fulfilment === "delivery" ? "nm-chip-active" : ""}`}
            >
              Delivery
            </button>
            <span className="ml-auto text-[12px] text-ink-500">
              {shop.fulfilment === "pickup" ? "Free pickup" : fee === 0 ? "Free delivery" : `Delivery ${naira(fee)}`}
            </span>
          </div>

          {shop.freeThreshold != null && shop.fulfilment === "delivery" && (
            <div className="mt-2.5">
              {remaining > 0 ? (
                <p className="text-[11.5px] font-medium text-ink-500">
                  Add <strong className="text-brand-700">{naira(remaining)}</strong> more for free delivery
                </p>
              ) : (
                <p className="text-[11.5px] font-semibold text-brand-700">✓ You&apos;ve unlocked free delivery</p>
              )}
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[var(--line)] bg-slate-50/60 px-4 py-2.5">
        <span className="text-[12.5px] font-semibold text-ink-600">Shop total</span>
        <span className="text-[15px] font-extrabold text-ink-900">{naira(sub + fee)}</span>
      </div>
    </div>
  );
}
