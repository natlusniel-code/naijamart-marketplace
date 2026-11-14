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
  /**
   * Where a buyer collects from (sql/0034). Both optional: a shop with an
   * address but no pin still gets a working "Directions" link, because
   * Google geocodes the text.
   */
  pickupAddress?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
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
    /**
     * Which package tier was chosen (sql/0021): basic, standard or premium.
     * The price on this line is already the tier's price; the tier is kept
     * so the order line records what was bought, and so `place_order` can
     * re-price it server-side rather than trusting the client.
     */
    packageTier?: "basic" | "standard" | "premium" | null;
    /**
     * The seller's fulfilment choice for this listing (sql/0034):
     * 'both', 'pickup' or 'delivery'. Optional so carts saved before this
     * field existed still parse — an absent value is treated as 'both'.
     */
    fulfilmentMode?: "both" | "pickup" | "delivery";
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
  pickupAddress?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  listingId: string;
  title: string;
  price: number;
  originalPrice?: number | null;
  image?: string | null;
  quantity?: number;
  /** True when the listing being added is a gig (sql/0019). */
  isService?: boolean;
  /** The chosen package tier for a gig (sql/0021). */
  packageTier?: "basic" | "standard" | "premium" | null;
  /** The seller's fulfilment choice for this listing (sql/0034). */
  fulfilmentMode?: "both" | "pickup" | "delivery";
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
      pickupAddress: item.pickupAddress ?? null,
      pickupLat: item.pickupLat ?? null,
      pickupLng: item.pickupLng ?? null,
      fulfilment: "delivery",
      lines: [],
    });

  // A gig bought at two different tiers is two different lines: Basic and
  // Premium are different products at different prices, so they must not
  // merge into one quantity.
  const lineKey = (id: string, tier?: string | null) => `${id}::${tier ?? ""}`;
  const existing = shop.lines.find(
    (l) => lineKey(l.listingId, l.packageTier) === lineKey(item.listingId, item.packageTier),
  );
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
      packageTier: item.packageTier ?? null,
      fulfilmentMode: item.fulfilmentMode ?? "both",
    });

  // A shop that only allows pickup must not keep a stale 'delivery' choice
  // in the saved cart: the buyer would reach checkout with a mode the
  // server will refuse. Same the other way round.
  const allows = allowedFulfilments(shop);
  if (!allows.includes(shop.fulfilment)) {
    shop.fulfilment = allows[0] ?? "delivery";
  }

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
  const shop = cart[shopId];
  if (!shop) return;
  // Silently ignoring a mode the seller does not offer would leave the
  // radio looking unresponsive; the callers only render modes this allows,
  // so this guard is for a stale cart, not for the UI.
  if (!allowedFulfilments(shop).includes(fulfilment)) return;
  shop.fulfilment = fulfilment;
  writeCart(cart);
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

/**
 * True when every line in this shop's basket is a gig.
 *
 * A service-only basket is not shipped and not collected: the provider
 * performs the work. So it has no delivery fee AND no pickup/delivery
 * choice to make — the cart and checkout both hide that whole block for
 * these shops rather than showing a toggle that cannot change anything.
 *
 * A MIXED basket (a product and a gig from the same shop) is not
 * service-only: the goods in it really do travel, so it keeps the normal
 * fulfilment choice and pays the courier fee.
 */
export function isServiceOnly(shop: CartShop) {
  return shop.lines.length > 0 && shop.lines.every((l) => l.isService);
}

/**
 * Which fulfilment modes the lines in this shop actually allow.
 *
 * A shop's basket can hold two products from the same seller where one is
 * "pickup only" and the other is "delivery only". Neither mode can serve
 * both, so the result is empty and checkout refuses the basket with a
 * message naming the conflict — which is the honest answer: the buyer has
 * to split the order or drop a line.
 *
 * An absent `fulfilmentMode` (a cart saved before sql/0034) counts as
 * 'both', so an old local cart keeps working.
 *
 * A service-only basket allows both: a gig is performed, not shipped or
 * collected, so the choice is inert and must never block checkout.
 */
export function allowedFulfilments(shop: CartShop): ("delivery" | "pickup")[] {
  if (isServiceOnly(shop)) return ["delivery", "pickup"];

  const goods = shop.lines.filter((l) => !l.isService);
  if (goods.length === 0) return ["delivery", "pickup"];

  const modes = new Set(goods.map((l) => l.fulfilmentMode ?? "both"));
  const allowsPickup = modes.has("both") || modes.has("pickup");
  const allowsDelivery = modes.has("both") || modes.has("delivery");
  // A product seller who has switched pickup off at shop level cannot be
  // collected from, whatever the listing says.
  const pickupAtShop = shop.pickupAvailable ? allowsPickup : false;

  const out: ("delivery" | "pickup")[] = [];
  if (pickupAtShop) out.push("pickup");
  if (allowsDelivery) out.push("delivery");
  return out;
}

/**
 * True when the basket holds two lines that cannot share one fulfilment
 * mode — the case `allowedFulfilments` reports as empty.
 */
export function hasFulfilmentConflict(shop: CartShop) {
  return !isServiceOnly(shop) && shop.lines.some((l) => !l.isService) && allowedFulfilments(shop).length === 0;
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
