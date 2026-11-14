import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/queries";
import { naira, shortDate } from "@/lib/utils";
import { Card, Badge, Alert, Stat } from "@/components/ui";
import { SubscriptionReceipt } from "@/components/seller/subscription-receipt";
import { PlanComparison } from "@/components/seller/plan-comparison";
import { SupportLink } from "@/components/support-link";
import { getSellerPlans, subscriptionState } from "@/lib/plan-gate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscription" };

type SP = { upgrade?: string; renew?: string; pending?: string };

/**
 * The seller's subscription page.
 *
 * ── What changed and why ─────────────────────────────────────────────────
 * This page used to show ONE flat price and a single "renew" box. Now there
 * are two plans, so the page has to do three jobs:
 *
 *   1. show the seller where they stand (active / pending / lapsed / none)
 *   2. show BOTH plans with every feature, so the choice is informed
 *   3. take the payment for whichever plan they pick
 *
 * The price is read from `seller_plans`, which the admin edits — so the
 * number on this page is whatever the admin set, not a constant.
 */
export default async function SubscriptionPage({ searchParams }: { searchParams: SP }) {
  const session = await getSession();
  if (!session?.shop) redirect("/seller/onboarding");

  const shop = session.shop;
  const settings = await getSettings();
  const supabase = createClient();

  const [plans, { data: payments }] = await Promise.all([
    getSellerPlans(),
    supabase
      .from("payments")
      .select("id,amount,status,receipt_url,created_at,reject_reason,reference")
      .eq("shop_id", shop.id)
      .eq("type", "subscription")
      .order("created_at", { ascending: false }),
  ]);

  const state = subscriptionState(shop);
  const currentPlan = plans.find((p) => p.id === state.plan) ?? plans[0];
  const latest = payments?.[0];

  // The amount to transfer is the plan they have chosen. A seller who has
  // not chosen yet sees the Premium price, because that is the plan the
  // comparison recommends.
  const payable = currentPlan?.price ?? Number(settings.subscription_price);

  const highlight =
    searchParams.upgrade === "1"
      ? "upgrade"
      : searchParams.renew === "1"
        ? "renew"
        : searchParams.pending === "1"
          ? "pending"
          : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-[21px] font-extrabold tracking-tight text-ink-900">Subscription</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          Every seller feature is included in a plan. Pick the one that fits your shop.
        </p>
      </div>

      {/* ── Where the seller stands ─────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12.5px] font-semibold text-ink-500">Your plan</p>
            <p className="mt-0.5 text-[22px] font-extrabold tracking-tight text-ink-900">
              {currentPlan?.name ?? "No plan"}
              {state.active && (
                <span className="ml-2 text-[13px] font-medium text-ink-400">
                  {naira(currentPlan?.price ?? 0)} / month
                </span>
              )}
            </p>
          </div>
          <Badge
            tone={
              state.active ? "green" : state.status === "pending" ? "amber" : "red"
            }
            dot
          >
            {state.active
              ? "Active"
              : state.status === "pending"
                ? "Awaiting verification"
                : state.status === "expired"
                  ? "Expired"
                  : "Inactive"}
          </Badge>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-[11px] text-ink-400">Renewal date</p>
            <p className="text-[12.5px] font-semibold text-ink-900">
              {state.expiresAt ? shortDate(state.expiresAt) : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-[11px] text-ink-400">Days left</p>
            <p className="text-[12.5px] font-semibold text-ink-900">
              {state.active && state.daysLeft != null ? state.daysLeft : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-[11px] text-ink-400">Payment</p>
            <p className="text-[12.5px] font-semibold text-ink-900">
              {state.status === "none" && !latest ? "Not paid yet" : "By transfer"}
            </p>
          </div>
        </div>

        {!state.active && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
            {state.status === "pending"
              ? "Your receipt is with an admin. Your features turn on as soon as it is verified."
              : state.status === "expired"
                ? "Your subscription has lapsed. Renew to turn your seller features back on."
                : "Choose a plan below to unlock your seller features."}
          </p>
        )}
      </Card>

      {/* ── Both plans, every feature ───────────────────────────────── */}
      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Choose a plan</p>
        <p className="mt-0.5 mb-3 text-[12px] leading-relaxed text-ink-500">
          Both plans are shown in full so you can see exactly what you get.
        </p>
        <PlanComparison
          plans={plans}
          currentPlan={state.plan}
          currentStatus={state.status}
          highlight={highlight}
        />
      </Card>

      {/* ── Payment ─────────────────────────────────────────────────── */}
      {latest && latest.status === "rejected" && (
        <Alert tone="red" title="Your last payment was rejected">
          {latest.reject_reason ?? "We couldn't match your transfer."} Please re-upload the receipt
          or <SupportLink className="!text-red-700">contact support</SupportLink>.
        </Alert>
      )}

      {latest?.status === "pending" && (
        <Alert tone="amber" title="We're checking your receipt">
          Submitted {shortDate(latest.created_at)}. This usually takes under 24 hours.
        </Alert>
      )}

      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Pay by transfer</p>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          Transfer {naira(payable)} and upload the receipt — we activate it on verification.
        </p>

        <div className="mt-2.5 rounded-xl border border-[var(--line)] p-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-ink-500">Bank</dt>
            <dd className="font-semibold">{settings.bank_name}</dd>
            <dt className="text-ink-500">Account</dt>
            <dd className="font-mono font-semibold">{settings.bank_account_number}</dd>
            <dt className="text-ink-500">Name</dt>
            <dd className="font-semibold">{settings.bank_account_name}</dd>
            <dt className="text-ink-500">Amount</dt>
            <dd className="font-semibold">{naira(payable)}</dd>
            <dt className="text-ink-500">Reference</dt>
            <dd className="font-mono font-bold text-brand-700">
              SUB-{shop.id.slice(0, 6).toUpperCase()}
            </dd>
          </dl>
        </div>

        <div className="mt-3">
          <SubscriptionReceipt shopId={shop.id} price={payable} />
        </div>
      </Card>

      {/* ── History ─────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <p className="border-b border-[var(--line)] px-4 py-2.5 text-[13.5px] font-bold text-ink-900">
          Payment history
        </p>
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
                  <Badge
                    tone={
                      p.status === "verified" ? "green" : p.status === "rejected" ? "red" : "amber"
                    }
                  >
                    {p.status === "verified"
                      ? "Verified"
                      : p.status === "rejected"
                        ? "Rejected"
                        : "Pending"}
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
