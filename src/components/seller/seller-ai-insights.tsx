"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshSellerInsights } from "@/app/admin-fuckliving/ai-actions";
import { Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

type Insight = {
  kind: "insight" | "forecast" | "pricing" | "content" | "alert";
  title: string;
  body: string;
  priority: number;
};

/** The icon and tone per insight kind. */
const KIND_STYLE: Record<
  Insight["kind"],
  { icon: string; ring: string; bg: string }
> = {
  alert: { icon: "⚠️", ring: "ring-red-200", bg: "bg-red-50" },
  pricing: { icon: "₦", ring: "ring-amber-200", bg: "bg-amber-50" },
  forecast: { icon: "📈", ring: "ring-blue-200", bg: "bg-blue-50" },
  content: { icon: "✏️", ring: "ring-slate-200", bg: "bg-slate-50" },
  insight: { icon: "✨", ring: "ring-brand-200", bg: "bg-brand-50" },
};

/**
 * The AI half of seller analytics.
 *
 * ── Why it is a separate block, not more rows ────────────────────────────
 * The table below is per-listing facts. These are shop-level judgements.
 * Putting them in the same table would make them look like the same kind
 * of thing, and they are not: one is "this got 412 views", the other is
 * "this listing is losing you sales and here is why".
 *
 * ── Why there is a refresh button ────────────────────────────────────────
 * Insights are generated on demand and cached. Regenerating them on every
 * page load would be slow and would produce a slightly different answer
 * each refresh, which makes them feel untrustworthy. The button is how the
 * seller asks for fresh reasoning after changing something.
 */
export function SellerAiInsights({
  shopId,
  insights,
}: {
  shopId: string;
  insights: Insight[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [, startTransition] = useTransition();

  async function refresh() {
    setErr("");
    setBusy(true);
    const result = await refreshSellerInsights(shopId);
    setBusy(false);
    if (!result.ok) {
      setErr(result.error ?? "Could not generate insights.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink-900">
            <span aria-hidden>✨</span> AI insights
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-500">
            What your numbers mean, and what to do next.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className="nm-btn-ghost shrink-0 !px-3 !py-1.5 !text-[11.5px]"
        >
          {busy ? <Spinner /> : insights.length ? "Refresh" : "Generate"}
        </button>
      </div>

      {err && (
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
          {err}
        </p>
      )}

      {insights.length === 0 ? (
        <p className="mt-2.5 text-[12px] leading-relaxed text-ink-500">
          No insights yet. They appear once you have some views and orders to analyse — or press
          Generate to try now.
        </p>
      ) : (
        <ul className="mt-2.5 space-y-2">
          {insights.map((x, i) => {
            const style = KIND_STYLE[x.kind] ?? KIND_STYLE.insight;
            return (
              <li
                key={i}
                className={cn(
                  "flex gap-2.5 rounded-xl px-3 py-2.5 ring-1 ring-inset",
                  style.bg,
                  style.ring,
                )}
              >
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/70 text-[11px]">
                  {style.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-bold leading-snug text-ink-900">{x.title}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-600">{x.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
