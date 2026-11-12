"use client";

import { useId } from "react";
import { naira } from "@/lib/utils";

/**
 * Seller sales chart — 30 days of net revenue.
 *
 * ── What was wrong with the old one ────────────────────────────────────
 * A single flat polyline on a bare white card: no grid, no scale, no
 * indication of which day was which, and a gradient that faded to nothing
 * so the line appeared to float. It read as a placeholder rather than a
 * chart, and a seller could not tell a good week from a bad one at a glance.
 *
 * ── What this does instead ─────────────────────────────────────────────
 *   - a soft glass panel, so it sits on the canvas without a hard border
 *   - horizontal gridlines with a labelled peak, so the height means
 *     something
 *   - a smooth curve (Catmull-Rom → cubic Bézier) rather than straight
 *     segments, which reads as a trend instead of a zigzag
 *   - a marker on the best day, because that is the number a seller looks
 *     for first
 *   - the total and the change, so the chart has a headline
 *
 * The curve is generated in viewBox units and the SVG is stretched with
 * `preserveAspectRatio="none"`; `vectorEffect="non-scaling-stroke"` keeps
 * the line an even weight despite that stretch.
 */
export function SalesChart({ data }: { data: { label: string; value: number }[] }) {
  const uid = useId().replace(/:/g, "");
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((n, d) => n + d.value, 0);

  const w = 100;
  const h = 40;
  const pad = 3;

  const pts = data.map((d, i) => {
    const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * w;
    const y = h - pad - (d.value / max) * (h - pad * 2);
    return { x, y, v: d.value, label: d.label };
  });

  /** Catmull-Rom through the points, emitted as cubic Béziers. */
  const curve = (() => {
    if (pts.length < 2) return "";
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  })();

  const area = curve ? `${curve} L ${w} ${h} L 0 ${h} Z` : "";

  // The best day, for the marker and the caption.
  const best = pts.reduce((a, b) => (b.v > a.v ? b : a), pts[0] ?? { x: 0, y: 0, v: 0, label: "" });

  // Change over the window: last third vs the first third, which is more
  // honest than "last day vs first day" on a noisy series.
  const third = Math.max(1, Math.floor(data.length / 3));
  const head = data.slice(0, third).reduce((n, d) => n + d.value, 0);
  const tail = data.slice(-third).reduce((n, d) => n + d.value, 0);
  const delta = head > 0 ? Math.round(((tail - head) / head) * 100) : tail > 0 ? 100 : 0;

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-white/60 bg-white/60 p-3 shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_-12px_rgba(16,24,40,.18)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">
            Net revenue
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

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="h-24 w-full"
          role="img"
          aria-label={`Net revenue over the last 30 days, total ${naira(total)}`}
        >
          <defs>
            <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0B8A3E" stopOpacity="0.28" />
              <stop offset="70%" stopColor="#0B8A3E" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#0B8A3E" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`line-${uid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#0B8A3E" stopOpacity="0.55" />
              <stop offset="55%" stopColor="#0B8A3E" />
              <stop offset="100%" stopColor="#12B76A" />
            </linearGradient>
          </defs>

          {/* gridlines — three, so the eye can judge height without clutter */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              x2={w}
              y1={h - pad - f * (h - pad * 2)}
              y2={h - pad - f * (h - pad * 2)}
              stroke="#0F172A"
              strokeOpacity="0.06"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {area && <path d={area} fill={`url(#fill-${uid})`} />}
          {curve && (
            <path
              d={curve}
              fill="none"
              stroke={`url(#line-${uid})`}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Best day marker — positioned in percentages so it tracks the
            stretched SVG without a second coordinate system. */}
        {best.v > 0 && (
          <span
            className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-600 ring-2 ring-white"
            style={{
              left: `${(best.x / w) * 100}%`,
              top: `${(best.y / h) * 100}%`,
            }}
            aria-hidden="true"
          />
        )}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] font-medium text-ink-400">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>

      {best.v > 0 && (
        <p className="mt-1.5 border-t border-[var(--line)] pt-1.5 text-[10.5px] text-ink-500">
          Best day <span className="font-semibold text-ink-800">{best.label}</span> ·{" "}
          {naira(best.v)}
        </p>
      )}
    </div>
  );
}
