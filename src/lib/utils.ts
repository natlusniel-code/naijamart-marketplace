import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export const NGN = "₦";

export function naira(amount: number | string | null | undefined, opts?: { compact?: boolean }) {
  const n = typeof amount === "string" ? Number(amount) : (amount ?? 0);
  if (!isFinite(n)) return `${NGN}0`;
  if (opts?.compact && Math.abs(n) >= 1_000_000) {
    return `${NGN}${(n / 1_000_000).toFixed(1)}m`;
  }
  return `${NGN}${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

export function shortDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}

export function relTime(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(date);
}

/**
 * Nigeria location data lives in `@/lib/nigeria` — the full 774-LGA dataset.
 *
 * It is re-exported here so the ~6 existing importers
 * (`location-picker`, `profile-form`, `onboarding-flow`, `signup-details`,
 * `profile/location`) keep working unchanged and automatically pick up the
 * complete list. New code should import from `@/lib/nigeria` directly.
 *
 * The previous implementation was a stub covering 8 states; it is gone.
 */
export { NIGERIA_STATES, LGA_BY_STATE, lgasFor, isValidLocation, TOTAL_LGAS } from "./nigeria";
export type { NigeriaState } from "./nigeria";

/** Order status → label + colour classes (the single source of truth for badges). */
export const ORDER_STATUS: Record<string, { label: string; tone: "green" | "amber" | "blue" | "gray" | "red" | "violet" }> = {
  pending_payment: { label: "Pending payment", tone: "amber" },
  paid: { label: "Payment confirmed", tone: "blue" },
  accepted: { label: "Accepted", tone: "blue" },
  processing: { label: "Processing", tone: "blue" },
  shipped: { label: "Shipped", tone: "violet" },
  ready_for_pickup: { label: "Ready for pickup", tone: "violet" },
  delivered: { label: "Delivered", tone: "green" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
  disputed: { label: "Disputed", tone: "red" },
};

export const ORDER_STEPS = [
  "Order placed",
  "Payment confirmed",
  "Seller preparing",
  "Shipped",
  "Delivered",
  "Completed",
] as const;

export function stepIndexFor(status: string, fulfilment = "delivery") {
  switch (status) {
    case "pending_payment": return 0;
    case "paid": return 1;
    case "accepted":
    case "processing": return 2;
    case "shipped":
    case "ready_for_pickup": return 3;
    case "delivered": return 4;
    case "completed": return 5;
    default: return 0;
  }
}

/**
 * Discount maths, in one place.
 *
 * The database stores `discount_percent` as a generated column, so the
 * storefront normally just reads it. This function exists for the two places
 * that cannot: the seller's form (which must show the percentage *before* the
 * row is saved) and the cart (which holds a price snapshot, not a listing).
 *
 * Returns 0 — not null — when there is no real discount, so callers can use
 * `if (pct > 0)` without a null check. A "discount" that does not lower the
 * price is not a discount, and rounding is to 2dp to match the column.
 */
export function discountPercent(price: number, originalPrice: number | null | undefined): number {
  if (originalPrice == null) return 0;
  const was = Number(originalPrice);
  const now = Number(price);
  if (!isFinite(was) || !isFinite(now) || was <= 0 || was <= now) return 0;
  return Math.round(((was - now) / was) * 10000) / 100;
}

/** "25% off" — the label on the badge. Empty string when there is no discount. */
export function discountLabel(price: number, originalPrice: number | null | undefined): string {
  const pct = discountPercent(price, originalPrice);
  if (pct <= 0) return "";
  // 12.5% reads better than 12.50%; 12% better than 12.00%.
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}% off`;
}

export function initials(name: string | null | undefined) {
  if (!name) return "NM";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
