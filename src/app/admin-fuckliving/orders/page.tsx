import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { naira, shortDate, ORDER_STATUS, cn } from "@/lib/utils";
import { Card, Badge, EmptyState } from "@/components/ui";
import { CsvExport } from "@/components/admin/csv-export";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders ledger" };

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string };
}) {
  const supabase = createClient();
  const { data: orders } = await supabase
    .from("orders")
    .select("*, shops(name,slug), order_items(title,quantity,line_total)")
    .order("created_at", { ascending: false });

  let list = orders ?? [];
  if (searchParams.status) list = list.filter((o: any) => o.status === searchParams.status);
  if (searchParams.q) {
    const q = searchParams.q.toLowerCase();
    list = list.filter(
      (o: any) =>
        o.reference?.toLowerCase().includes(q) ||
        o.shops?.name?.toLowerCase().includes(q) ||
        o.address?.toLowerCase().includes(q),
    );
  }

  const totals = {
    gross: list.reduce((n: number, o: any) => n + Number(o.total), 0),
    commission: list.reduce((n: number, o: any) => n + Number(o.commission_amount), 0),
    net: list.reduce((n: number, o: any) => n + Number(o.payout_amount), 0),
  };

  const STATUSES = ["pending_payment", "paid", "accepted", "processing", "shipped", "ready_for_pickup", "delivered", "completed", "cancelled", "disputed"];

  const csvRows = list.map((o: any) => ({
    reference: o.reference,
    date: shortDate(o.created_at),
    shop: o.shops?.name ?? "",
    status: o.status,
    fulfilment: o.fulfilment,
    gross: Number(o.total).toFixed(2),
    commission: Number(o.commission_amount).toFixed(2),
    seller_net: Number(o.payout_amount).toFixed(2),
    payout_status: o.payout_status,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Orders ledger</h1>
        <CsvExport rows={csvRows} filename="naijamart-orders.csv" />
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <div className="nm-card px-3 py-2.5">
          <p className="text-[10.5px] uppercase tracking-wide text-ink-400">Gross</p>
          <p className="mt-0.5 text-[15px] font-extrabold text-ink-900">{naira(totals.gross)}</p>
        </div>
        <div className="nm-card px-3 py-2.5">
          <p className="text-[10.5px] uppercase tracking-wide text-ink-400">Commission</p>
          <p className="mt-0.5 text-[15px] font-extrabold text-brand-700">{naira(totals.commission)}</p>
        </div>
        <div className="nm-card px-3 py-2.5">
          <p className="text-[10.5px] uppercase tracking-wide text-ink-400">Seller net</p>
          <p className="mt-0.5 text-[15px] font-extrabold text-ink-900">{naira(totals.net)}</p>
        </div>
      </div>

      <form className="flex flex-wrap gap-2" action="/admin-fuckliving/orders">
        <input name="q" defaultValue={searchParams.q} className="nm-input !w-auto flex-1 !py-2 !text-[12.5px]" placeholder="Search reference, shop or address…" />
        <select name="status" defaultValue={searchParams.status} className="nm-input !w-auto !py-2 !text-[12.5px]">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS[s]?.label ?? s}</option>)}
        </select>
        <button className="nm-btn-ghost !py-2 !text-[12.5px]">Filter</button>
        <Link href="/admin-fuckliving/orders" className="nm-btn-ghost !py-2 !text-[12.5px]">Clear</Link>
      </form>

      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <div className="p-4">
            <EmptyState icon="📊" title="No orders match" body="Try clearing the filters. Every paid order stays here for the ledger even after it completes." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[12px]">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-4 py-2 font-semibold">Reference</th>
                  <th className="px-2 py-2 font-semibold">Shop</th>
                  <th className="px-2 py-2 font-semibold">Date</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                  <th className="px-2 py-2 text-right font-semibold">Gross</th>
                  <th className="px-2 py-2 text-right font-semibold">5%</th>
                  <th className="px-2 py-2 text-right font-semibold">Net</th>
                  <th className="px-4 py-2 font-semibold">Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {list.map((o: any) => {
                  const st = ORDER_STATUS[o.status] ?? { label: o.status, tone: "gray" };
                  return (
                    <tr key={o.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2">
                        <Link href={`/orders/${o.id}`} className="font-mono text-[11px] text-ink-700 hover:text-brand-600">{o.reference}</Link>
                        <p className="text-[10.5px] text-ink-400">{o.fulfilment}</p>
                      </td>
                      <td className="px-2 py-2 text-ink-600">{o.shops?.name ?? "—"}</td>
                      <td className="px-2 py-2 text-ink-500">{shortDate(o.created_at)}</td>
                      <td className="px-2 py-2"><Badge tone={st.tone as any}>{st.label}</Badge></td>
                      <td className="px-2 py-2 text-right text-ink-700">{naira(o.total)}</td>
                      <td className="px-2 py-2 text-right text-brand-700">{naira(o.commission_amount)}</td>
                      <td className="px-2 py-2 text-right font-semibold text-ink-900">{naira(o.payout_amount)}</td>
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
