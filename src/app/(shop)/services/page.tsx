import Link from "next/link";
import { getSession } from "@/lib/supabase/server";
import {
  getStorefrontFeed,
  getStorefrontFeedCount,
  getPlaces,
  resolveCity,
  getWishlistIds,
  ALL_CITIES,
} from "@/lib/queries";
import { GigCard } from "@/components/gig-card";
import { Pager } from "@/components/pager";
import { LocationFilter } from "@/components/location-filter";
import { EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Services & gigs" };

const PER_PAGE = 12;

type SP = { city?: string; page?: string; mode?: string };

/**
 * The service sub page — the blueprint's "Second Sub Page Service Gig".
 *
 * A full page of gigs, ranked by the same `storefront_feed` as the
 * product listing (new within 3 days, well rated, best selling, popular,
 * jittered by the daily seed so it rotates), with numbered page links.
 *
 * Online gigs are never hidden by the city filter: the work crosses no
 * distance, so a Lagos designer is bookable from Kano. That rule lives in
 * the database function, not here, so search and the storefront cannot
 * disagree about it.
 */
export default async function ServicesPage({ searchParams }: { searchParams: SP }) {
  const session = await getSession();
  const myCity = session?.profile.city ?? null;

  const city = resolveCity(searchParams.city, null);
  const browsingAll = city === null;
  const mode = searchParams.mode === "online" ? "online" : searchParams.mode === "physical" ? "physical" : undefined;

  const page = Math.max(1, Number(searchParams.page) || 1);
  const offset = (page - 1) * PER_PAGE;

  const [places, services, total, savedIds] = await Promise.all([
    getPlaces(),
    getStorefrontFeed(city, "service", PER_PAGE, undefined, mode, offset),
    getStorefrontFeedCount(city, "service", mode),
    session ? getWishlistIds(session.user.id) : Promise.resolve([] as string[]),
  ]);
  const saved = new Set(savedIds);
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { ...searchParams, ...patch };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) p.set(k, String(v));
    });
    const s = p.toString();
    return s ? `/services?${s}` : "/services";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Service Gig</h1>
          <p className="mt-0.5 text-[13px] text-ink-500">
            Book a pro — online gigs work anywhere in Nigeria
          </p>
        </div>
        <Link href="/" className="mt-1 shrink-0 text-[13px] font-semibold text-brand-600 hover:text-brand-700">
          ← Products
        </Link>
      </div>

      <LocationFilter
        places={places}
        activeCity={city}
        myCity={myCity}
        basePath="/services"
        params={{ mode: searchParams.mode }}
      />

      {/* service type — the two kinds of service the platform sells */}
      <div className="nm-scroll -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1">
        <span className="text-[12px] font-semibold text-ink-400">Type</span>
        <Link href={qs({ mode: "", page: "" })} className={cn("nm-chip", !mode && "nm-chip-active")}>
          All services
        </Link>
        <Link href={qs({ mode: "physical", page: "" })} className={cn("nm-chip", mode === "physical" && "nm-chip-active")}>
          🏠 Home visit
        </Link>
        <Link href={qs({ mode: "online", page: "" })} className={cn("nm-chip", mode === "online" && "nm-chip-active")}>
          🌐 Online
        </Link>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
        <p className="text-[13px] font-semibold text-ink-700">
          {total} {total === 1 ? "gig" : "gigs"} in {browsingAll ? "all cities" : city}
          {mode === "online" && <span className="font-normal text-ink-400"> · online only</span>}
          {mode === "physical" && <span className="font-normal text-ink-400"> · home visit only</span>}
        </p>
        {pageCount > 1 && (
          <p className="text-[12px] text-ink-400">
            Page {page} of {pageCount}
          </p>
        )}
      </div>

      {services.length === 0 ? (
        <EmptyState
          icon="🛠️"
          title={page > 1 ? "No more gigs on this page" : "No gigs here yet"}
          body={
            page > 1
              ? "You've reached the end of the list. Go back a page, or widen the filters."
              : browsingAll
                ? "Service providers are still signing up. Check back soon, or become the first provider here."
                : `No providers in ${city} yet. Online gigs are shown everywhere, so try another city or browse all.`
          }
          action={page > 1 ? "Back to page 1" : browsingAll ? "Change your city" : "Browse all cities"}
          href={page > 1 ? qs({ page: "" }) : browsingAll ? "/profile/location" : `/services?city=${ALL_CITIES}`}
        />
      ) : (
        <>
          {/* One gig per row on a phone, matching the layout sketch. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((l) => (
              <GigCard key={l.id} l={l} saved={saved.has(l.id)} signedIn={!!session} />
            ))}
          </div>

          <Pager
            page={page}
            pageCount={pageCount}
            basePath="/services"
            params={{ city: searchParams.city, mode: searchParams.mode }}
            className="justify-center pt-2"
          />
        </>
      )}
    </div>
  );
}
