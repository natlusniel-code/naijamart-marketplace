import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { getMyOrders } from "@/lib/queries";
import { naira, shortDate, ORDER_STATUS, cn } from "@/lib/utils";
import { Badge, EmptyState, Tabs, Alert } from "@/components/ui";
import { UploadReceipt, ConfirmDelivery, LeaveReview } from "@/components/order-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your orders" };

const TABS = [
  { key: "all", label: "All" },
  { key: "pending_payment", label: "Pending payment" },
  { key: "processing", label: "Processing" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { tab?: string; placed?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/signin?next=%2Forders");

  const tab = searchParams.tab ?? "all";
  const all = await getMyOrders(session.user.id);

  const filtered = all.filter((o: any) => {
    if (tab === "all") return true;
    if (tab === "processing") return ["paid", "accepted", "processing", "ready_for_pickup"].includes(o.status);
    if (tab === "shipped") return o.status === "shipped";
    if (tab === "delivered") return ["delivered", "completed"].includes(o.status);
    return o.status === tab;
  });

  const counts: Record<string, number> = {
    all: all.length,
    pending_payment: all.filter((o: any) => o.status === "pending_payment").length,
    processing: all.filter((o: any) => ["paid", "accepted", "processing", "ready_for_pickup"].includes(o.status)).length,
    shipped: all.filter((o: any) => o.status === "shipped").length,
    delivered: all.filter((o: any) => ["delivered", "completed"].includes(o.status)).length,
    cancelled: all.filter((o: any) => o.status === "cancelled").length,
  };

  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Your orders</h1>

      {searchParams.placed === "1" && (
        <Alert tone="green" title="Order placed — we're checking your receipt">
          As soon as the payment is verified the seller is notified and has 24 hours to accept. Track everything here.
        </Alert>
      )}

      <Tabs items={TABS.map((t) => ({ label: t.label, href: `/orders?tab=${t.key}`, count: counts[t.key] }))} current={`/orders?tab=${tab}`} />

      {filtered.length === 0 ? (
        <EmptyState
          icon="🧾"
          title={tab === "all" ? "No orders yet" : "Nothing in this tab"}
          body="When you buy something, the whole escrow journey shows up here — receipt, seller acceptance, delivery and payouts."
          action="Find something to buy"
          href="/"
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((o: any) => {
            const st = ORDER_STATUS[o.status] ?? { label: o.status, tone: "gray" };
            const items = o.order_items ?? [];
            return (
              <div key={o.id} className="nm-card overflow-hidden">
                <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/shop/${o.shops?.slug}`} className="truncate text-[13px] font-bold text-ink-900 hover:text-brand-600">
                      🏪 {o.shops?.name}
                    </Link>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-400">{o.reference} · {shortDate(o.created_at)}</p>
                  </div>
                  <Badge tone={st.tone as any} dot>{st.label}</Badge>
                </div>

                <div className="px-4 py-2.5">
                  <p className="text-[12.5px] text-ink-600">
                    {items.slice(0, 2).map((i: any) => `${i.title} ×${i.quantity}`).join(", ")}
                    {items.length > 2 && <span className="text-ink-400"> +{items.length - 2} more</span>}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <p className="text-[15px] font-extrabold text-ink-900">{naira(o.total)}</p>
                    <Link href={`/orders/${o.id}`} className="text-[12.5px] font-semibold text-brand-600">Order details →</Link>
                  </div>
                </div>

                {/* the one action that matters right now */}
                <div className="border-t border-[var(--line)] bg-slate-50/50 px-4 py-2.5">
                  {o.status === "pending_payment" && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <UploadReceipt orderId={o.id} existingUrl={o.receipt_url} />
                      <Link href={`/orders/${o.id}`} className="nm-btn-ghost !py-2.5 !text-[12.5px]">See payment details</Link>
                    </div>
                  )}
                  {["shipped", "ready_for_pickup"].includes(o.status) && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <ConfirmDelivery orderId={o.id} pickup={o.fulfilment === "pickup"} />
                      <Link href={`/orders/${o.id}`} className="nm-btn-ghost !py-2.5 !text-[12.5px]">Track order</Link>
                    </div>
                  )}
                  {["delivered", "completed"].includes(o.status) && (
                    <LeaveReview orderId={o.id} />
                  )}
                  {["paid", "accepted", "processing"].includes(o.status) && (
                    <div className="flex items-center gap-2 text-[12px] text-ink-500">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
                      Waiting for {o.shops?.name} to {o.status === "paid" ? "accept" : o.fulfilment === "pickup" ? "prepare" : "ship"} your order
                    </div>
                  )}
                  {o.status === "cancelled" && (
                    <p className="text-[12px] text-ink-500">
                      {o.decline_reason ? `Reason: ${o.decline_reason}` : "This order was cancelled."} Refund is issued to your transfer account.
                    </p>
                  )}
                  {o.status === "disputed" && (
                    <p className="text-[12px] font-medium text-red-700">Support is reviewing this order. We&apos;ll message you.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
