"use client";

import { naira } from "@/lib/utils";

export function SalesChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100;
  const h = 34;
  const pts = data.map((d, i) => {
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = h - (d.value / max) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const area = `0,${h} ${pts.join(" ")} ${w},${h}`;
  const total = data.reduce((n, d) => n + d.value, 0);

  return (
    <div className="mt-2">
      <div className="flex items-baseline gap-2">
        <p className="text-[19px] font-extrabold tracking-tight text-ink-900">{naira(total)}</p>
        <p className="text-[11.5px] text-ink-400">net, 30 days</p>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-1.5 h-24 w-full">
        <defs>
          <linearGradient id="nmfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0B8A3E" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0B8A3E" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#nmfill)" />
        <polyline points={pts.join(" ")} fill="none" stroke="#0B8A3E" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-400">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
