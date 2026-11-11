import Link from "next/link";
import { getSession } from "@/lib/supabase/server";
import { searchListings, getCategories, getPlaces, resolveCity, getWishlistIds, ALL_CITIES } from "@/lib/queries";
import { ListingCard } from "@/components/cards";
import { LocationFilter } from "@/components/location-filter";
import { EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search" };

type SP = {
  q?: string; category?: string; city?: string; min?: string; max?: string;
  rating?: string; pickup?: string; verified?: string; sort?: string; type?: string;
};

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const session = await getSession();
  const myCity = session?.profile.city ?? null;

  // Same rule as the home page: default to the buyer's city, ?city=all
  // removes the filter so every city is browsable.
  const city = resolveCity(searchParams.city, myCity);
  const browsingAll = city === null;

  const [cats, places, results, savedIds] = await Promise.all([
    getCategories(),
    getPlaces(),
    searchListings({
      city,
      q: searchParams.q,
      category: searchParams.category,
      min: searchParams.min ? Number(searchParams.min) : undefined,
      max: searchParams.max ? Number(searchParams.max) : undefined,
      minRating: searchParams.rating ? Number(searchParams.rating) : undefined,
      pickup: searchParams.pickup === "1",
      verifiedOnly: searchParams.verified === "1",
      sort: searchParams.sort,
      type: searchParams.type === "service" ? "service" : searchParams.type === "product" ? "product" : undefined,
    }),
    session ? getWishlistIds(session.user.id) : Promise.resolve([] as string[]),
  ]);
  const saved = new Set(savedIds);

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { ...searchParams, ...patch };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) p.set(k, String(v));
    });
    return `/search?${p.toString()}`;
  };

  const activeCat = searchParams.category ?? "all";

  return (
    <div className="space-y-4">
      <form action="/search" className="flex gap-2">
        {searchParams.type && <input type="hidden" name="type" value={searchParams.type} />}
        {searchParams.city && <input type="hidden" name="city" value={searchParams.city} />}
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Search goods, services, shops…" className="nm-input !py-3 pl-10" aria-label="Search query" />
        </div>
        <button className="nm-btn-primary !px-4">Search</button>
      </form>

      {/* location filter */}
      <LocationFilter
        places={places}
        activeCity={city}
        myCity={myCity}
        basePath="/search"
        params={{
          q: searchParams.q,
          category: searchParams.category,
          type: searchParams.type,
          verified: searchParams.verified,
          pickup: searchParams.pickup,
          rating: searchParams.rating,
          max: searchParams.max,
          sort: searchParams.sort,
        }}
      />

      {/* category chips */}
      <div className="nm-scroll -mx-4 flex gap-2 overflow-x-auto px-4">
        <Link href={qs({ category: "" })} className={cn("nm-chip", activeCat === "all" && "nm-chip-active")}>All</Link>
        {cats.map((c: { id: string; slug: string; name: string; icon: string }) => (
          <Link key={c.id} href={qs({ category: c.slug })} className={cn("nm-chip", activeCat === c.slug && "nm-chip-active")}>
            <span>{c.icon}</span> {c.name}
          </Link>
        ))}
      </div>

      {/* filters */}
      <div className="nm-scroll -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1">
        <span className="text-[12px] font-semibold text-ink-400">Filter</span>
        <Link href={qs({ verified: searchParams.verified === "1" ? "" : "1" })} className={cn("nm-chip", searchParams.verified === "1" && "nm-chip-active")}>
          ✓ Verified only
        </Link>
        <Link href={qs({ pickup: searchParams.pickup === "1" ? "" : "1" })} className={cn("nm-chip", searchParams.pickup === "1" && "nm-chip-active")}>
          Pickup available
        </Link>
        <Link href={qs({ rating: searchParams.rating === "4" ? "" : "4" })} className={cn("nm-chip", searchParams.rating === "4" && "nm-chip-active")}>
          ★ 4.0+
        </Link>
        <Link href={qs({ max: searchParams.max === "10000" ? "" : "10000" })} className={cn("nm-chip", searchParams.max === "10000" && "nm-chip-active")}>
          Under ₦10,000
        </Link>
        <Link href={qs({ type: searchParams.type === "service" ? "" : "service" })} className={cn("nm-chip", searchParams.type === "service" && "nm-chip-active")}>
          Services
        </Link>
        <Link href={qs({ type: searchParams.type === "product" ? "" : "product" })} className={cn("nm-chip", searchParams.type === "product" && "nm-chip-active")}>
          Goods
        </Link>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
        <p className="text-[13px] font-semibold text-ink-700">
          {results.length} {results.length === 1 ? "item" : "items"} in {browsingAll ? "all cities" : city}
          {searchParams.q && <span className="font-normal text-ink-400"> for “{searchParams.q}”</span>}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="hidden text-[12px] text-ink-400 sm:inline">Sort</span>
          <Link href={qs({ sort: "" })} className={cn("nm-chip !py-1", !searchParams.sort && "nm-chip-active")}>Newest</Link>
          <Link href={qs({ sort: "price_asc" })} className={cn("nm-chip !py-1", searchParams.sort === "price_asc" && "nm-chip-active")}>₦ ↑</Link>
          <Link href={qs({ sort: "price_desc" })} className={cn("nm-chip !py-1", searchParams.sort === "price_desc" && "nm-chip-active")}>₦ ↓</Link>
        </div>
      </div>

      {results.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="Nothing matched that search"
          body={
            browsingAll
              ? "We couldn't find live listings with those filters. Try widening the price range or clearing a filter."
              : `We couldn't find live listings in ${city} with those filters. Try another city, browse all cities, or clear a filter.`
          }
          action={browsingAll ? "Clear all filters" : "Browse all cities"}
          href={browsingAll ? "/search" : `/search?city=${ALL_CITIES}`}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((l) => (
            <ListingCard key={l.id} l={l} saved={saved.has(l.id)} signedIn={!!session} />
          ))}
        </div>
      )}
    </div>
  );
}
