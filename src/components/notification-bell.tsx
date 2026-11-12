"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn, relTime } from "@/lib/utils";
import { showBrowserNotification, notificationPermission } from "@/lib/browser-notify";
import { notificationTitle, notificationBody, sourceFor } from "@/lib/notification-source";

type Row = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

/**
 * Header bell with an unread badge and a dropdown of recent notifications.
 *
 * Three things keep the badge honest:
 *
 *   1. The server-rendered `unread` count is the starting value, so the badge
 *      is correct on first paint rather than appearing a moment later.
 *   2. A Realtime subscription on `notifications` INSERTs bumps it live. The
 *      filter is on `user_id` so a buyer is not woken by someone else's order.
 *   3. Opening the dropdown marks what is shown as read, and the count drops
 *      immediately — a badge that only clears on the next page load is the
 *      single most common complaint about notification bells.
 *
 * When the browser has notification permission, a new row also raises a real
 * OS notification, so an order update reaches the phone's tray and not just
 * this dropdown.
 */
export function NotificationBell({
  unread: initialUnread,
  allHref = "/notifications",
}: {
  unread: number;
  /**
   * Where "See all" goes. The storefront bell points at `/notifications`; the
   * Seller Hub bell points at `/seller/notifications`, because a seller is
   * redirected out of the storefront.
   */
  allHref?: string;
}) {
  const router = useRouter();
  const path = usePathname() || "/";
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const onNotificationsPage = path.startsWith(allHref);

  useEffect(() => {
    setUnread(initialUnread);
  }, [initialUnread]);

  // Close on an outside click or Escape — a dropdown that traps you is worse
  // than no dropdown.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Live badge + OS notification.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid || cancelled) return;

      channel = supabase
        .channel("nm-notifications")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          (payload) => {
            const row = payload.new as Row;
            setUnread((n) => n + 1);
            setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev].slice(0, 12)));

            // Only raise an OS notification when the buyer is not already
            // looking at the notifications page — otherwise they get a popup
            // for something they are reading.
            if (!onNotificationsPage && notificationPermission() === "granted") {
              // Name the source in the title — "Message from Ada", "Order
              // update — ...", "NaijaMart — ..." — so the OS popup says where
              // it came from instead of showing a bare subject line.
              void showBrowserNotification({
                title: notificationTitle(row.kind, row.title),
                body: notificationBody(row.kind, row.body),
                url: row.href ?? sourceFor(row.kind).href,
                tag: row.id,
                kind: row.kind,
              });
            }
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [onNotificationsPage]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;

    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("id,kind,title,body,href,read_at,created_at")
      .order("created_at", { ascending: false })
      .limit(8);
    const list = (data ?? []) as Row[];
    setRows(list);
    setLoading(false);

    // Mark the ones we just showed as read.
    const unreadIds = list.filter((r) => !r.read_at).map((r) => r.id);
    if (unreadIds.length) {
      setUnread((n) => Math.max(0, n - unreadIds.length));
      setRows((prev) => prev.map((r) => (unreadIds.includes(r.id) ? { ...r, read_at: new Date().toISOString() } : r)));
      await supabase.rpc("mark_notifications_read", { p_ids: unreadIds });
      router.refresh();
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative grid h-8 w-8 place-items-center rounded-full text-ink-600 transition hover:bg-slate-100"
      >
        <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
          <path d="M10.3 19a2 2 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9.5px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-lift">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-3.5 py-2.5">
            <p className="text-[13.5px] font-bold text-ink-900">Notifications</p>
            <Link href={allHref} onClick={() => setOpen(false)} className="text-[12px] font-semibold text-brand-600">
              See all →
            </Link>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {loading && <div className="px-3.5 py-6 text-center text-[12.5px] text-ink-400">Loading…</div>}
            {!loading && rows.length === 0 && (
              <div className="px-3.5 py-8 text-center">
                <p className="text-[13px] font-semibold text-ink-700">Nothing yet</p>
                <p className="mt-1 text-[12px] text-ink-400">Order updates will show up here.</p>
              </div>
            )}
            {!loading &&
              rows.map((r) => {
                const inner = (
                  <>
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                          r.read_at ? "bg-transparent" : "bg-brand-500",
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-semibold leading-snug text-ink-900">{r.title}</p>
                        {r.body && <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-ink-500">{r.body}</p>}
                        <p className="mt-1 text-[10.5px] text-ink-400">{relTime(r.created_at)}</p>
                      </div>
                    </div>
                  </>
                );
                return r.href ? (
                  <Link
                    key={r.id}
                    href={r.href}
                    onClick={() => setOpen(false)}
                    className="block border-b border-[var(--line)] px-3.5 py-2.5 last:border-0 hover:bg-slate-50"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={r.id} className="border-b border-[var(--line)] px-3.5 py-2.5 last:border-0">
                    {inner}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
