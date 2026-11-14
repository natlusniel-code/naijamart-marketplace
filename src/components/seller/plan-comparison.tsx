"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { naira, cn } from "@/lib/utils";
import { Spinner, Badge } from "@/components/ui";
import type { SellerPlan, PlanId } from "@/lib/plan-gate";

/**
 * The plan comparison and the upgrade action.
 *
 * ── Why both plans are always shown ──────────────────────────────────────
 * The brief is explicit: when a seller wants to subscribe, show all the
 * features included in BOTH plans. A seller who only sees the plan they
 * are being sold cannot tell whether the cheaper one is enough, and a
 * seller on Basic cannot see what they are missing. So the two cards are
 * always side by side, with every feature listed on both and the ones the
 * plan does not include struck through rather than hidden.
 *
 * ── Why the price comes from the server ──────────────────────────────────
 * `plans` is passed in from the page, which read it from `seller_plans`.
 * The admin edits that row, so the number here is whatever the admin set —
 * never a constant in this file.
 */
export function PlanComparison({
  plans,
  currentPlan,
  currentStatus,
  highlight,
}: {
  plans: SellerPlan[];
  currentPlan: PlanId;
  currentStatus: "none" | "pending" | "active" | "expired";
  /** Which card to draw attention to, from the query string. */
  highlight?: "upgrade" | "renew" | "pending" | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<PlanId | "">("");
  const [err, setErr] = useState("");
  const [chosen, setChosen] = useState<PlanId | null>(null);

  async function choose(plan: PlanId) {
    setErr("");
    setBusy(plan);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("choose_seller_plan", { p_plan: plan });
    setBusy("");

    if (error) {
      setErr(error.message);
      return;
    }
    setChosen(plan);
    router.refresh();
  }

  if (chosen) {
    const plan = plans.find((p) => p.id === chosen);
    return (
      <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
        <p className="text-[13.5px] font-bold text-brand-900">
          {plan?.name} selected — {naira(plan?.price ?? 0)}/month
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-brand-800">
          Transfer the amount using the reference below and upload the receipt. We activate your
          plan as soon as an admin verifies it — usually under 24 hours.
        </p>
        <button
          onClick={() => router.push("/seller/subscription")}
          className="nm-btn-primary mt-3 !py-2.5"
        >
          Continue to payment
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {err && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">{err}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlan && currentStatus === "active";
          const isPremium = plan.id === "premium";
          const emphasised =
            (highlight === "upgrade" && isPremium) ||
            (highlight === "renew" && isCurrent) ||
            plan.recommended;

          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-2xl border bg-white",
                emphasised ? "border-brand-400 shadow-lift" : "border-[var(--line)]",
              )}
            >
              {plan.recommended && (
                <div className="bg-brand-600 px-3 py-1 text-center text-[10.5px] font-bold uppercase tracking-wide text-white">
                  Most popular
                </div>
              )}

              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[15px] font-extrabold tracking-tight text-ink-900">
                      {plan.name}
                    </p>
                    {plan.tagline && (
                      <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
                        {plan.tagline}
                      </p>
                    )}
                  </div>
                  {isCurrent && <Badge tone="green" dot>Current</Badge>}
                </div>

                <p className="mt-3 text-[26px] font-extrabold tracking-tight text-ink-900">
                  {plan.price === 0 ? "Free" : naira(plan.price)}
                  {plan.price > 0 && (
                    <span className="text-[12px] font-medium text-ink-400"> / month</span>
                  )}
                </p>

                <ul className="mt-3 space-y-1.5">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] leading-snug">
                      {f.included ? (
                        <svg
                          viewBox="0 0 20 20"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.4}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m4 10.5 4 4 8-9" />
                        </svg>
                      ) : (
                        <svg
                          viewBox="0 0 20 20"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.2}
                          strokeLinecap="round"
                        >
                          <path d="M5 5l10 10M15 5L5 15" />
                        </svg>
                      )}
                      <span className={f.included ? "text-ink-700" : "text-ink-400 line-through"}>
                        {f.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-auto border-t border-[var(--line)] p-3">
                {isCurrent ? (
                  <button
                    disabled
                    className="nm-btn-ghost w-full !py-2.5 !text-[12.5px]"
                  >
                    Your current plan
                  </button>
                ) : (
                  <button
                    onClick={() => choose(plan.id)}
                    disabled={!!busy}
                    className={cn(
                      "w-full !py-2.5 !text-[12.5px]",
                      emphasised ? "nm-btn-primary" : "nm-btn-ghost",
                    )}
                  >
                    {busy === plan.id ? (
                      <Spinner />
                    ) : plan.price === 0 ? (
                      "Switch to Basic"
                    ) : currentStatus === "active" ? (
                      `Upgrade to ${plan.name}`
                    ) : (
                      `Choose ${plan.name}`
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11.5px] leading-relaxed text-ink-500">
        Every seller feature is included in a paid plan. You can change plan at any time — the
        difference is charged from your next renewal, never twice for the same month.
      </p>
    </div>
  );
}
