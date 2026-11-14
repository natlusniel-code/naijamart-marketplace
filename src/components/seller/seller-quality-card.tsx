import { Card, Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { QualityAnalysis } from "@/lib/ai-quality";

/**
 * The seller's quality score.
 *
 * ── Why the components are shown as bars, not just a total ───────────────
 * "72/100" is a grade. "Delivery 40, response 89" is a diagnosis. The bars
 * tell the seller which of the four things is dragging the number down, so
 * the action below it makes sense rather than feeling arbitrary.
 *
 * ── Why the sample size is shown ─────────────────────────────────────────
 * A score built on two reviews is noise, and telling the seller "86/100"
 * without saying it came from two reviews is misleading. The sample count
 * sits next to the score for exactly that reason.
 */
export function SellerQualityCard({
  shopId,
  quality,
}: {
  shopId: string;
  quality: QualityAnalysis | null;
}) {
  if (!quality) {
    return (
      <Card className="p-4">
        <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink-900">
          <span aria-hidden>🎯</span> Seller quality
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
          Your quality score appears once you have a few reviews and delivered orders. It is built
          from your reviews, delivery speed, reply time and cancellation rate.
        </p>
      </Card>
    );
  }

  const c = quality.components;
  const bars = [
    { label: "Reviews", value: c.reviews },
    { label: "Delivery", value: c.delivery },
    { label: "Response", value: c.response },
    { label: "Reliability", value: c.reliability },
  ];

  const tone =
    quality.score >= 80 ? "green" : quality.score >= 60 ? "amber" : "red";
  const label =
    quality.score >= 80 ? "Excellent" : quality.score >= 60 ? "Good" : quality.score >= 40 ? "Needs work" : "At risk";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink-900">
            <span aria-hidden>🎯</span> Seller quality
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-500">
            From {c.sample} review{c.sample === 1 ? "" : "s"} and your delivery record.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[24px] font-extrabold leading-none tracking-tight text-ink-900">
            {quality.score}
            <span className="text-[12px] font-medium text-ink-400">/100</span>
          </p>
          <div className="mt-1">
            <Badge tone={tone as "green" | "amber" | "red"}>{label}</Badge>
          </div>
        </div>
      </div>

      {/* The four components */}
      <div className="mt-3 space-y-1.5">
        {bars.map((b) => (
          <div key={b.label} className="flex items-center gap-2">
            <span className="w-[68px] shrink-0 text-[11px] font-medium text-ink-500">
              {b.label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full rounded-full",
                  b.value >= 80
                    ? "bg-brand-500"
                    : b.value >= 60
                      ? "bg-amber-400"
                      : "bg-red-400",
                )}
                style={{ width: `${Math.max(3, Math.min(100, b.value))}%` }}
              />
            </div>
            <span className="w-7 shrink-0 text-right text-[10.5px] font-semibold text-ink-500">
              {b.value}
            </span>
          </div>
        ))}
      </div>

      {quality.summary && (
        <p className="mt-2.5 rounded-xl bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-ink-700">
          {quality.summary}
        </p>
      )}

      {/* Strengths / risks / actions */}
      <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
        <Column title="Doing well" items={quality.strengths} tone="green" />
        <Column title="Costing you sales" items={quality.risks} tone="amber" />
        <Column title="Do this week" items={quality.actions} tone="brand" />
      </div>
    </Card>
  );
}

function Column({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "green" | "amber" | "brand";
}) {
  if (!items.length) return null;
  const dot =
    tone === "green" ? "bg-brand-500" : tone === "amber" ? "bg-amber-400" : "bg-blue-500";

  return (
    <div className="rounded-xl border border-[var(--line)] px-2.5 py-2">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-ink-400">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((x, i) => (
          <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-ink-700">
            <span className={cn("mt-1 h-1 w-1 shrink-0 rounded-full", dot)} />
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}
