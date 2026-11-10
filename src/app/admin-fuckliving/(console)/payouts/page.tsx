import { createAdminClient } from "@/lib/supabase/admin";
import { naira, shortDate } from "@/lib/utils";
import { Card, Badge, EmptyState, Stat, Alert } from "@/components/ui";
import { MarkPaid } from "@/components/admin/mark-paid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payouts" };

export default async function AdminPayoutsPage() {
  const supabase = createAdminClient();

  const [{ data: payouts }, { data: orders }] = await Promise.all([
    supabase
      .from("payouts")
      .select("*, shops(name,slug,bank_name,bank_account_number,bank_account_name)")
      .order("created_at", { ascending: false }),
    supabase.from("orders").select("total,payout_amount,payout_status,status"),
  ]);

  const list = payouts ?? [];
  const now = Date.now();

  const escrow = (orders ?? [])
    .filter((o: any) => o.payout_status === "held" && !["completed", "cancelled"].includes(o.status))
    .reduce((n: number, o: any) => n + Number(o.total), 0);

  const queue = list.filter((p: any) => p.status === "queued");
  const history = list.filter((p: any) => p.status === "paid");

  const overdue = queue.filter((p: any) => {
    const ref = p.requested_at ?? p.available_at ?? p.created_at;
    return now - new Date(ref).getTime() > 48 * 3600 * 1000;
  });

  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Payouts</h1>

      {overdue.length > 0 && (
        <Alert tone="red" title={`${overdue.length} payout${overdue.length === 1 ? "" : "s"} overdue`}>
          Released more than 48 hours ago and still unpaid — pay these first. Sellers see the delay on their dashboard.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Escrow held" value={naira(escrow)} hint="buyer money in hand" tone="amber" />
        <Stat label="Payout queue" value={naira(queue.reduce((n: number, p: any) => n + Number(p.amount), 0))} hint={`${queue.length} waiting`} />
        <Stat label="Paid out" value={naira(history.reduce((n: number, p: any) => n + Number(p.amount), 0))} hint={`${history.length} payouts`} tone="brand" />
        <Stat label="Overdue" value={String(overdue.length)} hint="over 48 hours" tone={overdue.length ? "red" : undefined} />
      </div>

      <Card className="overflow-hidden">
        <p className="border-b border-[var(--line)] px-4 py-2.5 text-[14px] font-bold text-ink-900">Payout queue</p>
        {queue.length === 0 ? (
          <div className="p-4">
            <EmptyState icon="💸" title="Nothing to pay out" body="A payout appears here once a buyer confirms delivery and the 24-hour hold passes." />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {queue.map((p: any) => {
              const late = now - new Date(p.requested_at ?? p.available_at ?? p.created_at).getTime() > 48 * 3600 * 1000;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink-900">{p.shops?.name ?? "Shop"}</p>
                    <p className="text-[11.5px] text-ink-500">
                      {p.shops?.bank_name} · {p.shops?.bank_account_number} · {p.shops?.bank_account_name}
                    </p>
                    <p className="text-[11px] text-ink-400">
                      {p.requested_at ? `requested ${shortDate(p.requested_at)}` : `released ${shortDate(p.available_at)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {late && <Badge tone="red">overdue</Badge>}
                    <span className="text-[13px] font-extrabold text-ink-900">{naira(p.amount)}</span>
                    <MarkPaid payoutId={p.id} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <p className="border-b border-[var(--line)] px-4 py-2.5 text-[14px] font-bold text-ink-900">Payment history</p>
        {history.length === 0 ? (
          <p className="px-4 py-3 text-[12.5px] text-ink-500">No payouts marked paid yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-4 py-2 font-semibold">Shop</th>
                  <th className="px-2 py-2 font-semibold">Reference</th>
                  <th className="px-2 py-2 text-right font-semibold">Net</th>
                  <th className="px-4 py-2 font-semibold">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {history.map((p: any) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-semibold text-ink-800">{p.shops?.name}</td>
                    <td className="px-2 py-2 font-mono text-[11px] text-ink-500">{p.reference ?? "—"}</td>
                    <td className="px-2 py-2 text-right font-semibold">{naira(p.amount)}</td>
                    <td className="px-4 py-2 text-ink-500">{shortDate(p.paid_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
