"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { naira, cn } from "@/lib/utils";
import { Spinner } from "@/components/ui";
import type { GigPackage } from "@/lib/queries";

/**
 * The seller's plan editor — Basic / Standard / Premium.
 *
 * ── What a seller can do here ──────────────────────────────────────────
 * Each gig has up to three plans, one per tier (the database enforces the
 * uniqueness, sql/0021). This editor lets the seller:
 *
 *   • edit any existing plan (name, description, price, delivery, features)
 *   • put a plan on sale with a percentage discount, and end the sale again
 *   • delete a plan they no longer offer
 *   • create the plans they are missing
 *
 * ── Why the tier is not editable ───────────────────────────────────────
 * A tier IS the identity of a plan: `order_items.package_tier` stores it and
 * `place_order` looks the plan up by it. Renaming "basic" would orphan every
 * order line that referred to it, so the tier is fixed and the NAME (what the
 * buyer sees) is the editable field.
 *
 * ── Why the price is shown twice ───────────────────────────────────────
 * The list price and the effective price are different numbers once a
 * discount is on, and a seller needs to see what the buyer will actually be
 * charged. The effective price is also a generated column in the database
 * (sql/0023), so what is previewed here is exactly what `place_order` charges.
 */

const TIERS: { tier: "basic" | "standard" | "premium"; label: string; hint: string }[] = [
  { tier: "basic", label: "Basic", hint: "The essentials — the entry price buyers see first" },
  { tier: "standard", label: "Standard", hint: "More scope, a higher price" },
  { tier: "premium", label: "Premium", hint: "Full scope, the highest price" },
];

type Draft = {
  id?: string;
  tier: "basic" | "standard" | "premium";
  name: string;
  description: string;
  price: string;
  discount_percent: string;
  delivery_days: string;
  features: string; // one per line in the textarea
};

function toDraft(p: GigPackage): Draft {
  return {
    id: p.id,
    tier: p.tier,
    name: p.name,
    description: p.description ?? "",
    price: String(p.price ?? ""),
    discount_percent: p.discount_percent != null ? String(p.discount_percent) : "",
    delivery_days: p.delivery_days != null ? String(p.delivery_days) : "",
    features: (p.features ?? []).join("\n"),
  };
}

function emptyDraft(tier: "basic" | "standard" | "premium"): Draft {
  return {
    tier,
    name: tier.charAt(0).toUpperCase() + tier.slice(1),
    description: "",
    price: "",
    discount_percent: "",
    delivery_days: "",
    features: "",
  };
}

/** The price the buyer pays, matching the generated column in sql/0023. */
function effective(d: Draft): number {
  const p = Number(d.price || 0);
  const off = Number(d.discount_percent || 0);
  if (!off || off <= 0) return p;
  return Math.round(p * (1 - off / 100) * 100) / 100;
}

export function PlanEditor({
  listingId,
  initialPackages,
  startingPrice,
  startingDeliveryDays,
}: {
  listingId: string;
  initialPackages: GigPackage[];
  startingPrice: number;
  startingDeliveryDays: number | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<GigPackage[]>(initialPackages);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const map: Record<string, Draft> = {};
    for (const p of initialPackages) map[p.tier] = toDraft(p);
    return map;
  });
  const [openTier, setOpenTier] = useState<string | null>(
    TIERS.find((t) => !initialPackages.some((p) => p.tier === t.tier))?.tier ?? "basic",
  );
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  function draftFor(tier: "basic" | "standard" | "premium"): Draft {
    // A draft exists once the seller has typed, or once the row is loaded.
    // Falling back through `toDraft` here would be wrong for a tier with no
    // row yet: `toDraft` expects a saved package (it calls `.join` on
    // `features`), and an empty draft holds a string there.
    if (drafts[tier]) return drafts[tier];
    const saved = rows.find((p) => p.tier === tier);
    return saved ? toDraft(saved) : emptyDraft(tier);
  }

  function patch(tier: string, key: keyof Draft, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [tier]: { ...(prev[tier] ?? emptyDraft(tier as any)), [key]: value },
    }));
  }

  function validate(d: Draft): string {
    if (!d.name.trim()) return "Give the plan a name.";
    if (!d.price || Number(d.price) <= 0) return "Enter a price above zero.";
    const off = d.discount_percent === "" ? null : Number(d.discount_percent);
    if (off != null && (Number.isNaN(off) || off <= 0 || off > 90)) {
      return "A discount must be between 1% and 90%. Leave it blank for no discount.";
    }
    if (d.delivery_days && (Number(d.delivery_days) < 1 || Number(d.delivery_days) > 365)) {
      return "Delivery days must be between 1 and 365.";
    }
    return "";
  }

  /** Upsert one plan: insert when the tier has no row yet, update otherwise. */
  async function savePlan(tier: "basic" | "standard" | "premium") {
    const d = draftFor(tier);
    const v = validate(d);
    if (v) { setErr(v); return; }
    setErr(""); setNote(""); setBusy(tier);

    const payload = {
      listing_id: listingId,
      tier,
      name: d.name.trim(),
      description: d.description.trim() || null,
      price: Number(d.price),
      // A blank box means NO discount, which is null — not 0, because the
      // check constraint wants null or a positive value.
      discount_percent: d.discount_percent === "" ? null : Number(d.discount_percent),
      delivery_days: d.delivery_days ? Number(d.delivery_days) : null,
      features: d.features
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean),
      sort_order: TIERS.findIndex((t) => t.tier === tier),
    };

    const supabase = createClient();
    const existing = rows.find((p) => p.tier === tier);

    const { data, error } = existing
      ? await supabase.from("gig_packages").update(payload).eq("id", existing.id).select().single()
      : await supabase.from("gig_packages").insert(payload).select().single();

    setBusy("");
    if (error) { setErr(error.message); return; }

    const saved = data as unknown as GigPackage;
    setRows((prev) => {
      const next = prev.filter((p) => p.tier !== tier);
      return [...next, saved].sort((a, b) => a.sort_order - b.sort_order);
    });
    setDrafts((prev) => ({ ...prev, [tier]: toDraft(saved) }));
    setNote(`${saved.name} saved.`);
    setOpenTier(null);
    router.refresh();
  }

  async function deletePlan(tier: "basic" | "standard" | "premium") {
    const existing = rows.find((p) => p.tier === tier);
    if (!existing) return;
    const ok = window.confirm(
      `Delete the ${existing.name} plan? Buyers will no longer be able to order it. Orders already placed keep their price.`,
    );
    if (!ok) return;

    setErr(""); setNote(""); setBusy(tier);
    const supabase = createClient();
    const { error } = await supabase.from("gig_packages").delete().eq("id", existing.id);
    setBusy("");
    if (error) { setErr(error.message); return; }

    setRows((prev) => prev.filter((p) => p.tier !== tier));
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[tier];
      return next;
    });
    setNote(`${existing.name} plan deleted.`);
    setOpenTier(tier);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-bold text-ink-900">Plans &amp; pricing</h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
            Buyers pick one of these three. Add a discount to run a sale —
            the original price stays on the plan, so you can end the sale later.
          </p>
        </div>
      </div>

      {err && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">{err}</p>
      )}
      {note && (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-[12px] font-medium text-brand-800">{note}</p>
      )}

      <div className="space-y-2">
        {TIERS.map((t) => {
          const saved = rows.find((p) => p.tier === t.tier);
          const d = draftFor(t.tier);
          const open = openTier === t.tier;
          const price = Number(saved?.price ?? 0);
          const eff = saved ? Number(saved.effective_price ?? price) : Number(d.price || 0);
          const off = Number(saved?.discount_percent ?? 0);

          return (
            <div
              key={t.tier}
              className={cn(
                "overflow-hidden rounded-xl border bg-white",
                saved ? "border-[var(--line)]" : "border-dashed border-[var(--line)]",
              )}
            >
              <button
                type="button"
                onClick={() => setOpenTier(open ? null : t.tier)}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-slate-50"
                aria-expanded={open}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-[12px] font-bold text-brand-700">
                  {t.label.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-ink-900">
                    {saved ? saved.name : `${t.label} — not offered yet`}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-ink-500">
                    {saved ? (
                      <>
                        {off > 0 ? (
                          <>
                            <span className="text-ink-400 line-through">{naira(price)}</span>{" "}
                            <span className="font-bold text-ink-900">{naira(eff)}</span>{" "}
                            <span className="font-semibold text-red-600">
                              {Number.isInteger(off) ? off : off.toFixed(1)}% off
                            </span>
                          </>
                        ) : (
                          <span className="font-semibold text-ink-800">{naira(price)}</span>
                        )}
                        {saved.delivery_days != null && <> · {saved.delivery_days}-day delivery</>}
                      </>
                    ) : (
                      t.hint
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-brand-600">
                  {open ? "Close" : saved ? "Edit" : "Add"}
                </span>
              </button>

              {open && (
                <div className="space-y-2.5 border-t border-[var(--line)] bg-slate-50/50 px-3.5 py-3">
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <label className="block">
                      <span className="nm-label">Plan name</span>
                      <input
                        className="nm-input"
                        value={d.name}
                        onChange={(e) => patch(t.tier, "name", e.target.value)}
                        placeholder={t.label}
                      />
                    </label>
                    <label className="block">
                      <span className="nm-label">Delivery (days)</span>
                      <input
                        className="nm-input"
                        type="number"
                        min={1}
                        max={365}
                        value={d.delivery_days}
                        onChange={(e) => patch(t.tier, "delivery_days", e.target.value)}
                        placeholder={startingDeliveryDays ? String(startingDeliveryDays) : "3"}
                      />
                    </label>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <label className="block">
                      <span className="nm-label">Price (₦)</span>
                      <input
                        className="nm-input"
                        type="number"
                        min={1}
                        value={d.price}
                        onChange={(e) => patch(t.tier, "price", e.target.value)}
                        placeholder={startingPrice ? String(startingPrice) : "5000"}
                      />
                    </label>
                    <label className="block">
                      <span className="nm-label">
                        Discount % <span className="font-normal text-ink-400">(optional)</span>
                      </span>
                      <input
                        className="nm-input"
                        type="number"
                        min={1}
                        max={90}
                        step="0.5"
                        value={d.discount_percent}
                        onChange={(e) => patch(t.tier, "discount_percent", e.target.value)}
                        placeholder="none"
                      />
                    </label>
                  </div>

                  {/* What the buyer will actually pay, computed the same way
                      the database's generated column does. */}
                  {Number(d.price) > 0 && (
                    <p className="rounded-lg bg-white px-3 py-2 text-[12px] text-ink-600">
                      Buyer pays{" "}
                      <strong className="text-ink-900">{naira(effective(d))}</strong>
                      {Number(d.discount_percent) > 0 && (
                        <>
                          {" "}
                          <span className="text-ink-400 line-through">{naira(Number(d.price))}</span>{" "}
                          <span className="font-semibold text-red-600">
                            save {naira(Number(d.price) - effective(d))}
                          </span>
                        </>
                      )}
                    </p>
                  )}

                  <label className="block">
                    <span className="nm-label">Description</span>
                    <input
                      className="nm-input"
                      value={d.description}
                      onChange={(e) => patch(t.tier, "description", e.target.value)}
                      placeholder="What this tier includes, in a sentence"
                    />
                  </label>

                  <label className="block">
                    <span className="nm-label">
                      Features <span className="font-normal text-ink-400">(one per line)</span>
                    </span>
                    <textarea
                      className="nm-input min-h-[84px] resize-y"
                      value={d.features}
                      onChange={(e) => patch(t.tier, "features", e.target.value)}
                      placeholder={"3 revisions\nSource files included\nPriority support"}
                    />
                  </label>

                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => savePlan(t.tier)}
                      disabled={!!busy}
                      className="nm-btn-primary !px-3.5 !py-2 !text-[12.5px]"
                    >
                      {busy === t.tier ? <Spinner /> : saved ? "Save plan" : "Create plan"}
                    </button>
                    {saved && (
                      <button
                        type="button"
                        onClick={() => deletePlan(t.tier)}
                        disabled={!!busy}
                        className="nm-btn-ghost !px-3.5 !py-2 !text-[12.5px] !text-red-600"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rows.length === 0 && (
        <p className="text-[12px] leading-relaxed text-ink-500">
          With no plans, buyers see a single “starting price” box and have to chat to agree
          the scope. Adding Basic / Standard / Premium is what makes the gig bookable in one tap.
        </p>
      )}
    </div>
  );
}
