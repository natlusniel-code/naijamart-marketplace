"use client";

import { useState } from "react";

/**
 * The listing image gallery.
 *
 * ── Two shapes, on purpose ────────────────────────────────────────────────
 * A PRODUCT photo is shown in a fixed square (4:3 on desktop) frame and
 * cropped to fill it, which is what makes a grid of product cards line up.
 *
 * A SERVICE photo is shown at its OWN proportions instead. Service photos
 * are required to be horizontal (enforced in the seller form), and the brief
 * is explicit that the buyer must see the image at its original size so it
 * does not lose quality. Cropping a wide photo into a square frame is
 * exactly that quality loss, so a gig uses `natural` mode: the frame takes
 * the image's own aspect ratio, the whole picture is visible, and nothing is
 * upscaled beyond the width it was uploaded at.
 */
export function Gallery({
  images,
  title,
  natural = false,
}: {
  images: string[];
  title: string;
  /** Show each image at its own aspect ratio instead of cropping to a frame. */
  natural?: boolean;
}) {
  const [active, setActive] = useState(0);
  const list = images.length ? images : [];

  if (!list.length) {
    return (
      <div
        className={`w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-slate-100 ${
          natural ? "aspect-[16/10]" : "aspect-square md:aspect-[4/3]"
        }`}
      >
        <div className="grid h-full place-items-center text-5xl text-slate-300">📦</div>
      </div>
    );
  }

  return (
    <div>
      <div
        className={`w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-slate-100 ${
          natural ? "" : "aspect-square md:aspect-[4/3]"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={list[active]}
          alt={title}
          className={natural ? "block h-auto w-full" : "h-full w-full object-cover"}
        />
      </div>
      {list.length > 1 && (
        <div className="nm-scroll mt-2 flex gap-2 overflow-x-auto">
          {list.map((src, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`shrink-0 overflow-hidden rounded-xl border-2 transition ${
                natural ? "h-14 w-24" : "h-16 w-16"
              } ${i === active ? "border-brand-500" : "border-transparent opacity-70 hover:opacity-100"}`}
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
