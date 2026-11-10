import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/queries";
import { naira, shortDate } from "@/lib/utils";
import { Card, Badge, Alert, Stat } from "@/components/ui";
import { SubscriptionReceipt } from "@/components/seller/subscription-receipt";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscription" };

export default async function SubscriptionPage() {
  const session = await getSession();
  if (!session?.shop) redirect("/seller/onboarding");

  const settings = await getSettings();
  const supabase = createClient();
  const { data: payments } = await supabase
    .from("payments")
    .select("id,amount,status,receipt_url,created_at,reject_reason,reference")
    .eq("shop_id", session.shop.id)
    .eq("type", "subscription")
    .order("created_at", { ascending: false });

  const shop = session.shop;
  const latest = payments?.[0];
  const price = Number(settings.subscription_price);
  const active = shop.subscription_status === "active";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-[21px] font-extrabold tracking-tight text-ink-900">Subscription</h1>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12.5px] font-semibold text-ink-500">Seller subscription</p>
            <p className="mt-0.5 text-[26px] font-extrabold tracking-tight text-ink-900">
              {naira(price)} <span className="text-[13px] font-medium text-ink-400">/ month</span>
            </p>
          </div>
          <Badge tone={active ? "green" : shop.subscription_status === "pending" ? "amber" : "red"} dot>
            {active ? "Active" : shop.subscription_status === "pending" ? "Awaiting verification" : "Inactive"}
          </Badge>
        </div>

        <dl className="mt-3 grid gap-2 text-[12.5px] sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-[11px] text-ink-400">Renewal date</dt>
            <dd className="font-semibold text-ink-900">{shop.subscription_expires_at ? shortDate(shop.subscription_expires_at) : "—"}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-[11px] text-ink-400">First payment</dt>
            <dd className="font-semibold text-ink-900">
              {shop.subscription_status === "none" && !latest ? "Deducted from first payout" : "Paid by transfer"}
            </dd>
          </div>
        </dl>

        <ul className="mt-3 space-y-1 text-[12.5px] text-ink-600">
          <li>✓ Unlimited products and services</li>
          <li>✓ Orders from buyers in your city</li>
          <li>✓ Payouts within 24–48 hours of delivery</li>
          <li>✓ 5% commission per order, nothing else</li>
        </ul>
      </Card>

      {latest && latest.status === "rejected" && (
        <Alert tone="red" title="Your last payment was rejected">
          {latest.reject_reason ?? "We couldn't match your transfer."} Please re-upload the receipt or contact support.
        </Alert>
      )}

      {latest?.status === "pending" && (
        <Alert tone="amber" title="We're checking your receipt">
          Submitted {shortDate(latest.created_at)}. This usually takes under 24 hours.
        </Alert>
      )}

      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Renew now</p>
        <p className="mt-0.5 text-[12.5px] text-ink-500">Transfer {naira(price)} and upload the receipt — we activate it on verification.</p>

        <div className="mt-2.5 rounded-xl border border-[var(--line)] p-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-ink-500">Bank</dt><dd className="font-semibold">{settings.bank_name}</dd>
            <dt className="text-ink-500">Account</dt><dd className="font-mono font-semibold">{settings.bank_account_number}</dd>
            <dt className="text-ink-500">Name</dt><dd className="font-semibold">{settings.bank_account_name}</dd>
            <dt className="text-ink-500">Amount</dt><dd className="font-semibold">{naira(price)}</dd>
            <dt className="text-ink-500">Reference</dt><dd className="font-mono font-bold text-brand-700">SUB-{shop.id.slice(0, 6).toUpperCase()}</dd>
          </dl>
        </div>

        <p className="mt-2.5 rounded-xl bg-brand-50 px-3 py-2 text-[11.5px] leading-relaxed text-brand-900">
          New seller? Your first {naira(price)} can be taken from your first payout instead of paying now — tell support on WhatsApp after your first sale.
        </p>

        <div className="mt-3">
          <SubscriptionReceipt shopId={shop.id} price={price} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <p className="border-b border-[var(--line)] px-4 py-2.5 text-[13.5px] font-bold text-ink-900">Payment history</p>
        {!payments?.length ? (
          <p className="px-4 py-3 text-[12.5px] text-ink-500">No subscription payments yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {payments.map((p: any) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-ink-400">{p.reference}</p>
                  <p className="text-[11.5px] text-ink-500">{shortDate(p.created_at)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[12.5px] font-bold">{naira(p.amount)}</span>
                  <Badge tone={p.status === "verified" ? "green" : p.status === "rejected" ? "red" : "amber"}>
                    {p.status === "verified" ? "Verified" : p.status === "rejected" ? "Rejected" : "Pending"}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
