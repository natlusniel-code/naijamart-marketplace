import Link from "next/link";
import { getSession } from "@/lib/supabase/server";
import {
  getCategories,
  getNearbyShops,
  getStorefrontFeed,
  getPlaces,
  resolveCity,
  getWishlistIds,
  ALL_CITIES,
} from "@/lib/queries";
import { ListingCard, ShopCard } from "@/components/cards";
import { GigCard } from "@/components/gig-card";
import { ListingTabs } from "@/components/listing-tabs";
import { LocationFilter } from "@/components/location-filter";
import { RecommendationRail } from "@/components/recommendation-rail";
import { SectionHead, EmptyState, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = { city?: string; tab?: string };

export default async function HomePage({ searchParams }: { searchParams: SP }) {
  const session = await getSession();
  const myCity = session?.profile.city ?? null;
  const myState = session?.profile.state ?? null;

  // The storefront is open by default: products and services load straight
  // away with no city/state gate. A buyer can still narrow the feed with
  // ?city=…, but nothing is hidden until they pick a location.
  const city = resolveCity(searchParams.city, null);
  const browsingAll = city === null;

  // Which tab of the listing section is showing. The blueprint draws the
  // product listing and the service listing as two tabs of one section, so
  // the default is products and `?tab=service` switches to gigs.
  const tab: "product" | "service" = searchParams.tab === "service" ? "service" : "product";

  const [categories, places, shops, products, services, savedIds] = await Promise.all([
    getCategories(),
    getPlaces(),
    getNearbyShops(city, 6),
    // Ranked + rotated daily by storefront_feed (sql/0015): a balanced mix of
    // new, well-rated, best-selling and most-viewed listings rather than
    // "the newest 8", which let the same listings own page one forever.
    getStorefrontFeed(city, "product", 8),
    getStorefrontFeed(city, "service", 6),
    session ? getWishlistIds(session.user.id) : Promise.resolve([] as string[]),
  ]);
  const saved = new Set(savedIds);

  const nothingHere = shops.length === 0 && products.length === 0 && services.length === 0;
  const where = browsingAll ? "all cities" : city;

  return (
    <div className="space-y-7">
      {/* greeting + search */}
      <section>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12.5px] font-medium text-ink-400">
              {session ? `Hello ${session.profile.full_name.split(" ")[0]}` : "Welcome to NaijaMart"}
            </p>
            <h1 className="mt-0.5 text-[22px] font-extrabold tracking-tight text-ink-900">
              What do you need today?
            </h1>
          </div>
          <Badge tone="green" dot className="mt-1 shrink-0">Escrow protected</Badge>
        </div>

        <Link href="/profile/location" className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink-700 sm:hidden">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
          {browsingAll ? "All cities" : `${city}${myState ? `, ${myState}` : ""}`}
          <span className="text-ink-400">▾</span>
        </Link>

        <form action="/search" className="mt-3 flex gap-2">
          {city && <input type="hidden" name="city" value={city} />}
          <div className="relative flex-1">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input
              name="q"
              placeholder="Search goods, services, shops…"
              className="nm-input !py-3 pl-10"
              aria-label="Search"
            />
          </div>
          <button className="nm-btn-primary !px-4" type="submit" aria-label="Search">Go</button>
        </form>

        {/* location filter — defaults to the buyer's city, "All cities" widens it */}
        <LocationFilter
          places={places}
          activeCity={city}
          myCity={myCity}
          basePath="/"
          className="mt-3"
        />
      </section>

      {/* categories */}
      {categories.length > 0 && (
        <section>
          <div className="nm-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {categories.map((c: { id: string; name: string; slug: string; icon: string }) => (
              <Link
                key={c.id}
                href={`/search?category=${c.slug}${city ? `&city=${encodeURIComponent(city)}` : `&city=${ALL_CITIES}`}`}
                className="flex w-[84px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-[var(--line)] bg-white px-2 py-3 text-center shadow-card transition hover:border-brand-300 hover:bg-brand-50/40"
              >
                <span className="text-[22px] leading-none">{c.icon}</span>
                <span className="text-[11px] font-semibold leading-tight text-ink-700">{c.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {nothingHere && (
        <EmptyState
          icon="🏪"
          title={browsingAll ? "No sellers yet" : `No sellers in ${city} yet`}
          body={
            browsingAll
              ? "We're onboarding verified shops. Check back soon, or become the first seller here."
              : "We're onboarding verified shops in your area. Try another city, or browse the whole marketplace."
          }
          action={browsingAll ? "Change your city" : "Browse all cities"}
          href={browsingAll ? "/profile/location" : `/?city=${ALL_CITIES}`}
        />
      )}

      {/* verified sellers near you */}
      {shops.length > 0 && (
        <section>
          <SectionHead
            title={browsingAll ? "Verified sellers" : "Verified sellers near you"}
            sub={browsingAll ? "Across every city" : `Shops in ${city}`}
            action="See all"
            href={`/search?verified=1${city ? `&city=${encodeURIComponent(city)}` : `&city=${ALL_CITIES}`}`}
          />
          <div className="nm-scroll -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {shops.map((s) => <ShopCard key={s.id} s={s} />)}
          </div>
        </section>
      )}

      {/* ── Picked for you ───────────────────────────────────────────────
          The AI recommendation rail. Only rendered for a signed-in buyer:
          an anonymous visitor has no history, and the storefront feed
          already handles that case. It renders nothing at all when there
          is nothing to show, so a new buyer sees no empty shell. */}
      {session?.user.id && (
        <RecommendationRail buyerId={session.user.id} limit={6} />
      )}

      {/* The listing section, as drawn in the blueprint: "Product Listing"
          and "Service Gig" are two tabs of ONE section, with "See more"
          leading to the full sub page. `?tab=service` switches which one is
          shown; both are fetched so the tab counts are honest. */}
      {(products.length > 0 || services.length > 0) && (
        <section>
          <ListingTabs
            current={tab}
            productHref={`/${city ? `?city=${encodeURIComponent(city)}` : ""}`}
            serviceHref={`/?tab=service${city ? `&city=${encodeURIComponent(city)}` : ""}`}
            seeMoreHref={
              tab === "service"
                ? `/services${city ? `?city=${encodeURIComponent(city)}` : ""}`
                : `/search${city ? `?city=${encodeURIComponent(city)}` : `?city=${ALL_CITIES}`}`
            }
            seeMoreLabel={tab === "service" ? "All services" : "Browse all"}
          />

          {tab === "service" ? (
            services.length > 0 ? (
              /* Gigs are ONE per row on a phone, as the layout sketch
                 draws them: a full-width card with a big thumbnail reads as
                 "here is a piece of work someone will do for you", which is
                 the whole point of the format. Products stay two-up below. */
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {services.map((l) => (
                  <GigCard key={l.id} l={l} saved={saved.has(l.id)} signedIn={!!session} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="🛠️"
                title="No gigs here yet"
                body="Service providers are still signing up. Browse every city, or check back soon."
                action="Browse all cities"
                href={`/?tab=service&city=${ALL_CITIES}`}
              />
            )
          ) : products.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((l) => (
                <ListingCard key={l.id} l={l} saved={saved.has(l.id)} signedIn={!!session} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="📦"
              title="No products here yet"
              body="Nothing listed in this city right now. Try another city, or browse the whole marketplace."
              action="Browse all cities"
              href={`/?city=${ALL_CITIES}`}
            />
          )}
        </section>
      )}

      {/* trust strip */}
      <section className="rounded-2xl border border-brand-500/15 bg-brand-50/60 p-4">
        <p className="text-[13.5px] font-bold text-brand-900">How NaijaMart protects you</p>
        <ol className="mt-2.5 grid gap-2.5 text-[12.5px] leading-relaxed text-brand-900/80 sm:grid-cols-3">
          <li className="flex gap-2"><span className="font-bold text-brand-600">1.</span> You transfer to NaijaMart&apos;s admin account, not the seller.</li>
          <li className="flex gap-2"><span className="font-bold text-brand-600">2.</span> We verify your receipt and tell the seller to start.</li>
          <li className="flex gap-2"><span className="font-bold text-brand-600">3.</span> Money is released only after you confirm delivery.</li>
        </ol>
      </section>
    </div>
  );
}
