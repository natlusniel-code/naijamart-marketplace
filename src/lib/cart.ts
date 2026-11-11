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
    quantity: number;
    image: string | null;
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
  image?: string | null;
  quantity?: number;
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
      quantity: item.quantity ?? 1,
      image: item.image ?? null,
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
  const sub = shopSubtotal(shop);
  if (shop.freeThreshold != null && sub >= shop.freeThreshold) return 0;
  return shop.deliveryFee;
}
