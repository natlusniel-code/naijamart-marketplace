import Link from "next/link";
import { naira, cn } from "@/lib/utils";
import { Star } from "@/components/ui";
import { WishlistButton } from "@/components/wishlist-button";
import type { Listing } from "@/lib/queries";

/**
 * The gig card.
 *
 * Layout follows the layout sketch, which is explicit about the card's
 * anatomy. Reading order, top to bottom:
 *
 *   1. a big thumbnail of the service picture — roughly 40% of the card
 *   2. the provider's logo, top-left, inside that thumbnail's corner
 *   3. the service name, then the detail under it
 *   4. the provider name with a verified tick
 *   5. the rating line: stars, then delivery time
 *   6. the price on its own line at the bottom
 *
 * Two things the sketch settled that the previous build got wrong:
 *
 *   - The provider logo is at the TOP-LEFT. It had been half-overlapping
 *     the thumbnail's lower edge.
 *   - The price is on its OWN line. It had been sharing a row with the
 *     rating, which made the card read as a product tile rather than a gig.
 *
 * The rating is the GIG's own (sql/0021), falling back to the shop's when
 * the gig has no reviews yet. A shop with one great gig and one poor one
 * must not show the same stars on both.
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

  // The gig's own stars when it has any; otherwise the shop's, which is
  // still a real signal and better than an empty row.
  const ownCount = Number(l.rating_count ?? 0);
  const ratingValue = ownCount > 0 ? Number(l.rating_avg) : Number(shop?.rating_avg ?? 0);
  const ratingCount = ownCount > 0 ? ownCount : Number(shop?.rating_count ?? 0);

  return (
    <Link
      href={`/listing/${l.id}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-lift",
        className,
      )}
    >
      {/* 1. big thumbnail — the thing being sold, at ~40% of the card */}
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

        {/* 2. provider logo — TOP-LEFT, as drawn. It sits inside the
            thumbnail's corner so the face behind the work stays attached
            to the work. */}
        <span className="absolute left-2 top-2">
          {shop?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shop.logo_url}
              alt={shop.name}
              className="h-9 w-9 rounded-full border-2 border-white object-cover shadow-md"
              loading="lazy"
            />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-brand-500 text-[11px] font-bold text-white shadow-sm">
              {(shop?.name ?? "NM").slice(0, 2).toUpperCase()}
            </span>
          )}
        </span>

        {/* Online gigs have no coverage area — say so, because a buyer in
            another city needs to know they can still book it. It sits at
            the BOTTOM-left of the image: the top-right belongs to the
            wishlist heart, and the two used to collide. */}
        {isOnline && (
          <span className="absolute bottom-2 left-2 rounded-full bg-ink-900/80 px-2 py-0.5 text-[10.5px] font-semibold text-white">
            Online
          </span>
        )}

        <WishlistButton listingId={l.id} saved={saved} signedIn={signedIn} />
      </div>

      {/* 3–6. name, detail, provider, rating, price */}
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 min-h-[36px] text-[13.5px] font-semibold leading-snug text-ink-900">
          {l.title}
        </p>

        {l.description && (
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-ink-500">
            {l.description}
          </p>
        )}

        {/* 4. provider, with the verified tick beside the name */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <p className="truncate text-[11.5px] font-medium text-ink-600">{shop?.name}</p>
          {shop?.verified && (
            <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 text-brand-600" fill="currentColor">
              <path d="M12 2 15.1 4.6l4.1.2.2 4.1L22 12l-2.6 3.1-.2 4.1-4.1.2L12 22l-3.1-2.6-4.1-.2-.2-4.1L2 12l2.6-3.1.2-4.1 4.1-.2L12 2Z" opacity=".2" />
              <path d="m10.6 14.6-2.2-2.2 1.1-1.1 1.1 1.1 3.9-3.9 1.1 1.1-5 5Z" />
            </svg>
          )}
        </div>

        {/* 5. rating line — stars, then delivery time */}
        <div className="mt-1 flex items-center gap-2">
          <Star value={ratingValue} count={ratingCount} />
          {l.delivery_days != null && (
            <span className="text-[11px] text-ink-400">· {l.delivery_days}-day delivery</span>
          )}
        </div>

        {/* 6. price on its own line, pinned to the bottom so cards in a row
            line up even when the description runs to two lines */}
        <p className="mt-auto pt-2 text-[14px] font-extrabold text-ink-900">
          From {naira(l.price)}
        </p>
      </div>
    </Link>
  );
}
