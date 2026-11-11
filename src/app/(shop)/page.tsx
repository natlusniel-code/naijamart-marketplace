import Link from "next/link";
import { getSession } from "@/lib/supabase/server";
import {
  getCategories,
  getNearbyShops,
  getNewListings,
  getPopularServices,
  getPlaces,
  resolveCity,
  ALL_CITIES,
} from "@/lib/queries";
import { ListingCard, ShopCard, placeLabel } from "@/components/cards";
import { LocationFilter } from "@/components/location-filter";
import { SectionHead, EmptyState, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = { city?: string };

export default async function HomePage({ searchParams }: { searchParams: SP }) {
  const session = await getSession();
  const myCity = session?.profile.city ?? null;
  const myState = session?.profile.state ?? null;

  // The storefront is open by default: products and services load straight
  // away with no city/state gate. A buyer can still narrow the feed with
  // ?city=…, but nothing is hidden until they pick a location.
  const city = resolveCity(searchParams.city, null);
  const browsingAll = city === null;

  const [categories, places, shops, products, services] = await Promise.all([
    getCategories(),
    getPlaces(),
    getNearbyShops(city, 6),
    getNewListings(city, 8),
    getPopularServices(city, 6),
  ]);

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

      {/* new in city */}
      {products.length > 0 && (
        <section>
          <SectionHead
            title={browsingAll ? "New on NaijaMart" : `New in ${city}`}
            sub={browsingAll ? "Every city, newest first" : undefined}
            action="Browse all"
            href={`/search${city ? `?city=${encodeURIComponent(city)}` : `?city=${ALL_CITIES}`}`}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((l) => <ListingCard key={l.id} l={l} />)}
          </div>
        </section>
      )}

      {/* popular services */}
      {services.length > 0 && (
        <section>
          <SectionHead
            title="Popular services"
            sub="Book a pro — pay only when you accept the quote"
            action="All services"
            href={`/search?type=service${city ? `&city=${encodeURIComponent(city)}` : `&city=${ALL_CITIES}`}`}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((l) => {
              const place = placeLabel(l.shops);
              return (
                <Link
                  key={l.id}
                  href={`/listing/${l.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-white p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift"
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                    {l.images?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-full place-items-center text-xl">🛠️</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-ink-900">{l.title}</p>
                    <p className="truncate text-[11.5px] text-ink-500">
                      {l.shops?.name}
                      {place ? ` · ${place}` : ""}
                    </p>
                    <p className="mt-0.5 text-[13px] font-bold text-brand-700">
                      From ₦{Number(l.price).toLocaleString()}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
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
