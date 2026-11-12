import Link from "next/link";
import { naira, cn } from "@/lib/utils";
import { Star } from "@/components/ui";
import { WishlistButton } from "@/components/wishlist-button";
import type { Listing } from "@/lib/queries";

/**
 * The gig card — Fiverr's layout, NaijaMart's data.
 *
 * Reading order, top to bottom, is deliberate and matches the reference:
 *
 *   1. a big thumbnail of the service picture (the thing being sold)
 *   2. the provider's logo as a small icon at the BOTTOM LEFT of that
 *      thumbnail, overlapping the edge — so the face behind the work is
 *      attached to the work, not buried in a text row
 *   3. the service name, then the detail under it
 *   4. the provider name, rating and starting price
 *
 * The provider logo is the one element that must not move: it is what
 * makes a marketplace of strangers feel accountable.
 */
export function GigCard({
  l,
  className,
  saved = false,
  signedIn = false,
}: {
  l: Listing;
  className?: string;
  saved?: boolean;
  signedIn?: boolean;
}) {
  const img = l.images?.[0];
  const shop = l.shops;
  const isOnline = l.service_mode === "online";

  return (
    <Link
      href={`/listing/${l.id}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-lift",
        className,
      )}
    >
      {/* 1. big thumbnail */}
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={l.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full place-items-center text-3xl text-slate-300">🛠️</div>
        )}

        {/* online gigs have no coverage area — say so on the card, because
            a buyer in another city needs to know they can still book it */}
        {isOnline && (
          <span className="absolute right-2 top-2 rounded-full bg-ink-900/80 px-2 py-0.5 text-[10.5px] font-semibold text-white backdrop-blur">
            Online
          </span>
        )}

        <WishlistButton listingId={l.id} saved={saved} signedIn={signedIn} />

        {/* 2. provider logo, bottom-left, overlapping the thumbnail edge */}
        <span className="absolute -bottom-0 left-3 translate-y-1/2">
          {shop?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shop.logo_url}
              alt={shop.name}
              className="h-9 w-9 rounded-full border-2 border-white object-cover shadow-sm"
              loading="lazy"
            />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-brand-500 text-[11px] font-bold text-white shadow-sm">
              {(shop?.name ?? "NM").slice(0, 2).toUpperCase()}
            </span>
          )}
        </span>
      </div>

      {/* 3 + 4. name, detail, provider, price */}
      <div className="flex flex-1 flex-col p-3 pt-6">
        <p className="line-clamp-2 min-h-[36px] text-[13.5px] font-semibold leading-snug text-ink-900">
          {l.title}
        </p>

        {l.description && (
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-ink-500">
            {l.description}
          </p>
        )}

        <div className="mt-1.5 flex items-center gap-1.5">
          <p className="truncate text-[11.5px] font-medium text-ink-600">{shop?.name}</p>
          {shop?.verified && (
            <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 text-brand-600" fill="currentColor">
              <path d="M12 2 15.1 4.6l4.1.2.2 4.1L22 12l-2.6 3.1-.2 4.1-4.1.2L12 22l-3.1-2.6-4.1-.2-.2-4.1L2 12l2.6-3.1.2-4.1 4.1-.2L12 2Z" opacity=".2" />
              <path d="m10.6 14.6-2.2-2.2 1.1-1.1 1.1 1.1 3.9-3.9 1.1 1.1-5 5Z" />
            </svg>
          )}
        </div>

        <div className="mt-1 flex items-center gap-2">
          <Star value={Number(shop?.rating_avg ?? 0)} count={shop?.rating_count} />
          {l.delivery_days != null && (
            <span className="text-[11px] text-ink-400">· {l.delivery_days}-day delivery</span>
          )}
        </div>

        <p className="mt-auto pt-2 text-[14px] font-extrabold text-ink-900">
          From {naira(l.price)}
        </p>
      </div>
    </Link>
  );
}
