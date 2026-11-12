import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { getOrder, getSettings } from "@/lib/queries";
import { naira, shortDate, ORDER_STATUS, ORDER_STEPS, stepIndexFor, cn } from "@/lib/utils";
import { Badge, Card, Alert } from "@/components/ui";
import { UploadReceipt, ConfirmDelivery, RaiseIssue, LeaveReview } from "@/components/order-actions";
import { ChatWithSeller } from "@/components/chat-with-seller";
import { supportWhatsAppUrl } from "@/lib/support";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect(`/signin?next=%2Forders%2F${params.id}`);

  const o: any = await getOrder(params.id);
  if (!o) notFound();
  const settings = await getSettings();

  const isBuyer = o.buyer_id === session.user.id;
  const isSeller = session.shop?.id === o.shop_id;
  if (!isBuyer && !isSeller && !session.isAdmin) notFound();

  const st = ORDER_STATUS[o.status] ?? { label: o.status, tone: "gray" };
  const step = stepIndexFor(o.status, o.fulfilment);
  const steps = o.fulfilment === "pickup"
    ? ["Order placed", "Payment confirmed", "Seller preparing", "Ready for pickup", "Picked up", "Completed"]
    : [...ORDER_STEPS];
  const cancelled = ["cancelled", "disputed"].includes(o.status);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr] lg:items-start">
      <div className="space-y-4">
        <div className="nm-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11.5px] text-ink-400">{o.reference}</p>
              <h1 className="mt-0.5 text-[19px] font-extrabold tracking-tight text-ink-900">
                {isSeller ? `Order from ${o.shops?.name}` : "Order details"}
              </h1>
              <p className="mt-0.5 text-[12.5px] text-ink-500">Placed {shortDate(o.created_at)}</p>
            </div>
            <Badge tone={st.tone as any} dot>{st.label}</Badge>
          </div>

          {/* timeline */}
          {!cancelled ? (
            <ol className="mt-4 space-y-0">
              {steps.map((label, i) => {
                const done = i <= step;
                const current = i === step;
                return (
                  <li key={label} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                          done ? "bg-brand-500 text-white" : "border-2 border-slate-200 bg-white text-transparent",
                          current && "ring-4 ring-brand-500/15",
                        )}
                      >
                        ✓
                      </span>
                      {i < steps.length - 1 && (
                        <span className={cn("my-0.5 h-5 w-0.5", i < step ? "bg-brand-500" : "bg-slate-200")} />
                      )}
                    </div>
                    <p className={cn("-mt-0.5 pb-2 text-[12.5px]", done ? "font-semibold text-ink-900" : "text-ink-400")}>
                      {label}
                      {current && <span className="ml-1.5 text-[11px] font-medium text-brand-600">· current</span>}
                    </p>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="mt-3">
              <Alert tone={o.status === "disputed" ? "red" : "amber"} title={o.status === "disputed" ? "Under review by support" : "Cancelled"}>
                {o.decline_reason ?? "This order is no longer active."}
              </Alert>
            </div>
          )}
        </div>

        {/* items */}
        <div className="nm-card overflow-hidden">
          <p className="border-b border-[var(--line)] px-4 py-2.5 text-[13px] font-bold text-ink-900">
            Items · {o.shops?.name}
          </p>
          <div className="divide-y divide-[var(--line)] px-4">
            {(o.order_items ?? []).map((i: any) => (
              <div key={i.id} className="flex justify-between gap-3 py-2.5">
                <p className="text-[12.5px] text-ink-700">{i.title} <span className="text-ink-400">×{i.quantity}</span></p>
                <p className="shrink-0 text-[12.5px] font-semibold text-ink-900">{naira(i.line_total)}</p>
              </div>
            ))}
          </div>
          <dl className="space-y-1 border-t border-[var(--line)] px-4 py-2.5 text-[12.5px]">
            <div className="flex justify-between"><dt className="text-ink-500">Subtotal</dt><dd>{naira(o.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-500">{o.fulfilment === "pickup" ? "Pickup" : "Delivery"}</dt><dd>{Number(o.delivery_fee) === 0 ? "Free" : naira(o.delivery_fee)}</dd></div>
            <div className="flex justify-between border-t border-[var(--line)] pt-1.5 text-[14px]">
              <dt className="font-bold text-ink-900">Total paid</dt><dd className="font-extrabold text-ink-900">{naira(o.total)}</dd>
            </div>
          </dl>
        </div>

        {/* ledger */}
        <div className="nm-card p-4">
          <p className="text-[13px] font-bold text-ink-900">
            {isSeller ? "Your payout" : "Where your money is"}
          </p>
          <dl className="mt-2 space-y-1.5 text-[12.5px]">
            <div className="flex justify-between"><dt className="text-ink-500">Order value</dt><dd className="font-medium">{naira(o.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-500">NaijaMart commission ({Math.round(Number(o.commission_rate) * 100)}%)</dt><dd className="font-medium text-ink-500">−{naira(o.commission_amount)}</dd></div>
            <div className="flex justify-between border-t border-[var(--line)] pt-1.5"><dt className="font-semibold text-ink-900">{isSeller ? "Net payout" : "Seller receives"}</dt><dd className="font-extrabold text-ink-900">{naira(o.payout_amount)}</dd></div>
            <div className="flex items-center justify-between pt-1">
              <dt className="text-ink-500">Payout status</dt>
              <dd>
                <Badge tone={o.payout_status === "paid" ? "green" : o.payout_status === "released" ? "blue" : "amber"}>
                  {o.payout_status === "paid" ? "Paid out" : o.payout_status === "released" ? "Released — pays in 4 days" : "Held in escrow"}
                </Badge>
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
            {isSeller
              ? "We release this to you 4 days after the buyer confirms. The 5% commission is already taken out."
              : "The seller only gets this after you confirm delivery. Until then it sits in NaijaMart's escrow account."}
          </p>
        </div>
      </div>

      {/* right rail */}
      <div className="space-y-4 lg:sticky lg:top-20">
        {isBuyer && o.status === "pending_payment" && (
          <div className="nm-card p-4">
            <p className="text-[13.5px] font-bold text-ink-900">Payment instructions</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              <dt className="text-ink-500">Bank</dt><dd className="font-semibold">{settings.bank_name}</dd>
              <dt className="text-ink-500">Account</dt><dd className="font-mono font-semibold">{settings.bank_account_number}</dd>
              <dt className="text-ink-500">Name</dt><dd className="font-semibold">{settings.bank_account_name}</dd>
              <dt className="text-ink-500">Amount</dt><dd className="font-semibold">{naira(o.total)}</dd>
              <dt className="text-ink-500">Reference</dt><dd className="font-mono font-bold text-brand-700">{o.reference}</dd>
            </dl>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-500">
              Use the reference so we can match your transfer. Then upload the receipt below.
            </p>
            <div className="mt-2.5">
              <UploadReceipt orderId={o.id} existingUrl={o.receipt_url} />
            </div>
          </div>
        )}

        {isBuyer && ["shipped", "ready_for_pickup"].includes(o.status) && (
          <div className="nm-card p-4">
            <p className="text-[13.5px] font-bold text-ink-900">
              {o.fulfilment === "pickup" ? "Ready to collect" : "On its way"}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
              {o.fulfilment === "pickup"
                ? `Collect from ${o.shops?.name} in ${o.shops?.city}. Confirm once it's in your hands.`
                : "Confirm once you have the item — that starts the seller's payout."}
            </p>
            <div className="mt-2.5">
              <ConfirmDelivery orderId={o.id} pickup={o.fulfilment === "pickup"} />
            </div>
          </div>
        )}

        {isBuyer && ["delivered", "completed"].includes(o.status) && (
          <div className="nm-card p-4">
            <p className="mb-2 text-[13.5px] font-bold text-ink-900">How did it go?</p>
            <LeaveReview orderId={o.id} />
          </div>
        )}

        <div className="nm-card p-4">
          <p className="text-[13.5px] font-bold text-ink-900">Need help?</p>
          <div className="mt-2 space-y-2">
            <ChatWithSeller shopId={o.shop_id} orderId={o.id} signedIn={!!session} label="Chat with seller" />
            {isBuyer && !["completed", "cancelled"].includes(o.status) && (
              <RaiseIssue orderId={o.id} />
            )}
            <a
              href={supportWhatsAppUrl(`Support for order ${o.reference}`)}
              target="_blank"
              rel="noreferrer"
              className="nm-btn-ghost w-full !py-2.5 !text-[13px]"
            >
              Contact support on WhatsApp
            </a>
          </div>
        </div>

        {o.address && (
          <Card className="p-4">
            <p className="text-[13px] font-bold text-ink-900">Delivering to</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">{o.address}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
