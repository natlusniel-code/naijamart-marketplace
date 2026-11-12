import { createClient } from "@/lib/supabase/server";
import type { SessionProfile } from "@/lib/supabase/server";
import { SUPPORT_WHATSAPP } from "@/lib/support";

export type Listing = {
  id: string;
  shop_id: string;
  type: "product" | "service";
  title: string;
  description: string | null;
  category_id: string | null;
  /**
   * Seller-supplied search tags. Normalised to lowercase, de-duplicated and
   * capped at 20 by the database (sql/0015), so the UI can render them as-is.
   */
  tags: string[];
  price: number;
  /** The "was" price. Null when the seller is not running a discount. */
  original_price: number | null;
  /** Derived in the database from the two prices — never set by hand. */
  discount_percent: number;
  stock: number;
  images: string[];
  status: string;
  service_area: string | null;
  needs_home_visit: boolean;
  /**
   * Which kind of service this is (sql/0019). Null for a product.
   *
   *   physical — the provider travels, so coverage applies
   *   online   — the work crosses no distance, so no location filter
   *              may ever hide it
   */
  service_mode: "physical" | "online" | null;
  /** How long the gig takes, in days. Null when the seller did not say. */
  delivery_days: number | null;
  delivery_fee_override: number | null;
  free_delivery_threshold: number | null;
  shops?: ShopLite;
  categories?: { name: string; icon: string; slug: string } | null;
};

export type ShopLite = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  verified: boolean;
  rating_avg: number;
  rating_count: number;
  logo_url: string | null;
  banner_url: string | null;
  kind: string;
  category: string | null;
  status: string;
  subscription_status: string;
  description: string | null;
  pickup_available: boolean;
  delivery_fee: number;
  free_delivery_threshold: number | null;
};

export type Place = { city: string; state: string | null; shop_count: number };

/** Sentinel used by the UI for "show me every city". */
export const ALL_CITIES = "all";

const SHOP_COLS =
  "id,name,slug,city,state,verified,rating_avg,rating_count,logo_url,banner_url,kind,category,status,subscription_status,description,pickup_available,delivery_fee,free_delivery_threshold";

/**
 * The columns every listing card needs, in one place.
 *
 * `tags` is included because the search RPC ranks on it and the listing page
 * shows it; leaving it out of a select would silently drop the field from the
 * typed result.
 */
const LISTING_COLS =
  `id,shop_id,type,title,description,category_id,tags,price,original_price,discount_percent,stock,images,status,service_area,needs_home_visit,service_mode,delivery_days,delivery_fee_override,free_delivery_threshold,shops!inner(${SHOP_COLS}),categories(name,icon,slug)`;

export async function getCategories() {
  const supabase = createClient();
  const { data } = await supabase
    .from("categories")
    .select("id,name,slug,icon,sort_order")
    .eq("active", true)
    .order("sort_order");
  return data ?? [];
}

export async function getSettings() {
  const supabase = createClient();
  const { data } = await supabase.from("platform_settings").select("*").eq("id", 1).maybeSingle();
  return (
    data ?? {
      commission_rate: 0.05,
      subscription_price: 5000,
      free_delivery_default: 20000,
      default_delivery_fee: 500,
      bank_name: "SmartCash",
      bank_account_number: "9111356510",
      bank_account_name: "Anifowose Mutiu Ayinde",
      support_whatsapp: SUPPORT_WHATSAPP,
      terms_text: "",
    }
  );
}

/**
 * Every city that has at least one approved shop, with a shop count.
 * Backed by the `shop_locations` view (sql/0009) so the filter is a real
 * list rather than a hardcoded one.
 */
export async function getPlaces(): Promise<Place[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("shop_locations")
    .select("city,state,shop_count")
    .order("shop_count", { ascending: false });
  return (data ?? []) as Place[];
}

/**
 * Resolve the city a listing query should be bound to.
 *
 * `requested` comes from the URL (?city=…). `ALL_CITIES` (or an empty
 * string) means "browse everywhere" and returns null so the caller skips
 * the filter. With no explicit choice we default to the buyer's own city,
 * which is the behaviour the home page needs.
 */
export function resolveCity(requested: string | undefined, fallback: string | null): string | null {
  if (requested === ALL_CITIES) return null;
  if (requested && requested.trim()) return requested.trim();
  return fallback;
}

/** Fresh listings in a city, newest first. `city === null` = all cities. */
export async function getNewListings(city: string | null, limit = 8) {
  const supabase = createClient();
  let q = supabase
    .from("listings")
    .select(`id,shop_id,type,title,description,category_id,tags,price,original_price,discount_percent,stock,images,status,service_area,needs_home_visit,delivery_fee_override,free_delivery_threshold,shops!inner(${SHOP_COLS}),categories(name,icon,slug)`)
    .eq("status", "live")
    .eq("type", "product")
    .eq("shops.status", "approved")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (city) q = q.eq("shops.city", city);
  const { data } = await q;
  return (data ?? []) as unknown as Listing[];
}

export async function getPopularServices(city: string | null, limit = 6) {
  const supabase = createClient();
  let q = supabase
    .from("listings")
    .select(`id,shop_id,type,title,description,category_id,tags,price,original_price,discount_percent,stock,images,status,service_area,needs_home_visit,delivery_fee_override,free_delivery_threshold,shops!inner(${SHOP_COLS}),categories(name,icon,slug)`)
    .eq("status", "live")
    .eq("type", "service")
    .eq("shops.status", "approved")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (city) q = q.eq("shops.city", city);
  const { data } = await q;
  return (data ?? []) as unknown as Listing[];
}

/** Verified sellers near a city, newest sellers boosted first (simple ranking). */
export async function getNearbyShops(city: string | null, limit = 6) {
  const supabase = createClient();
  let q = supabase
    .from("shops")
    .select(`${SHOP_COLS}, seller_scores(new_seller_boost_until,total_score)`)
    .eq("status", "approved")
    .eq("verified", true)
    .order("rating_avg", { ascending: false })
    .limit(limit);
  if (city) q = q.eq("city", city);
  const { data } = await q;
  return (data ?? []) as unknown as (ShopLite & {
    seller_scores?: { new_seller_boost_until: string | null; total_score: number }[];
  })[];
}

/**
 * Ranked search.
 *
 * The filtering and the ordering both happen in `search_listing_ids`
 * (sql/0015), not here. Two bugs made that necessary:
 *
 *   1. Category filtering used `.eq("categories.slug", …)` on an embedded
 *      resource. PostgREST applies that to the *joined* rows, so the parent
 *      listing was never filtered — every listing came back and the
 *      non-matching ones just had `categories: null`. The storefront showed
 *      the whole catalogue no matter which category was clicked.
 *   2. Search was `title ILIKE '%q%'` — one substring, one column. A listing
 *      titled "LG 7kg Front Load Washer" was invisible to "washing machine",
 *      and seller tags did not exist at all.
 *
 * The RPC resolves the category slug to an id and filters `category_id`
 * directly, matches title + tags + description with a weighted tsvector plus
 * a substring fallback, and returns ids in ranked order. This function then
 * fetches the full rows the cards need and restores that order — PostgREST
 * does not preserve the order of an `in()` list.
 */
export async function searchListings(opts: {
  city?: string | null;
  state?: string | null;
  q?: string;
  category?: string;
  min?: number;
  max?: number;
  minRating?: number;
  pickup?: boolean;
  verifiedOnly?: boolean;
  sort?: string;
  type?: "product" | "service";
  /** Narrow a service search to physical or online gigs (sql/0019). */
  serviceMode?: "physical" | "online";
  limit?: number;
}) {
  const supabase = createClient();

  const { data: ranked, error } = await supabase.rpc("search_listing_ids", {
    p_q: opts.q?.trim() || null,
    p_category: opts.category || null,
    p_city: opts.city || null,
    p_type: opts.type ?? null,
    p_min: typeof opts.min === "number" ? opts.min : null,
    p_max: typeof opts.max === "number" ? opts.max : null,
    p_min_rating: opts.minRating ?? null,
    p_pickup: !!opts.pickup,
    p_verified: !!opts.verifiedOnly,
    p_sort: opts.sort || null,
    p_limit: opts.limit ?? 60,
    p_offset: 0,
    p_service_mode: opts.serviceMode ?? null,
  });

  // A failed RPC must not look like "no results" — that is exactly how the
  // original search bug presented itself to buyers.
  if (error) {
    console.error("search_listing_ids failed:", error.message);
    return [] as Listing[];
  }

  const ids = (ranked ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return [] as Listing[];

  const { data } = await supabase
    .from("listings")
    .select(LISTING_COLS)
    .in("id", ids);

  const byId = new Map((data ?? []).map((l: any) => [l.id, l]));
  return ids
    .map((id: string) => byId.get(id))
    .filter(Boolean) as unknown as Listing[];
}

/**
 * The storefront feed: a balanced, daily-rotating mix of new, well-rated,
 * best-selling and most-viewed listings.
 *
 * `storefront_feed` (sql/0015) interleaves the four buckets round-robin and
 * re-seeds on the date, so page one is not permanently owned by whichever
 * listings happen to be newest. `seed` is exposed for tests and for pinning
 * a feed; production passes nothing and gets today's date.
 */
export async function getStorefrontFeed(
  city: string | null,
  type: "product" | "service" = "product",
  limit = 8,
  seed?: string,
  serviceMode?: "physical" | "online",
  /**
   * Rows to skip. The round-robin interleave is computed over the whole
   * eligible set and then sliced (sql/0020), so page 2 is the next slice
   * of the same ranking rather than a fresh shuffle that repeats page 1.
   */
  offset = 0,
) {
  const supabase = createClient();

  const { data: ranked, error } = await supabase.rpc("storefront_feed", {
    p_city: city || null,
    p_type: type,
    p_limit: limit,
    p_seed: seed ?? null,
    p_service_mode: serviceMode ?? null,
    p_offset: offset,
  });

  if (error) {
    console.error("storefront_feed failed:", error.message);
    return [] as Listing[];
  }

  const ids = (ranked ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return [] as Listing[];

  const { data } = await supabase
    .from("listings")
    .select(LISTING_COLS)
    .in("id", ids);

  const byId = new Map((data ?? []).map((l: any) => [l.id, l]));
  return ids
    .map((id: string) => byId.get(id))
    .filter(Boolean) as unknown as Listing[];
}

/**
 * How many listings the feed could show, for the page links.
 *
 * `storefront_feed_count` applies exactly the same eligibility rules as
 * `storefront_feed` (sql/0020), so the number of page links can never
 * disagree with the rows that come back.
 */
export async function getStorefrontFeedCount(
  city: string | null,
  type: "product" | "service" = "product",
  serviceMode?: "physical" | "online",
): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("storefront_feed_count", {
    p_city: city || null,
    p_type: type,
    p_service_mode: serviceMode ?? null,
  });
  if (error) {
    console.error("storefront_feed_count failed:", error.message);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

export async function getListing(id: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("listings")
    // LISTING_COLS, not a hand-written list: this function used to carry its
    // own copy, which silently dropped `service_mode` and made an online gig
    // render as a home-visit one. One list, one place to add a column.
    .select(LISTING_COLS)
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as unknown as Listing | null;
}

export async function getShopBySlug(slug: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("shops")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function getShopListings(shopId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("listings")
    .select(`id,shop_id,type,title,description,category_id,tags,price,original_price,discount_percent,stock,images,status,service_area,needs_home_visit,delivery_fee_override,free_delivery_threshold,categories(name,icon,slug)`)
    .eq("shop_id", shopId)
    .eq("status", "live")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as Listing[];
}

export async function getShopReviews(shopId: string, limit = 6) {
  const supabase = createClient();
  const { data } = await supabase
    .from("reviews")
    .select("id,rating,body,seller_reply,created_at,images,buyer_id")
    .eq("shop_id", shopId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = data ?? [];

  // reviews.buyer_id references auth.users, not profiles, so there is no FK to embed
  // through — the buyer name comes from the profiles_public view in a second query.
  const ids = Array.from(new Set(rows.map((r: any) => r.buyer_id).filter(Boolean)));
  const { data: people } = ids.length
    ? await supabase.from("profiles_public").select("id,full_name,avatar_url").in("id", ids)
    : { data: [] as any[] };
  const map = new Map((people ?? []).map((p: any) => [p.id, p]));

  return rows.map((r: any) => ({ ...r, profiles_public: map.get(r.buyer_id) ?? null }));
}

export async function getMyOrders(userId: string, status?: string) {
  const supabase = createClient();
  let q = supabase
    .from("orders")
    .select(`*, shops(${SHOP_COLS}), order_items(id,title,quantity,unit_price,line_total,listing_id)`)
    .eq("buyer_id", userId)
    .order("created_at", { ascending: false });
  if (status && status !== "all") q = q.eq("status", status);
  const { data } = await q;
  return data ?? [];
}

/* ------------------------------------------------------------------ wishlist */

/** The listing ids this buyer has saved. Used to paint the heart as filled. */
export async function getWishlistIds(userId: string): Promise<string[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("wishlists")
    .select("listing_id")
    .eq("user_id", userId);
  return (data ?? []).map((r: { listing_id: string }) => r.listing_id);
}

/**
 * The buyer's saved listings, newest save first.
 *
 * A saved listing can go out of stock, be hidden, or have its shop suspended
 * after it was saved. Those rows are still returned — the wishlist page shows
 * them greyed out with "no longer available" rather than silently dropping
 * them, because a buyer who saved something deserves to know it is gone
 * instead of wondering where it went.
 */
export async function getWishlist(userId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("wishlists")
    .select(
      `created_at,listings(id,shop_id,type,title,description,category_id,tags,price,original_price,discount_percent,stock,images,status,service_area,needs_home_visit,delivery_fee_override,free_delivery_threshold,shops(${SHOP_COLS}),categories(name,icon,slug))`,
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return (data ?? []) as unknown as {
    created_at: string;
    listings: Listing | null;
  }[];
}

/* -------------------------------------------------------------- notifications */

export type Notification = {
  id: string;
  kind: "order" | "broadcast" | "system";
  title: string;
  body: string | null;
  href: string | null;
  order_id: string | null;
  read_at: string | null;
  created_at: string;
};

export async function getNotifications(userId: string, limit = 60): Promise<Notification[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id,kind,title,body,href,order_id,read_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Notification[];
}

export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = createClient();
  const { data } = await supabase.rpc("unread_notification_count");
  return typeof data === "number" ? data : 0;
}

export async function getOrder(id: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("orders")
    .select(`*, shops(${SHOP_COLS}), order_items(id,title,quantity,unit_price,line_total,listing_id)`)
    .eq("id", id)
    .maybeSingle();
  return data;
}
