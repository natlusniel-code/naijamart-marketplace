import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { getNotifications } from "@/lib/queries";
import { relTime, cn } from "@/lib/utils";
import { EmptyState, Badge } from "@/components/ui";
import { PushOptIn } from "@/components/push-opt-in";
import { MarkAllRead } from "@/components/mark-all-read";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

const KIND_TONE: Record<string, "blue" | "violet" | "gray"> = {
  order: "blue",
  broadcast: "violet",
  system: "gray",
};

const KIND_LABEL: Record<string, string> = {
  order: "Order",
  broadcast: "Announcement",
  system: "System",
};

/**
 * Notifications inside the Seller Hub.
 *
 * Sellers are redirected out of the storefront, so the buyer-side
 * `/notifications` page is unreachable for them — but order notifications are
 * exactly what a seller needs. This is the same list, rendered in the hub
 * shell, so the bell in the hub header has somewhere to go.
 */
export default async function SellerNotificationsPage() {
  const session = await getSession();
  if (!session) redirect("/signin?next=%2Fseller%2Fnotifications");

  const rows = await getNotifications(session.user.id);
  const unread = rows.filter((r) => !r.read_at).length;

  // Group by day so a long list stays readable.
  const groups: { label: string; items: typeof rows }[] = [];
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;

  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    const label =
      t >= startOfToday
        ? "Today"
        : t >= startOfYesterday
          ? "Yesterday"
          : new Date(r.created_at).toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric" });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(r);
    else groups.push({ label, items: [r] });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Notifications</h1>
          <p className="mt-0.5 text-[13px] text-ink-500">
            {rows.length === 0
              ? "Order updates and announcements appear here."
              : unread > 0
                ? `${unread} unread`
                : "You're all caught up."}
          </p>
        </div>
        {unread > 0 && <MarkAllRead />}
      </div>

      <PushOptIn />

      {rows.length === 0 ? (
        <EmptyState
          icon="🔔"
          title="No notifications yet"
          body="New orders, buyer messages and NaijaMart announcements will show up here."
          action="Back to dashboard"
          href="/seller"
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-400">{g.label}</h2>
              <div className="divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
                {g.items.map((r) => {
                  const inner = (
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          r.read_at ? "bg-slate-200" : "bg-brand-500",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={cn("text-[13.5px] leading-snug", r.read_at ? "font-semibold text-ink-700" : "font-bold text-ink-900")}>
                            {r.title}
                          </p>
                          <Badge tone={KIND_TONE[r.kind] ?? "gray"}>{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                        </div>
                        {r.body && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{r.body}</p>}
                        <p className="mt-1 text-[11px] text-ink-400">{relTime(r.created_at)}</p>
                      </div>
                    </div>
                  );
                  return r.href ? (
                    <Link key={r.id} href={r.href} className="block px-4 py-3 transition hover:bg-slate-50">
                      {inner}
                    </Link>
                  ) : (
                    <div key={r.id} className="px-4 py-3">
                      {inner}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
