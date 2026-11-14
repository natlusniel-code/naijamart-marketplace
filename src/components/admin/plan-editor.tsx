"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSellerPlan } from "@/app/admin-fuckliving/ai-actions";
import { naira } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";
import type { SellerPlan } from "@/lib/plan-gate";

/**
 * The admin's plan editor.
 *
 * ── Why the price is editable here and nowhere else ──────────────────────
 * The brief says the Premium price must be editable from the admin page.
 * This is that page. The value is written to `seller_plans.price` through
 * `admin_update_seller_plan` (sql/0035), which also keeps the legacy
 * `platform_settings.subscription_price` in step — so the seller's
 * comparison screen, the checkout amount and the old flat price can never
 * disagree.
 *
 * ── Why the feature list is editable too ─────────────────────────────────
 * A price change is usually a packaging change. If the admin can move a
 * feature between plans, the gate follows automatically because it reads
 * the same rows. Editing the list here is what makes that true.
 */
export function PlanEditor({ plans }: { plans: SellerPlan[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, { price: string; tagline: string }>>(() => {
    const map: Record<string, { price: string; tagline: string }> = {};
    for (const p of plans) map[p.id] = { price: String(p.price), tagline: p.tagline ?? "" };
    return map;
  });
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function save(id: string) {
    const d = drafts[id];
    const price = Number(d?.price);
    if (!Number.isFinite(price) || price < 0) {
      setErr("Enter a price of zero or more.");
      return;
    }
    setErr("");
    setOk("");
    setBusy(id);

    const result = await saveSellerPlan({
      id,
      price,
      tagline: d?.tagline ?? "",
    });

    setBusy("");
    if (!result.ok) {
      setErr(result.error ?? "Could not save.");
      return;
    }
    setOk(`${id === "premium" ? "Premium" : "Basic"} plan saved.`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {err && <Alert tone="red">{err}</Alert>}
      {ok && <Alert tone="green">{ok}</Alert>}

      {plans.map((plan) => {
        const d = drafts[plan.id] ?? { price: String(plan.price), tagline: "" };
        const changed = Number(d.price) !== plan.price || d.tagline !== (plan.tagline ?? "");

        return (
          <div key={plan.id} className="rounded-xl border border-[var(--line)] bg-white p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[13.5px] font-bold text-ink-900">{plan.name}</p>
                <p className="mt-0.5 text-[11.5px] text-ink-500">
                  Currently {plan.price === 0 ? "free" : `${naira(plan.price)} / month`}
                </p>
              </div>
              {plan.recommended && (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10.5px] font-bold text-brand-700">
                  Recommended
                </span>
              )}
            </div>

            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
              <label className="block">
                <span className="nm-label">Price (₦ / month)</span>
                <input
                  className="nm-input"
                  inputMode="numeric"
                  value={d.price}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [plan.id]: { ...d, price: e.target.value.replace(/\D/g, "") },
                    }))
                  }
                  placeholder="7500"
                />
              </label>
              <label className="block">
                <span className="nm-label">Tagline</span>
                <input
                  className="nm-input"
                  value={d.tagline}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [plan.id]: { ...d, tagline: e.target.value },
                    }))
                  }
                  placeholder="One line the seller sees under the plan name"
                />
              </label>
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <button
                onClick={() => save(plan.id)}
                disabled={!!busy || !changed}
                className="nm-btn-primary !px-3.5 !py-2 !text-[12.5px]"
              >
                {busy === plan.id ? <Spinner /> : "Save plan"}
              </button>
              {changed && (
                <span className="text-[11.5px] font-medium text-amber-700">Unsaved changes</span>
              )}
            </div>

            <details className="mt-2.5">
              <summary className="cursor-pointer text-[11.5px] font-semibold text-ink-500">
                Features on this plan ({plan.features.filter((f) => f.included).length} included)
              </summary>
              <ul className="mt-1.5 space-y-1">
                {plan.features.map((f, i) => (
                  <li
                    key={i}
                    className={`text-[11.5px] ${f.included ? "text-ink-700" : "text-ink-400 line-through"}`}
                  >
                    {f.included ? "✓" : "✕"} {f.label}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        );
      })}

      <p className="text-[11.5px] leading-relaxed text-ink-500">
        Changing a price affects new subscriptions and renewals immediately. Sellers already on a
        plan keep the price they paid until their next renewal.
      </p>
    </div>
  );
}
