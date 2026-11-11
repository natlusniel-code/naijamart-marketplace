import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { naira, shortDate } from "@/lib/utils";
import { Card, Badge, EmptyState } from "@/components/ui";
import { ReceiptReview } from "@/components/admin/receipt-review";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment verification" };

export default async function AdminPaymentsPage() {
  const supabase = createAdminClient();

  const [{ data: pending }, { data: recent }] = await Promise.all([
    supabase
      .from("payments")
      .select("*, orders(reference,total,status), shops(name,slug), payment_accounts(bank_name,account_number,account_name)")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase
      .from("payments")
      .select("*, orders(reference), shops(name)")
      .in("status", ["verified", "rejected"])
      .order("verified_at", { ascending: false })
      .limit(15),
  ]);

  const orderPays = (pending ?? []).filter((p: any) => p.type === "order");
  const subPays = (pending ?? []).filter((p: any) => p.type === "subscription");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Payment verification</h1>
        <p className="text-[12.5px] text-ink-500">{pending?.length ?? 0} waiting · oldest first</p>
      </div>

      <Card className="p-4">
        <p className="text-[14px] font-bold text-ink-900">Order receipts · {orderPays.length}</p>
        {orderPays.length === 0 ? (
          <p className="mt-1.5 text-[12.5px] text-ink-500">
            No order receipts waiting. Buyers upload one when they submit a checkout — verify it here to move the order to paid, which starts the seller&apos;s 24-hour accept clock.
          </p>
        ) : (
          <div className="mt-2.5 space-y-2.5">
            {orderPays.map((p: any) => (
              <div key={p.id} className="rounded-xl border border-[var(--line)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[11.5px] text-ink-500">
                      {p.orders?.reference ?? p.reference}
                    </p>
                    <p className="text-[13px] font-semibold text-ink-900">{p.shops?.name ?? "—"}</p>
                    <p className="text-[11.5px] text-ink-400">
                      {naira(p.amount)} · uploaded {shortDate(p.created_at)}
                    </p>
                    {/* which account this order was told to pay into (sql/0011) */}
                    <p className="mt-1 text-[11.5px] text-ink-500">
                      {p.payment_accounts ? (
                        <>
                          Paid into{" "}
                          <span className="font-semibold text-ink-700">
                            {p.payment_accounts.bank_name} · {p.payment_accounts.account_number}
                          </span>{" "}
                          <span className="text-ink-400">({p.payment_accounts.account_name})</span>
                        </>
                      ) : (
                        <span className="text-amber-700">No account recorded on this order</span>
                      )}
                    </p>
                  </div>
                  <ReceiptReview
                    paymentId={p.id}
                    receiptUrl={p.receipt_url}
                    kind="order"
                    label={p.orders?.reference ?? p.reference}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <p className="text-[14px] font-bold text-ink-900">Subscription payments · {subPays.length}</p>
        {subPays.length === 0 ? (
          <p className="mt-1.5 text-[12.5px] text-ink-500">No subscription transfers waiting for approval.</p>
        ) : (
          <div className="mt-2.5 space-y-2.5">
            {subPays.map((p: any) => (
              <div key={p.id} className="rounded-xl border border-[var(--line)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-[11.5px] text-ink-500">{p.reference}</p>
                    <p className="text-[13px] font-semibold text-ink-900">{p.shops?.name ?? "—"}</p>
                    <p className="text-[11.5px] text-ink-400">{naira(p.amount)} · {shortDate(p.created_at)}</p>
                  </div>
                  <ReceiptReview paymentId={p.id} receiptUrl={p.receipt_url} kind="subscription" label={p.shops?.name ?? p.reference} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <p className="border-b border-[var(--line)] px-4 py-2.5 text-[14px] font-bold text-ink-900">Recently handled</p>
        {!recent?.length ? (
          <p className="px-4 py-3 text-[12.5px] text-ink-500">Nothing handled yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {recent.map((p: any) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0 truncate text-[12px] text-ink-600">
                  <span className="font-mono text-[11px] text-ink-400">{p.orders?.reference ?? p.reference}</span>{" "}
                  {p.shops?.name}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[12px] font-semibold">{naira(p.amount)}</span>
                  <Badge tone={p.status === "verified" ? "green" : "red"}>{p.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
