export type CartLine = { listingId: string; quantity: number };

export type CartShop = {
  shopId: string;
  shopSlug: string;
  shopName: string;
  shopLogo: string | null;
  city: string;
  /** Seller's state — the checkout distance rule compares it with the buyer's. */
  state: string;
  deliveryFee: number;
  freeThreshold: number | null;
  pickupAvailable: boolean;
  fulfilment: "delivery" | "pickup";
  lines: {
    listingId: string;
    title: string;
    price: number;
    /** The "was" price at the moment it was added, for the saving line. */
    originalPrice?: number | null;
    quantity: number;
    image: string | null;
    /**
     * Whether this line is a gig (sql/0019). A service is performed, not
     * shipped, so a basket of only services owes no delivery fee — and the
     * buyer must see that ₦0 before they pay, not discover it afterwards.
     * Optional so carts saved before this field existed still parse.
     */
    isService?: boolean;
  }[];
};

export type Cart = Record<string, CartShop>;

const KEY = "nm_cart_v1";

export function readCart(): Cart {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Cart) : {};
  } catch {
    return {};
  }
}

export function writeCart(cart: Cart) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(cart));
  window.dispatchEvent(new Event("nm:cart"));
}

export function addToCart(item: {
  shopId: string;
  shopSlug: string;
  shopName: string;
  shopLogo?: string | null;
  city?: string;
  state?: string;
  deliveryFee?: number;
  freeThreshold?: number | null;
  pickupAvailable?: boolean;
  listingId: string;
  title: string;
  price: number;
  originalPrice?: number | null;
  image?: string | null;
  quantity?: number;
  /** True when the listing being added is a gig (sql/0019). */
  isService?: boolean;
}) {
  const cart = readCart();
  const shop =
    cart[item.shopId] ??
    (cart[item.shopId] = {
      shopId: item.shopId,
      shopSlug: item.shopSlug,
      shopName: item.shopName,
      shopLogo: item.shopLogo ?? null,
      city: item.city ?? "",
      state: item.state ?? "",
      deliveryFee: item.deliveryFee ?? 0,
      freeThreshold: item.freeThreshold ?? null,
      pickupAvailable: item.pickupAvailable ?? true,
      fulfilment: "delivery",
      lines: [],
    });

  const existing = shop.lines.find((l) => l.listingId === item.listingId);
  if (existing) existing.quantity += item.quantity ?? 1;
  else
    shop.lines.push({
      listingId: item.listingId,
      title: item.title,
      price: item.price,
      originalPrice: item.originalPrice ?? null,
      quantity: item.quantity ?? 1,
      image: item.image ?? null,
      isService: item.isService ?? false,
    });

  writeCart(cart);
}

export function setQuantity(shopId: string, listingId: string, quantity: number) {
  const cart = readCart();
  const shop = cart[shopId];
  if (!shop) return;
  if (quantity <= 0) shop.lines = shop.lines.filter((l) => l.listingId !== listingId);
  else {
    const line = shop.lines.find((l) => l.listingId === listingId);
    if (line) line.quantity = quantity;
  }
  if (shop.lines.length === 0) delete cart[shopId];
  writeCart(cart);
}

export function setFulfilment(shopId: string, fulfilment: "delivery" | "pickup") {
  const cart = readCart();
  if (cart[shopId]) {
    cart[shopId].fulfilment = fulfilment;
    writeCart(cart);
  }
}

export function removeShop(shopId: string) {
  const cart = readCart();
  delete cart[shopId];
  writeCart(cart);
}

export function clearCart() {
  writeCart({});
}

export function cartCount(cart: Cart) {
  return Object.values(cart).reduce((n, s) => n + s.lines.reduce((m, l) => m + l.quantity, 0), 0);
}

export function shopSubtotal(shop: CartShop) {
  return shop.lines.reduce((n, l) => n + l.price * l.quantity, 0);
}

export function shopDelivery(shop: CartShop) {
  if (shop.fulfilment === "pickup") return 0;
  // A basket of only gigs is performed, not shipped: no courier fee. Mixed
  // baskets still pay, because the goods in them really do travel. This
  // mirrors place_order, which charges 0 when the basket holds no product.
  const hasGoods = shop.lines.some((l) => !l.isService);
  if (!hasGoods) return 0;
  const sub = shopSubtotal(shop);
  if (shop.freeThreshold != null && sub >= shop.freeThreshold) return 0;
  return shop.deliveryFee;
}
