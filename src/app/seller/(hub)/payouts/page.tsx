import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { naira, shortDate } from "@/lib/utils";
import { Stat, Card, Badge, EmptyState } from "@/components/ui";
import { RequestPayout } from "@/components/seller/request-payout";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payouts" };

export default async function PayoutsPage() {
  const session = await getSession();
  if (!session?.shop) redirect("/seller/onboarding");

  const supabase = createClient();
  const { data: payouts } = await supabase
    .from("payouts")
    .select("id,amount,gross_amount,commission_amount,status,paid_at,requested_at,available_at,created_at,reference,order_id,orders(reference)")
    .eq("shop_id", session.shop.id)
    .order("created_at", { ascending: false });

  const list = payouts ?? [];
  const now = Date.now();
  const available = list.filter((p: any) => p.status === "queued" && !p.requested_at && new Date(p.available_at).getTime() <= now);
  const requested = list.filter((p: any) => p.status === "queued" && p.requested_at);
  const paid = list.filter((p: any) => p.status === "paid");
  const locked = list.filter((p: any) => p.status === "queued" && !p.requested_at && new Date(p.available_at).getTime() > now);

  const sum = (arr: any[]) => arr.reduce((n, p) => n + Number(p.amount), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-[21px] font-extrabold tracking-tight text-ink-900">Payouts</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available now" value={naira(sum(available))} tone="brand" />
        <Stat label="Pending release" value={naira(sum(locked))} hint="4 days after delivery" tone="amber" />
        <Stat label="Requested" value={naira(sum(requested))} hint="processing" />
        <Stat label="Paid out" value={naira(sum(paid))} hint={`${paid.length} payouts`} />
      </div>

      <Card className="border-brand-500/20 bg-brand-50/50 p-4">
        <p className="text-[13.5px] font-bold text-brand-900">Withdraw your balance</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-brand-900/80">
          Payouts are processed 4 days after delivery confirmation, straight to{" "}
          {session.shop.name ? "your registered bank account" : "your bank account"}. Request any amount that&apos;s available.
        </p>
        <div className="mt-2.5">
          <RequestPayout shopId={session.shop.id} amount={sum(available)} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <p className="border-b border-[var(--line)] px-4 py-2.5 text-[14px] font-bold text-ink-900">Payout history</p>
        {list.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="💸"
              title="No payouts yet"
              body="Once a buyer confirms delivery, your net amount (after the 5% commission) is queued here and unlocks 4 days later."
              action="See your orders"
              href="/seller/orders"
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-4 py-2 font-semibold">Date</th>
                  <th className="px-2 py-2 font-semibold">Order</th>
                  <th className="px-2 py-2 text-right font-semibold">Gross</th>
                  <th className="px-2 py-2 text-right font-semibold">Commission</th>
                  <th className="px-2 py-2 text-right font-semibold">Net</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {list.map((p: any) => {
                  const isLocked = p.status === "queued" && !p.requested_at && new Date(p.available_at).getTime() > now;
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-2 text-ink-500">{shortDate(p.paid_at ?? p.created_at)}</td>
                      <td className="px-2 py-2 font-mono text-[11px] text-ink-500">{p.orders?.reference ?? p.reference ?? "—"}</td>
                      <td className="px-2 py-2 text-right text-ink-600">{naira(p.gross_amount ?? p.amount)}</td>
                      <td className="px-2 py-2 text-right text-ink-400">−{naira(p.commission_amount ?? 0)}</td>
                      <td className="px-2 py-2 text-right font-bold text-ink-900">{naira(p.amount)}</td>
                      <td className="px-4 py-2">
                        <Badge tone={p.status === "paid" ? "green" : p.requested_at ? "blue" : isLocked ? "amber" : "green"}>
                          {p.status === "paid" ? "Paid" : p.requested_at ? "Processing" : isLocked ? "Locked 4 days" : "Available"}
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
