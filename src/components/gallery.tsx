"use client";

import { useState } from "react";
import { BlurredFrame } from "@/components/blurred-frame";

/**
 * The listing image gallery.
 *
 * ── One frame, every photo ────────────────────────────────────────
 * The frame's width comes from its column and its height from
 * `aspect-ratio`, so a 4000x600 panorama and a 600x4000 portrait both land in
 * exactly the same box. The file's pixel size never influences the layout —
 * that was the original bug, where one wide upload widened the whole document
 * and pushed the sticky header's icons off-screen.
 *
 * ── Service photos ────────────────────────────────────────────────
 * A gig is shown through `BlurredFrame`: the artwork is never cropped, and
 * the space it does not fill is covered by a blurred copy of itself instead
 * of flat bars or a repeating tile. See that component for why.
 *
 * A product photo stays in the plain frame with `object-cover`: goods are
 * photographed to fill a square, and a blurred surround would be decoration
 * on a thumbnail that is already the right shape.
 */
export function Gallery({
  images,
  title,
  natural = false,
}: {
  images: string[];
  title: string;
  /** Service mode: blurred surround + 16:10, instead of a square product crop. */
  natural?: boolean;
}) {
  const [active, setActive] = useState(0);
  const list = images.length ? images : [];

  const frameRatio = natural
    ? "aspect-[16/10]"
    : "aspect-square md:aspect-[4/3]";

  if (!list.length) {
    return (
      <div
        className={`w-full max-w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-slate-100 ${frameRatio}`}
      >
        <div className="grid h-full place-items-center text-5xl text-slate-300">📦</div>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full">
      {natural ? (
        <BlurredFrame
          src={list[active]}
          alt={title}
          aspectClass={frameRatio}
          priority
        />
      ) : (
        <div
          className={`w-full max-w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-slate-100 ${frameRatio}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={list[active]}
            alt={title}
            loading="eager"
            decoding="async"
            className="block h-full w-full max-h-full max-w-full object-cover"
          />
        </div>
      )}

      {list.length > 1 && (
        <div className="nm-scroll mt-2 flex max-w-full gap-2 overflow-x-auto">
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
              <img
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
