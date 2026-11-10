"use client";

import { useState } from "react";

export function Gallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const list = images.length ? images : [];

  if (!list.length) {
    return (
      <div className="aspect-square w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-slate-100 md:aspect-[4/3]">
        <div className="grid h-full place-items-center text-5xl text-slate-300">📦</div>
      </div>
    );
  }

  return (
    <div>
      <div className="aspect-square w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-slate-100 md:aspect-[4/3]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={list[active]} alt={title} className="h-full w-full object-cover" />
      </div>
      {list.length > 1 && (
        <div className="nm-scroll mt-2 flex gap-2 overflow-x-auto">
          {list.map((src, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition ${
                i === active ? "border-brand-500" : "border-transparent opacity-70 hover:opacity-100"
              }`}
              aria-label={`Image ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
