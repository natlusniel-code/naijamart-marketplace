"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/seller", label: "Dashboard", exact: true },
  { href: "/seller/orders", label: "Orders" },
  { href: "/seller/listings", label: "Listings" },
  { href: "/seller/chats", label: "Chats" },
  { href: "/seller/payouts", label: "Payouts" },
  { href: "/seller/subscription", label: "Subscription" },
  { href: "/seller/reviews", label: "Reviews" },
  { href: "/seller/settings", label: "Settings" },
];

export function SellerNav() {
  const path = usePathname() || "";
  return (
    <nav className="nm-scroll -mx-1 flex gap-1 overflow-x-auto pb-1.5">
      {ITEMS.map((it) => {
        const active = it.exact ? path === it.href : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition",
              active ? "bg-brand-50 text-brand-700" : "text-ink-500 hover:bg-slate-50 hover:text-ink-900",
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
