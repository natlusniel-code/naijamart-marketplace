import Link from "next/link";
import { naira, cn } from "@/lib/utils";
import { Star, VerifiedBadge } from "@/components/ui";
import type { Listing, ShopLite } from "@/lib/queries";

/** "Ikeja, Lagos" — the location line every card must show. */
export function placeLabel(shop?: { city?: string | null; state?: string | null } | null): string | null {
  if (!shop) return null;
  const city = shop.city?.trim();
  const state = shop.state?.trim();
  if (city && state) return `${city}, ${state}`;
  return city || state || null;
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function ListingCard({ l, className }: { l: Listing; className?: string }) {
  const img = l.images?.[0];
  const place = placeLabel(l.shops);
  return (
    <Link
      href={`/listing/${l.id}`}
      className={cn("group overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-lift", className)}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={l.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center text-3xl text-slate-300">📦</div>
        )}
        {l.type === "service" && (
          <span className="absolute left-2 top-2 rounded-full bg-ink-900/80 px-2 py-0.5 text-[10.5px] font-semibold text-white">
            Service
          </span>
        )}
        {/* location badge — always visible so the buyer knows where it ships from */}
        {place && (
          <span className="absolute bottom-2 left-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[10.5px] font-semibold text-ink-700 shadow-sm backdrop-blur">
            <PinIcon className="h-3 w-3 shrink-0 text-brand-600" />
            <span className="truncate">{place}</span>
          </span>
        )}
        {l.stock === 0 && l.type === "product" && (
          <span className="absolute inset-0 grid place-items-center bg-white/70 text-[12.5px] font-bold text-ink-700">
            Out of stock
          </span>
        )}
      </div>

      <div className="p-3">
        <p className="line-clamp-2 min-h-[36px] text-[13.5px] font-semibold leading-snug text-ink-900">{l.title}</p>
        <p className="mt-1.5 text-[15px] font-extrabold text-ink-900">
          {naira(l.price)}
          {l.type === "service" && <span className="ml-1 text-[11.5px] font-medium text-ink-400">from</span>}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <p className="truncate text-[11.5px] text-ink-500">{l.shops?.name}</p>
          {l.shops?.verified && (
            <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 text-brand-600" fill="currentColor"><path d="M12 2 15.1 4.6l4.1.2.2 4.1L22 12l-2.6 3.1-.2 4.1-4.1.2L12 22l-3.1-2.6-4.1-.2-.2-4.1L2 12l2.6-3.1.2-4.1 4.1-.2L12 2Z" opacity=".2" /><path d="m10.6 14.6-2.2-2.2 1.1-1.1 1.1 1.1 3.9-3.9 1.1 1.1-5 5Z" /></svg>
          )}
        </div>
        {/* second, textual location line — readable even when the image fails */}
        {place && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-400">
            <PinIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{place}</span>
          </p>
        )}
      </div>
    </Link>
  );
}

export function ShopCard({ s }: { s: ShopLite }) {
  const place = placeLabel(s);
  return (
    <Link
      href={`/shop/${s.slug}`}
      className="group flex w-[172px] shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-lift sm:w-[196px]"
    >
      <div className="relative h-[74px] w-full overflow-hidden bg-brand-50">
        {s.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.banner_url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-brand-100 to-brand-50" />
        )}
      </div>
      <div className="-mt-6 px-3 pb-3">
        <div className="mb-1.5 flex items-end gap-2">
          {s.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.logo_url} alt={s.name} className="h-11 w-11 rounded-xl border-2 border-white object-cover shadow-sm" loading="lazy" />
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-xl border-2 border-white bg-brand-500 text-[15px] font-bold text-white shadow-sm">
              {s.name.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        <p className="truncate text-[13.5px] font-bold text-ink-900">{s.name}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <Star value={Number(s.rating_avg)} count={s.rating_count} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {s.verified && <VerifiedBadge />}
          {place && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-ink-400">
              <PinIcon className="h-2.5 w-2.5" />
              {place}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
