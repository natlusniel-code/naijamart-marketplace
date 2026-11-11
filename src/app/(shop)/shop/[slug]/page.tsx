import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { getShopBySlug, getShopListings, getShopReviews, getWishlistIds } from "@/lib/queries";
import { naira, shortDate } from "@/lib/utils";
import { Star, VerifiedBadge, Badge, Avatar, EmptyState } from "@/components/ui";
import { ListingCard } from "@/components/cards";
import { ChatWithSeller } from "@/components/chat-with-seller";
import { FollowButton } from "@/components/follow-button";
import { ShopSignInPrompt } from "@/components/shop-signin-prompt";

export const dynamic = "force-dynamic";

export default async function ShopPage({ params }: { params: { slug: string } }) {
  const session = await getSession();
  const shop = await getShopBySlug(params.slug);
  if (!shop) notFound();

  // pending/suspended shops are only visible to their owner and admins
  const isOwner = session?.shop?.id === shop.id;
  if (shop.status !== "approved" && !isOwner && !session?.isAdmin) notFound();

  const [listings, reviews, savedIds] = await Promise.all([
    getShopListings(shop.id),
    getShopReviews(shop.id, 8),
    session ? getWishlistIds(session.user.id) : Promise.resolve([] as string[]),
  ]);
  const saved = new Set(savedIds);

  const supabase = createClient();
  const { count: followers } = await supabase
    .from("shop_followers")
    .select("shop_id", { count: "exact", head: true })
    .eq("shop_id", shop.id);
  let following = false;
  if (session) {
    const { data } = await supabase
      .from("shop_followers")
      .select("shop_id")
      .eq("shop_id", shop.id)
      .eq("user_id", session.user.id)
      .maybeSingle();
    following = !!data;
  }

  const goods = listings.filter((l) => l.type === "product");
  const services = listings.filter((l) => l.type === "service");

  return (
    <div className="-mx-4 md:mx-0">
      {/* banner */}
      <div className="relative h-40 w-full overflow-hidden bg-brand-100 md:h-52 md:rounded-2xl">
        {shop.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shop.banner_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-brand-500 via-brand-600 to-brand-700" />
        )}
        {shop.status !== "approved" && (
          <div className="absolute left-3 top-3">
            <Badge tone={shop.status === "pending" ? "amber" : "red"}>
              {shop.status === "pending" ? "Awaiting approval — not public yet" : `Shop ${shop.status}`}
            </Badge>
          </div>
        )}
      </div>

      {/* identity */}
      <div className="-mt-9 px-4 md:-mt-10 md:px-4">
        <div className="flex items-end gap-3">
          {shop.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shop.logo_url} alt={shop.name} className="h-20 w-20 rounded-2xl border-4 border-white object-cover shadow-card" />
          ) : (
            <span className="grid h-20 w-20 place-items-center rounded-2xl border-4 border-white bg-brand-500 text-[24px] font-extrabold text-white shadow-card">
              {shop.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="text-[19px] font-extrabold tracking-tight text-ink-900">{shop.name}</h1>
              {shop.verified && <VerifiedBadge />}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-500">
              <Star value={Number(shop.rating_avg)} count={shop.rating_count} />
              <span>·</span>
              <span>{shop.city}, {shop.state}</span>
              <span>·</span>
              <span>{followers ?? 0} followers</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1">
            <ChatWithSeller shopId={shop.id} signedIn={!!session} label="Chat" className="nm-btn-ghost w-full !py-2.5" />
          </div>
          <FollowButton shopId={shop.id} following={following} signedIn={!!session} />
        </div>

        {shop.description && (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-600">{shop.description}</p>
        )}

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {shop.kind !== "services" && <Badge tone="gray">Goods</Badge>}
          {shop.kind !== "goods" && <Badge tone="blue">Services</Badge>}
          {shop.category && <Badge tone="gray">{shop.category}</Badge>}
          {shop.pickup_available && <Badge tone="green">Pickup available</Badge>}
          <Badge tone="green">Escrow protected</Badge>
        </div>
      </div>

      {/* portfolio */}
      <div className="mt-6 px-4 md:px-4">
        {listings.length === 0 ? (
          <EmptyState
            icon="🪟"
            title="This shop is still setting up"
            body={`${shop.name} hasn't published anything yet. Follow the shop or chat to ask what's coming.`}
            action="Browse other sellers"
            href="/"
          />
        ) : (
          <div className="space-y-6">
            {services.length > 0 && (
              <section>
                <h2 className="mb-2.5 text-[15.5px] font-bold text-ink-900">Services</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {services.map((l) => (
                    <Link key={l.id} href={`/listing/${l.id}`}
                      className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-white p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                        {l.images?.[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.images[0]} alt="" className="h-full w-full object-cover" />
                        ) : <div className="grid h-full place-items-center text-xl">🛠️</div>}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-ink-900">{l.title}</p>
                        <p className="text-[12px] font-bold text-brand-700">from {naira(l.price)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {goods.length > 0 && (
              <section>
                <h2 className="mb-2.5 text-[15.5px] font-bold text-ink-900">Goods</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {goods.map((l) => (
                    <ListingCard key={l.id} l={l} saved={saved.has(l.id)} signedIn={!!session} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* reviews */}
      <section id="reviews" className="mt-8 px-4 md:px-4">
        <h2 className="mb-2.5 text-[15.5px] font-bold text-ink-900">Reviews {shop.rating_count > 0 && `(${shop.rating_count})`}</h2>
        {reviews.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--line)] bg-white/60 px-4 py-6 text-center text-[13px] text-ink-500">
            No reviews yet — this shop is new.
          </p>
        ) : (
          <div className="space-y-2.5">
            {reviews.map((r: any) => (
              <div key={r.id} className="nm-card p-3.5">
                <div className="flex items-center gap-2">
                  <Avatar name={r.profiles_public?.full_name} src={r.profiles_public?.avatar_url} size={28} />
                  <p className="text-[12.5px] font-semibold text-ink-900">{r.profiles_public?.full_name ?? "Buyer"}</p>
                  <Star value={r.rating} className="ml-auto" />
                </div>
                {r.body && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-600">{r.body}</p>}
                <p className="mt-1 text-[11px] text-ink-400">{shortDate(r.created_at)}</p>
                {r.seller_reply && (
                  <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-ink-600">
                    <span className="font-semibold text-ink-800">Seller replied: </span>{r.seller_reply}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {!session && <ShopSignInPrompt />}
    </div>
  );
}
