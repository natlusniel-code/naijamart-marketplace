"use client";

import { useId } from "react";
import { naira } from "@/lib/utils";

/**
 * Admin commission chart — 30 days, as a bar series.
 *
 * ── What was wrong with the old one ────────────────────────────────────
 * A row of flat green rectangles on a bare card, all the same colour, with
 * no axis, no scale and no hover state that worked on a phone. Every bar
 * looked equally important, so the shape of the month was invisible.
 *
 * ── What this does instead ─────────────────────────────────────────────
 *   - a glass panel matching the seller chart, so the two consoles read as
 *     one product
 *   - bars that fade from pale to solid by height, so the peak stands out
 *     without a legend
 *   - a rounded track behind each bar, so a low day still reads as a day
 *     rather than a gap
 *   - the peak day called out underneath, and the change over the window
 *
 * Bars are drawn with flex + percentage heights rather than SVG: a bar chart
 * is a layout problem, and CSS handles the responsive width for free.
 */
export function AdminRevenueChart({ data }: { data: { label: string; value: number }[] }) {
  const uid = useId().replace(/:/g, "");
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((n, d) => n + d.value, 0);

  const best = data.reduce(
    (a, b) => (b.value > a.value ? b : a),
    data[0] ?? { label: "", value: 0 },
  );

  const third = Math.max(1, Math.floor(data.length / 3));
  const head = data.slice(0, third).reduce((n, d) => n + d.value, 0);
  const tail = data.slice(-third).reduce((n, d) => n + d.value, 0);
  const delta = head > 0 ? Math.round(((tail - head) / head) * 100) : tail > 0 ? 100 : 0;

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-white/60 bg-white/60 p-3 shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_-12px_rgba(16,24,40,.18)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">
            Commission
          </p>
          <p className="mt-0.5 text-[22px] font-extrabold leading-none tracking-tight text-ink-900">
            {naira(total)}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-[10.5px] font-bold ${
            delta >= 0 ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-600"
          }`}
        >
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%
        </span>
      </div>

      <div className="mt-3 flex h-24 items-end gap-[3px]">
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          // Pale for a quiet day, solid for the peak: the gradient is the
          // legend, so no key is needed.
          const opacity = 0.28 + (pct / 100) * 0.72;
          return (
            <div
              key={i}
              className="group relative flex h-full flex-1 items-end rounded-t-[3px] bg-slate-900/[0.035]"
              title={`${d.label} · ${naira(d.value)}`}
            >
              <div
                className="w-full rounded-t-[3px] transition-all duration-300 group-hover:brightness-110"
                style={{
                  height: `${Math.max(3, pct)}%`,
                  background: `linear-gradient(180deg, rgba(18,183,106,${opacity}) 0%, rgba(11,138,62,${opacity}) 100%)`,
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] font-medium text-ink-400">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>

      {best.value > 0 && (
        <p className="mt-1.5 border-t border-[var(--line)] pt-1.5 text-[10.5px] text-ink-500">
          Best day <span className="font-semibold text-ink-800">{best.label}</span> ·{" "}
          {naira(best.value)}
        </p>
      )}
    </div>
  );
}
