"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const ITEMS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/search", label: "Search", icon: "search" },
  { href: "/wishlist", label: "Saved", icon: "heart" },
  { href: "/chats", label: "Chats", icon: "chat" },
  { href: "/orders", label: "Orders", icon: "box" },
  { href: "/profile", label: "Profile", icon: "user" },
];

function Icon({ name, active }: { name: string; active: boolean }) {
  const stroke = active ? 2.4 : 1.9;
  const common = { fill: "none", stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "home":
      return <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" {...common}><path d="M3.5 10.5 12 3.8l8.5 6.7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1v-9.5Z" /></svg>;
    case "search":
      return <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>;
    case "chat":
      return <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" {...common}><path d="M20.5 12c0 4.1-3.8 7.4-8.5 7.4-1 0-1.9-.15-2.8-.42L4 21l1.3-3.6A7 7 0 0 1 3.5 12C3.5 7.9 7.3 4.6 12 4.6s8.5 3.3 8.5 7.4Z" /></svg>;
    case "heart":
      return <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" {...common}><path d="M12 20.5s-7.5-4.6-7.5-9.6a4.4 4.4 0 0 1 7.5-3.1 4.4 4.4 0 0 1 7.5 3.1c0 5-7.5 9.6-7.5 9.6Z" /></svg>;
    case "box":
      return <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></svg>;
    default:
      return <svg viewBox="0 0 24 24" className="h-[21px] w-[21px]" {...common}><circle cx="12" cy="8.2" r="3.7" /><path d="M4.5 20.5c.7-3.6 3.8-5.8 7.5-5.8s6.8 2.2 7.5 5.8" /></svg>;
  }
}

/**
 * Bottom tab bar.
 *
 * `unread` is the number of UNREAD MESSAGES (not chats) — the old badge
 * counted conversations, so it never went away after reading one. It is
 * cleared the instant a chat is opened and kept live by a Realtime
 * subscription on `messages` (the table is in the supabase_realtime
 * publication as of sql/0009).
 */
export function TabBar({ cartCount = 0, unread = 0 }: { cartCount?: number; unread?: number }) {
  const path = usePathname() || "/";
  const [count, setCount] = useState(unread);
  const inChat = path.startsWith("/chats");

  // Server-rendered value wins whenever the layout re-renders.
  useEffect(() => {
    setCount(unread);
  }, [unread]);

  // Opening any chat clears the badge immediately, before the round trip.
  useEffect(() => {
    if (inChat) setCount(0);
  }, [inChat, path]);

  // Live updates: a new message bumps the badge, a read receipt clears it.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const refresh = async () => {
      const { data } = await supabase.rpc("unread_message_count");
      if (!cancelled && typeof data === "number") setCount(data);
    };

    const ch = supabase
      .channel("tabbar-unread")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        if (!inChat) refresh();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, () => {
        if (!inChat) refresh();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [inChat]);

  return (
    <nav className="nm-sticky-chrome fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--line)] bg-white pb-[env(safe-area-inset-bottom)] md:sticky md:top-0 md:border-b md:border-t-0">
      <div className="mx-auto flex max-w-7xl items-center justify-around md:justify-start md:gap-1 md:px-4">
        {ITEMS.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          const badge = it.href === "/chats" ? count : 0;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold md:flex-none md:flex-row md:gap-2 md:rounded-xl md:px-3 md:py-2 md:text-[13.5px]",
                active ? "text-brand-600" : "text-ink-400 hover:text-ink-700",
              )}
            >
              <span className="relative">
                <Icon name={it.icon} active={active} />
                {badge > 0 && (
                  <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9.5px] font-bold text-white">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
