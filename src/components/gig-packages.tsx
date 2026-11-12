"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { naira } from "@/lib/utils";
import { Spinner } from "@/components/ui";
import { composePlanMessage, openChatWithDraft } from "@/lib/offer-draft";
import type { GigPackage } from "@/lib/queries";

/**
 * The plan card on a gig page — and the only way to start a gig order.
 *
 * ── Why Description lives in here ─────────────────────────────────
 * Description and the Basic/Standard/Premium selector used to be two separate
 * cards stacked on top of each other: a short description in one, the plan in
 * the next. On a phone that split one idea — "what this gig is and what it
 * costs" — across two cramped boxes with a card gap between them, and pushed
 * the price off the first screen. They are now ONE card: the description at
 * the top, the tier tabs and their price directly beneath it, because a buyer
 * reads what the work is and then immediately what it costs.
 *
 * ── Why Continue no longer touches the cart ───────────────────────
 * It used to drop the chosen tier into the cart and send the buyer to
 * checkout. That let someone pay ₦5,000 for a plan the provider had never
 * seen or agreed to, and it produced the LGA block: a buyer in Odeda buying
 * from Ijebu Ode was refused because a SERVICE was being run through the
 * same delivery-distance rule as a parcel.
 *
 * A gig is agreed, not shipped. So Continue now opens the seller's chat with
 * the plan spelled out in the composer — price, what is included, the tier —
 * and the buyer presses Send. The seller answers with a formal offer, the
 * buyer accepts it, and THAT order is what gets paid. The distance rule no
 * longer applies to it (see sql/0024), because nothing travels.
 */
export function GigPackages({
  listingId,
  title,
  description,
  serviceMode,
  serviceArea,
  needsHomeVisit,
  packages,
  shop,
  signedIn,
}: {
  listingId: string;
  title: string;
  /** The gig's own description, merged into this card. */
  description: string | null;
  serviceMode: "online" | "home" | null;
  serviceArea: string | null;
  needsHomeVisit: boolean | null;
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
}) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const pkg = packages[active];
  // What the buyer actually pays. `effective_price` is a generated column in
  // the database (sql/0023), so this is the same number the seller sees.
  const pkgPrice = Number(pkg?.effective_price ?? pkg?.price ?? 0);
  const pkgList = Number(pkg?.price ?? 0);
  const pkgOff = Number(pkg?.discount_percent ?? 0);
  const pkgOnSale = pkgOff > 0 && pkgList > pkgPrice;

  async function startChat() {
    if (!signedIn) {
      router.push(`/signin?next=${encodeURIComponent(`/listing/${listingId}`)}`);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const draft = composePlanMessage({
        title,
        packageName: pkg?.name ?? null,
        price: pkgPrice,
        features: pkg?.features ?? null,
        deliveryDays: pkg?.delivery_days ?? null,
      });
      const href = await openChatWithDraft({ shopId: shop.id, draft });
      router.push(href);
    } catch (e: any) {
      setBusy(false);
      setErr(e?.message ?? "Could not open the chat. Please try again.");
    }
  }

  return (
    <div className="nm-card overflow-hidden">
      {/* description — the top half of the card, no longer its own box */}
      <div className="border-b border-[var(--line)] p-4">
        <h2 className="text-[14px] font-bold text-ink-900">Description</h2>
        <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-600">
          {description || "The seller hasn't added a description for this gig yet."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {serviceMode === "online" ? (
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11.5px] font-semibold text-brand-800">
              🌐 Online — works anywhere in Nigeria
            </span>
          ) : (
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11.5px] font-semibold text-blue-800">
              🏠 Home visit
            </span>
          )}
          {serviceArea && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] font-semibold text-ink-600">
              Area: {serviceArea}
            </span>
          )}
          {needsHomeVisit && (
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11.5px] font-semibold text-violet-800">
              Provider travels
            </span>
          )}
          {pkg?.delivery_days != null && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] font-semibold text-ink-600">
              {pkg.delivery_days}-day delivery
            </span>
          )}
        </div>
      </div>

      {packages.length === 0 ? (
        <div className="p-4">
          <p className="text-[13px] text-ink-500">
            This provider has not set packages yet. Chat with them to agree a price.
          </p>
          <button
            type="button"
            onClick={startChat}
            disabled={busy}
            className="nm-btn-primary mt-3 w-full !py-2.5"
          >
            {busy ? <Spinner /> : "Chat with provider"}
          </button>
          {err && <p className="mt-2 text-[12px] font-medium text-red-600">{err}</p>}
        </div>
      ) : (
        <>
          {/* tier tabs */}
          <div className="grid grid-cols-3 border-b border-[var(--line)]">
            {packages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={i === active}
                className={[
                  "border-b-2 px-2 py-2.5 text-[12.5px] font-bold transition",
                  i === active
                    ? "border-brand-600 bg-brand-50/50 text-ink-900"
                    : "border-transparent text-ink-400 hover:text-ink-700",
                ].join(" ")}
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
                    <svg
                      viewBox="0 0 24 24"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={startChat}
              disabled={busy}
              className="nm-btn-primary mt-3 w-full !py-2.5"
            >
              {busy ? <Spinner /> : `Continue — ${naira(pkgPrice)}`}
            </button>
            {err && <p className="mt-2 text-[12px] font-medium text-red-600">{err}</p>}
          </div>
        </>
      )}
    </div>
  );
}
