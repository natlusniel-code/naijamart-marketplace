import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { naira, shortDate, ORDER_STATUS } from "@/lib/utils";
import { Stat, Card, Badge, EmptyState } from "@/components/ui";
import { AdminRevenueChart } from "@/components/admin/revenue-chart";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin dashboard" };

export default async function AdminDashboard() {
  const supabase = createClient();

  const [{ data: orders }, { data: payments }, { data: payouts }, { data: shops }, { data: profiles }, { data: disputes }] =
    await Promise.all([
      supabase.from("orders").select("id,reference,status,total,commission_amount,payout_amount,payout_status,created_at,shop_id").order("created_at", { ascending: false }),
      supabase.from("payments").select("id,type,amount,status,created_at,reference,shop_id,order_id").eq("status", "pending"),
      supabase.from("payouts").select("id,amount,status,available_at,requested_at,shop_id"),
      supabase.from("shops").select("id,name,status,subscription_status,subscription_expires_at"),
      supabase.from("profiles").select("id,role"),
      supabase.from("disputes").select("id,status"),
    ]);

  const allOrders = orders ?? [];
  const paidOrders = allOrders.filter((o: any) => !["pending_payment", "cancelled"].includes(o.status));

  const revenue = paidOrders.reduce((n: number, o: any) => n + Number(o.commission_amount), 0);
  const escrow = paidOrders
    .filter((o: any) => o.payout_status === "held" && !["completed", "cancelled"].includes(o.status))
    .reduce((n: number, o: any) => n + Number(o.total), 0);
  const pendingPayouts = (payouts ?? []).filter((p: any) => p.status === "queued").reduce((n: number, p: any) => n + Number(p.amount), 0);

  const today = new Date().toDateString();
  const ordersToday = allOrders.filter((o: any) => new Date(o.created_at).toDateString() === today).length;

  const activeSellers = (shops ?? []).filter((s: any) => s.status === "approved").length;
  const buyers = (profiles ?? []).filter((p: any) => p.role === "buyer").length;

  // needs attention
  const orderReceipts = (payments ?? []).filter((p: any) => p.type === "order");
  const subReceipts = (payments ?? []).filter((p: any) => p.type === "subscription");
  const payoutRequests = (payouts ?? []).filter((p: any) => p.status === "queued" && p.requested_at);
  const sellerApps = (shops ?? []).filter((s: any) => s.status === "pending");
  const openDisputes = (disputes ?? []).filter((d: any) => d.status === "open");

  // 30-day commission series
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return { label: `${d.getDate()}/${d.getMonth() + 1}`, date: d.toDateString(), value: 0 };
  });
  paidOrders.forEach((o: any) => {
    const slot = days.find((d) => d.date === new Date(o.created_at).toDateString());
    if (slot) slot.value += Number(o.commission_amount);
  });

  const queue = [
    { label: "Order receipts to verify", count: orderReceipts.length, href: "/admin-fuckliving/payments", tone: "amber" },
    { label: "Subscription payments", count: subReceipts.length, href: "/admin-fuckliving/payments", tone: "amber" },
    { label: "Seller applications", count: sellerApps.length, href: "/admin-fuckliving/sellers", tone: "blue" },
    { label: "Payout requests", count: payoutRequests.length, href: "/admin-fuckliving/payouts", tone: "violet" },
    { label: "Open disputes", count: openDisputes.length, href: "/admin-fuckliving/disputes", tone: "red" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Dashboard</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-500">
            All of NaijaMart · {shortDate(new Date().toISOString())}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Commission earned" value={naira(revenue)} hint="5% of all orders" tone="brand" />
        <Stat label="Escrow held" value={naira(escrow)} hint="buyer money in hand" tone="amber" />
        <Stat label="Pending payouts" value={naira(pendingPayouts)} hint="owed to sellers" />
        <Stat label="Active sellers" value={String(activeSellers)} hint={`${buyers} buyers`} />
        <Stat label="Orders today" value={String(ordersToday)} hint={`${allOrders.length} all time`} />
        <Stat label="Open disputes" value={String(openDisputes.length)} hint="need a decision" tone={openDisputes.length ? "red" : undefined} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-4">
          <p className="text-[14px] font-bold text-ink-900">Needs your attention</p>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {queue.map((q) => (
              <li key={q.label}>
                <Link href={q.href} className="flex items-center justify-between gap-2 py-2 hover:opacity-80">
                  <span className="text-[12.5px] text-ink-700">{q.label}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={q.count ? (q.tone as any) : "gray"}>{q.count}</Badge>
                    <span className="text-ink-300">›</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {queue.every((q) => q.count === 0) && (
            <p className="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-[12px] text-brand-900">
              Queue is clear — nothing waiting on you.
            </p>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-[14px] font-bold text-ink-900">Commission · last 30 days</p>
          <AdminRevenueChart data={days.map((d) => ({ label: d.label, value: d.value }))} />
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
          <p className="text-[14px] font-bold text-ink-900">Recent orders</p>
          <Link href="/admin-fuckliving/orders" className="text-[12.5px] font-semibold text-brand-600">Full ledger →</Link>
        </div>
        {allOrders.length === 0 ? (
          <div className="p-4">
            <EmptyState icon="🧾" title="No orders yet" body="Once buyers start paying, every order lands here with its escrow and commission split." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-4 py-2 font-semibold">Reference</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                  <th className="px-2 py-2 text-right font-semibold">Gross</th>
                  <th className="px-2 py-2 text-right font-semibold">Commission</th>
                  <th className="px-2 py-2 text-right font-semibold">Seller net</th>
                  <th className="px-4 py-2 font-semibold">Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {allOrders.slice(0, 8).map((o: any) => {
                  const st = ORDER_STATUS[o.status] ?? { label: o.status, tone: "gray" };
                  return (
                    <tr key={o.id}>
                      <td className="px-4 py-2 font-mono text-[11px] text-ink-600">
                        <Link href={`/orders/${o.id}`} className="hover:text-brand-600">{o.reference}</Link>
                      </td>
                      <td className="px-2 py-2"><Badge tone={st.tone as any}>{st.label}</Badge></td>
                      <td className="px-2 py-2 text-right">{naira(o.total)}</td>
                      <td className="px-2 py-2 text-right text-brand-700">{naira(o.commission_amount)}</td>
                      <td className="px-2 py-2 text-right font-semibold">{naira(o.payout_amount)}</td>
                      <td className="px-4 py-2">
                        <Badge tone={o.payout_status === "paid" ? "green" : o.payout_status === "released" ? "blue" : "amber"}>
                          {o.payout_status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
