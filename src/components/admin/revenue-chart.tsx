"use client";

import { naira } from "@/lib/utils";

export function AdminRevenueChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((n, d) => n + d.value, 0);

  return (
    <div className="mt-2">
      <div className="flex items-baseline gap-2">
        <p className="text-[19px] font-extrabold tracking-tight text-ink-900">{naira(total)}</p>
        <p className="text-[11.5px] text-ink-400">commission, 30 days</p>
      </div>
      <div className="mt-3 flex h-28 items-end gap-[2px]">
        {data.map((d, i) => (
          <div key={i} className="group relative flex-1" title={`${d.label} · ${naira(d.value)}`}>
            <div
              className="w-full rounded-t-[2px] bg-brand-500/85 transition group-hover:bg-brand-600"
              style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-400">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
