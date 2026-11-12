"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The Seller Hub's own navigation.
 *
 * Chats and Notifications live here rather than in the storefront: a seller is
 * redirected out of the storefront, so the buyer tab bar is not available to
 * them. Everything a seller needs to run the shop is reachable from this strip.
 */
const ITEMS = [
  { href: "/seller", label: "Dashboard", exact: true },
  { href: "/seller/orders", label: "Orders" },
  { href: "/seller/listings", label: "Listings" },
  { href: "/seller/analytics", label: "Analytics" },
  { href: "/seller/chats", label: "Chats", badge: "messages" as const },
  { href: "/seller/notifications", label: "Notifications" },
  { href: "/seller/payouts", label: "Payouts" },
  { href: "/seller/subscription", label: "Subscription" },
  { href: "/seller/reviews", label: "Reviews" },
  { href: "/seller/settings", label: "Settings" },
];

export function SellerNav({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const path = usePathname() || "";
  return (
    <nav className="nm-scroll -mx-1 flex gap-1 overflow-x-auto pb-1.5">
      {ITEMS.map((it) => {
        const active = it.exact ? path === it.href : path.startsWith(it.href);
        const badge = it.badge === "messages" ? unreadMessages : 0;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "relative whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition",
              active ? "bg-brand-50 text-brand-700" : "text-ink-500 hover:bg-slate-50 hover:text-ink-900",
            )}
          >
            {it.label}
            {badge > 0 && (
              <span className="ml-1.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 align-middle text-[9.5px] font-bold text-white">
                {badge > 9 ? "9+" : badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
