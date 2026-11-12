"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const BASE = "/admin-fuckliving";

const ITEMS = [
  { href: BASE, label: "Dashboard", exact: true },
  { href: `${BASE}/payments`, label: "Payments" },
  { href: `${BASE}/payment-accounts`, label: "Payment accounts" },
  { href: `${BASE}/sellers`, label: "Sellers" },
  { href: `${BASE}/buyers`, label: "Buyers" },
  { href: `${BASE}/orders`, label: "Orders" },
  { href: `${BASE}/disputes`, label: "Disputes" },
  { href: `${BASE}/payouts`, label: "Payouts" },
  { href: `${BASE}/reviews`, label: "Reviews" },
  { href: `${BASE}/blocked-messages`, label: "Blocked messages" },
  { href: `${BASE}/notifications`, label: "Notifications" },
  { href: `${BASE}/settings`, label: "Settings" },
];

export function AdminNav() {
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
              active ? "bg-ink-900 text-white" : "text-ink-500 hover:bg-slate-100 hover:text-ink-900",
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
