import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { getListing, getShopReviews, getShopListings, getGigPackages, getGigReviews, getReviewableGigOrder } from "@/lib/queries";
import { naira, cn, discountPercent } from "@/lib/utils";
import { Star, VerifiedBadge, Avatar, Badge, Alert } from "@/components/ui";
import { AddToCartBar } from "@/components/add-to-cart-bar";
import { ChatWithSeller } from "@/components/chat-with-seller";
import { ListingCard } from "@/components/cards";
import { QuoteForm } from "@/components/quote-form";
import { GigPackages } from "@/components/gig-packages";
import { GigReviewForm } from "@/components/gig-review-form";
import { Gallery } from "@/components/gallery";
import { WishlistButton } from "@/components/wishlist-button";
import { getWishlistIds } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ListingPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  const l = await getListing(params.id);
  if (!l) notFound();

  const shop = l.shops!;
  const isService = l.type === "service";

  const [reviews, more, savedIds, packages, gigReviews, reviewableOrder] = await Promise.all([
    getShopReviews(shop.id, 4),
    getShopListings(shop.id),
    session ? getWishlistIds(session.user.id) : Promise.resolve([] as string[]),
    // A gig's own tiers and its own reviews (sql/0021). A product gets
    // empty arrays and renders exactly as before.
    isService ? getGigPackages(l.id) : Promise.resolve([]),
    isService ? getGigReviews(l.id, 6) : Promise.resolve([]),
    isService && session ? getReviewableGigOrder(session.user.id, l.id) : Promise.resolve(null),
  ]);
  const saved = savedIds.includes(l.id);
  const inStock = l.stock > 0 || isService;

  // A gig is judged on its own stars; fall back to the shop's when it has
  // no reviews yet, which is still a real signal.
  const gigRatingCount = Number(l.rating_count ?? 0);
  const gigRating = gigRatingCount > 0 ? Number(l.rating_avg) : Number(shop.rating_avg);
  const gigRatingTotal = gigRatingCount > 0 ? gigRatingCount : Number(shop.rating_count);
  const alreadyReviewed = gigReviews.some((r: any) => r.buyer_id === session?.user.id);

  const breakdown = [5, 4, 3, 2, 1].map((r) => ({
    r,
    n: reviews.filter((x: { rating: number }) => x.rating === r).length,
  }));
  const totalReviews = reviews.length || 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      {/* left column */}
      <div className="space-y-4">
        <Gallery images={l.images ?? []} title={l.title} />

        <div className="lg:hidden">
          <PriceBlock l={l} shop={shop} />
        </div>

        <div className="nm-card p-4">
          <h2 className="text-[14px] font-bold text-ink-900">Description</h2>
          <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-600">
            {l.description || "The seller hasn't added a description for this listing yet."}
          </p>
          {isService && (
            <div className="mt-3 flex flex-wrap gap-2">
              {l.service_mode === "online" ? (
                <Badge tone="green">🌐 Online — works anywhere in Nigeria</Badge>
              ) : (
                <Badge tone="blue">🏠 Home visit</Badge>
              )}
              {l.service_area && <Badge tone="blue">Area: {l.service_area}</Badge>}
              {l.needs_home_visit && <Badge tone="violet">Provider travels</Badge>}
              {l.delivery_days != null && <Badge tone="gray">{l.delivery_days}-day delivery</Badge>}
              <Badge tone="gray">Quote first</Badge>
            </div>
          )}
        </div>

        {/* delivery block */}
        {!isService && (
          <div className="nm-card p-4">
            <h2 className="text-[14px] font-bold text-ink-900">Delivery &amp; pickup</h2>
            <div className="mt-2 space-y-1.5 text-[13px] text-ink-600">
              <p className="flex items-start gap-2">
                <span className="mt-0.5 text-brand-600">🚚</span>
                Delivery: <strong className="text-ink-900">{naira(l.delivery_fee_override ?? shop.delivery_fee)}</strong>
                {shop.free_delivery_threshold ? (
                  <> · Free above {naira(shop.free_delivery_threshold)}</>
                ) : null}
              </p>
              {shop.pickup_available && (
                <p className="flex items-start gap-2">
                  <span className="mt-0.5 text-brand-600">🏬</span>
                  Pickup available in {shop.city} — free
                </p>
              )}
            </div>
            <div className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-[12px] leading-relaxed text-brand-900">
              Your payment stays with NaijaMart until you confirm you got the item. If it never arrives, you get your money back.
            </div>
          </div>
        )}

        {/* Gig reviews — the gig's OWN stars (sql/0021), not the shop's.
            A shop with one great gig and one poor one must not show the
            same rating on both. */}
        {isService && (
          <div className="nm-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-bold text-ink-900">Reviews for this gig</h2>
              {gigRatingTotal > 0 && (
                <span className="text-[12px] text-ink-400">
                  {gigRatingTotal} {gigRatingTotal === 1 ? "review" : "reviews"}
                </span>
              )}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <p className="text-[26px] font-extrabold leading-none text-ink-900">
                {gigRating > 0 ? gigRating.toFixed(1) : "New"}
              </p>
              <Star value={gigRating} count={gigRatingTotal} />
            </div>

            <div className="mt-3 divide-y divide-[var(--line)]">
              {gigReviews.length === 0 && (
                <p className="py-3 text-[13px] text-ink-500">
                  No reviews for this gig yet. Buyers can review it once the work is delivered.
                </p>
              )}
              {gigReviews.map((r: any) => (
                <div key={r.id} className="py-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={r.profiles_public?.full_name} src={r.profiles_public?.avatar_url} size={28} />
                    <p className="text-[12.5px] font-semibold text-ink-900">
                      {r.profiles_public?.full_name ?? "Buyer"}
                    </p>
                    <Star value={r.rating} className="ml-auto" />
                  </div>
                  {r.body && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-600">{r.body}</p>}
                  {r.seller_reply && (
                    <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-ink-600">
                      <span className="font-semibold text-ink-800">Provider replied: </span>{r.seller_reply}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* The form only appears for a buyer who actually received this
                gig and has not reviewed it yet. */}
            {reviewableOrder && !alreadyReviewed && (
              <div className="mt-3">
                <GigReviewForm
                  orderId={reviewableOrder.id}
                  listingId={l.id}
                  gigTitle={l.title}
                />
              </div>
            )}
          </div>
        )}

        {/* reviews */}
        <div className="nm-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-ink-900">
              {isService ? `Reviews for ${shop.name}` : "Reviews"}
            </h2>
            <Link href={`/shop/${shop.slug}#reviews`} className="text-[12.5px] font-semibold text-brand-600">See all →</Link>
          </div>
          <div className="mt-2.5 flex items-center gap-4">
            <div className="text-center">
              <p className="text-[30px] font-extrabold leading-none text-ink-900">
                {Number(shop.rating_avg).toFixed(1)}
              </p>
              <Star value={Number(shop.rating_avg)} count={shop.rating_count} className="mt-1 justify-center" />
            </div>
            <div className="flex-1 space-y-1">
              {breakdown.map((b) => (
                <div key={b.r} className="flex items-center gap-2">
                  <span className="w-3 text-[11px] text-ink-400">{b.r}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${(b.n / totalReviews) * 100}%` }} />
                  </div>
                  <span className="w-5 text-right text-[10.5px] text-ink-400">{b.n}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 divide-y divide-[var(--line)]">
            {reviews.length === 0 && (
              <p className="py-3 text-[13px] text-ink-500">
                No reviews yet. Be the first to buy from {shop.name} and tell others how it went.
              </p>
            )}
            {reviews.map((r: any) => (
              <div key={r.id} className="py-3">
                <div className="flex items-center gap-2">
                  <Avatar name={r.profiles_public?.full_name} src={r.profiles_public?.avatar_url} size={28} />
                  <p className="text-[12.5px] font-semibold text-ink-900">{r.profiles_public?.full_name ?? "Buyer"}</p>
                  <Star value={r.rating} className="ml-auto" />
                </div>
                {r.body && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-600">{r.body}</p>}
                {r.seller_reply && (
                  <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-ink-600">
                    <span className="font-semibold text-ink-800">Seller replied: </span>{r.seller_reply}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* right column */}
      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className="hidden lg:block">
          <PriceBlock l={l} shop={shop} />
        </div>

        {/* wishlist — sits above the buy box so it is reachable on both
            breakpoints without duplicating it into the sticky bar */}
        <WishlistButton listingId={l.id} saved={saved} signedIn={!!session} variant="inline" />

        {/* shop card */}
        <div className="nm-card p-4">
          <div className="flex items-center gap-3">
            {shop.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shop.logo_url} alt={shop.name} className="h-12 w-12 rounded-xl object-cover" />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-500 text-[15px] font-bold text-white">
                {shop.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <Link href={`/shop/${shop.slug}`} className="block truncate text-[14px] font-bold text-ink-900 hover:text-brand-600">
                {shop.name}
              </Link>
              <div className="mt-0.5 flex items-center gap-2">
                <Star value={Number(shop.rating_avg)} count={shop.rating_count} />
                {shop.verified && <VerifiedBadge />}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-ink-500">{shop.city}, {shop.state}</p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <ChatWithSeller shopId={shop.id} signedIn={!!session} />
            <Link href={`/shop/${shop.slug}`} className="nm-btn-ghost w-full">Visit shop</Link>
          </div>
        </div>

        {/* buy box / quote box */}
        {isService ? (
          <GigPackages
            listingId={l.id}
            title={l.title}
            image={l.images?.[0] ?? null}
            packages={packages}
            shop={{
              id: shop.id,
              slug: shop.slug,
              name: shop.name,
              logo_url: shop.logo_url,
              city: shop.city,
              state: shop.state,
            }}
            signedIn={!!session}
            canOrderInCity={
              // An online gig has no coverage area, so a buyer in another
              // city must still be able to book it (sql/0019).
              l.service_mode === "online" ||
              !session?.profile.city || !shop.city || session.profile.city.toLowerCase() === shop.city.toLowerCase()
            }
          />
        ) : inStock ? (
          <div className="hidden lg:block">
            <AddToCartBar
              listing={{ id: l.id, title: l.title, price: Number(l.price), original_price: l.original_price, images: l.images ?? [], type: l.type }}
              shop={{
                id: shop.id, slug: shop.slug, name: shop.name, logo_url: shop.logo_url,
                city: shop.city, state: shop.state, delivery_fee: Number(shop.delivery_fee),
                free_delivery_threshold: shop.free_delivery_threshold ? Number(shop.free_delivery_threshold) : null,
                pickup_available: shop.pickup_available,
              }}
              signedIn={!!session}
            />
          </div>
        ) : (
          <Alert tone="amber" title="Out of stock">This item is sold out. Chat with the seller to ask when it will be back.</Alert>
        )}

        <div className="hidden">
          {more.slice(0, 0).map((m) => <ListingCard key={m.id} l={m} />)}
        </div>
      </div>

      {/* mobile buy bar */}
      {!isService && inStock && (
        <div className="lg:hidden">
          <AddToCartBar
            listing={{ id: l.id, title: l.title, price: Number(l.price), original_price: l.original_price, images: l.images ?? [], type: l.type }}
            shop={{
              id: shop.id, slug: shop.slug, name: shop.name, logo_url: shop.logo_url,
              city: shop.city, state: shop.state, delivery_fee: Number(shop.delivery_fee),
              free_delivery_threshold: shop.free_delivery_threshold ? Number(shop.free_delivery_threshold) : null,
              pickup_available: shop.pickup_available,
            }}
            signedIn={!!session}
          />
        </div>
      )}

      {more.filter((m) => m.id !== l.id).length > 0 && (
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-[16px] font-bold text-ink-900">More from {shop.name}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {more.filter((m) => m.id !== l.id).slice(0, 4).map((m) => <ListingCard key={m.id} l={m} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function PriceBlock({ l, shop }: { l: any; shop: any }) {
  const pct = discountPercent(Number(l.price), l.original_price);
  const isService = l.type === "service";
  return (
    <div className="nm-card p-4">
      {/* Provider first on a gig, as on the gig card: the face behind the
          work is the thing a buyer is judging, so it leads. */}
      {isService && (
        <div className="mb-3 flex items-center gap-2.5 border-b border-[var(--line)] pb-3">
          {shop.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shop.logo_url} alt={shop.name} className="h-10 w-10 rounded-full border-2 border-white object-cover shadow-sm" />
          ) : (
            <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-500 text-[13px] font-bold text-white">
              {shop.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <Link href={`/shop/${shop.slug}`} className="block truncate text-[13.5px] font-bold text-ink-900 hover:text-brand-600">
              {shop.name}
            </Link>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Star value={Number(shop.rating_avg)} count={shop.rating_count} />
              {shop.verified && <VerifiedBadge />}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <h1 className="text-[19px] font-extrabold leading-snug tracking-tight text-ink-900">{l.title}</h1>
        <Badge tone={isService ? "blue" : "gray"}>{isService ? "Service" : "Product"}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <p className="text-[26px] font-extrabold tracking-tight text-ink-900">
          {naira(l.price)}
          {isService && <span className="ml-1.5 text-[12px] font-medium text-ink-400">starting price</span>}
        </p>
        {pct > 0 && l.original_price != null && (
          <>
            <span className="text-[14px] font-medium text-ink-400 line-through">{naira(l.original_price)}</span>
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11.5px] font-bold text-white">
              {Number.isInteger(pct) ? pct : pct.toFixed(1)}% off
            </span>
          </>
        )}
      </div>
      {pct > 0 && l.original_price != null && (
        <p className="mt-1 text-[12px] font-semibold text-brand-700">
          You save {naira(Number(l.original_price) - Number(l.price))}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
        {!isService ? (
          l.stock > 0 ? (
            <span className="font-semibold text-brand-700">{l.stock} in stock</span>
          ) : (
            <span className="font-semibold text-red-600">Out of stock</span>
          )
        ) : (
          <span className="font-semibold text-brand-700">Accepting new jobs</span>
        )}
        <span className="text-ink-300">•</span>
        {/* An online gig has no coverage area, so its location is not a
            constraint on the buyer — say "works anywhere" instead of
            printing a city that would wrongly imply a boundary. */}
        {isService && l.service_mode === "online" ? (
          <span className="text-ink-500">🌐 Works anywhere in Nigeria</span>
        ) : (
          <span className="text-ink-500">{shop.city}, {shop.state}</span>
        )}
        {shop.verified && <><span className="text-ink-300">•</span><VerifiedBadge /></>}
      </div>
    </div>
  );
}
