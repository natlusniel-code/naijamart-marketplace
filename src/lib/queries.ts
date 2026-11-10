import { createClient } from "@/lib/supabase/server";
import type { SessionProfile } from "@/lib/supabase/server";

export type Listing = {
  id: string;
  shop_id: string;
  type: "product" | "service";
  title: string;
  description: string | null;
  category_id: string | null;
  price: number;
  stock: number;
  images: string[];
  status: string;
  service_area: string | null;
  needs_home_visit: boolean;
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

const SHOP_COLS =
  "id,name,slug,city,state,verified,rating_avg,rating_count,logo_url,banner_url,kind,category,status,subscription_status,description,pickup_available,delivery_fee,free_delivery_threshold";

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
      support_whatsapp: "2348012345678",
      terms_text: "",
    }
  );
}

/** Fresh listings in a city, newest first. */
export async function getNewListings(city: string | null, limit = 8) {
  const supabase = createClient();
  let q = supabase
    .from("listings")
    .select(`id,shop_id,type,title,description,category_id,price,stock,images,status,service_area,needs_home_visit,delivery_fee_override,free_delivery_threshold,shops!inner(${SHOP_COLS}),categories(name,icon,slug)`)
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
    .select(`id,shop_id,type,title,description,category_id,price,stock,images,status,service_area,needs_home_visit,delivery_fee_override,free_delivery_threshold,shops!inner(${SHOP_COLS}),categories(name,icon,slug)`)
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

export async function searchListings(opts: {
  city?: string | null;
  q?: string;
  category?: string;
  min?: number;
  max?: number;
  minRating?: number;
  pickup?: boolean;
  verifiedOnly?: boolean;
  sort?: string;
  type?: "product" | "service";
}) {
  const supabase = createClient();
  let query = supabase
    .from("listings")
    .select(`id,shop_id,type,title,description,category_id,price,stock,images,status,service_area,needs_home_visit,delivery_fee_override,free_delivery_threshold,shops!inner(${SHOP_COLS}),categories(name,icon,slug)`)
    .eq("status", "live")
    .eq("shops.status", "approved");

  if (opts.type) query = query.eq("type", opts.type);
  if (opts.city) query = query.eq("shops.city", opts.city);
  if (opts.q) query = query.ilike("title", `%${opts.q}%`);
  if (opts.category) query = query.eq("categories.slug", opts.category);
  if (typeof opts.min === "number") query = query.gte("price", opts.min);
  if (typeof opts.max === "number") query = query.lte("price", opts.max);
  if (opts.minRating) query = query.gte("shops.rating_avg", opts.minRating);
  if (opts.pickup) query = query.eq("shops.pickup_available", true);
  if (opts.verifiedOnly) query = query.eq("shops.verified", true);

  switch (opts.sort) {
    case "price_asc": query = query.order("price", { ascending: true }); break;
    case "price_desc": query = query.order("price", { ascending: false }); break;
    default: query = query.order("created_at", { ascending: false });
  }

  const { data } = await query.limit(60);
  return (data ?? []) as unknown as Listing[];
}

export async function getListing(id: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("listings")
    .select(`id,shop_id,type,title,description,category_id,price,stock,images,status,service_area,needs_home_visit,delivery_fee_override,free_delivery_threshold,shops!inner(${SHOP_COLS}),categories(name,icon,slug)`)
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
    .select(`id,shop_id,type,title,description,category_id,price,stock,images,status,service_area,needs_home_visit,delivery_fee_override,free_delivery_threshold,categories(name,icon,slug)`)
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

export async function getOrder(id: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("orders")
    .select(`*, shops(${SHOP_COLS}), order_items(id,title,quantity,unit_price,line_total,listing_id)`)
    .eq("id", id)
    .maybeSingle();
  return data;
}
