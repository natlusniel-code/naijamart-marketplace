import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin console activity indicator.
 *
 * The console has no sign-in gate by design, so it has no `auth.uid()` and
 * therefore no per-user notification rows to show in a bell. What an operator
 * actually needs to be told is "something needs you": orders waiting to be
 * accepted, disputes open, sellers waiting for approval. This counts those
 * server-side and links straight to the page that handles them.
 *
 * A signed-in admin ALSO gets real push notifications through
 * `NotificationBridge` in the root layout — this is the console-side view.
 */
export async function AdminAlerts() {
  const supabase = createAdminClient();

  const [{ count: newOrders }, { count: disputes }, { count: pendingSellers }] = await Promise.all([
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status", ["paid", "pending_payment"]),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "disputed"),
    supabase.from("shops").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const items = [
    { href: "/admin-fuckliving/orders", label: "orders to action", n: newOrders ?? 0 },
    { href: "/admin-fuckliving/disputes", label: "disputes", n: disputes ?? 0 },
    { href: "/admin-fuckliving/sellers", label: "sellers pending", n: pendingSellers ?? 0 },
  ].filter((i) => i.n > 0);

  if (!items.length) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11.5px] font-semibold text-brand-700 sm:inline-flex">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
        All clear
      </span>
    );
  }

  return (
    <div className="hidden items-center gap-1.5 sm:flex">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11.5px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-500/20 hover:bg-amber-100"
        >
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[9.5px] font-bold text-white">
            {i.n > 99 ? "99+" : i.n}
          </span>
          {i.label}
        </Link>
      ))}
    </div>
  );
}
