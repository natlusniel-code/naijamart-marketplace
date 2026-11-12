"use client";

import { useState } from "react";

/**
 * The listing image gallery.
 *
 * ── One frame, every photo ────────────────────────────────────────────────
 * Both a product and a service photo are shown inside the SAME fixed
 * horizontal frame (4:3, or 16:9 for a service). The frame's width comes from
 * its column and its height from `aspect-ratio`, so the file's pixel size has
 * no influence on the layout at all — a 4000x600 panorama and a 600x4000
 * portrait both land in exactly the same box.
 *
 * ── What changed, and why ─────────────────────────────────────────────────
 * A service photo used to be shown at its own proportions (`natural` mode,
 * `h-auto w-full`), on the reasoning that the brief wanted the whole picture
 * visible with no quality loss. In practice that let an uploaded image decide
 * the page's layout: a wide upload widened the document, the sticky header's
 * icons were pushed off-screen and the user had to scroll sideways. The brief
 * now asks for the opposite — a fixed frame that the image sits inside — and
 * `object-fit: contain` still shows the WHOLE photo within that frame, so the
 * "no cropping, no quality loss" intent is kept while the layout is protected.
 *
 * `nm-img-fit` is deliberately gone: it sized the image by its own intrinsic
 * aspect, which is exactly the behaviour being replaced.
 */
export function Gallery({
  images,
  title,
  natural = false,
}: {
  images: string[];
  title: string;
  /**
   * Kept for call-site compatibility. Both modes now use the fixed frame; the
   * only difference is the frame's shape (16:9 for a service, 4:3 for goods).
   */
  natural?: boolean;
}) {
  const [active, setActive] = useState(0);
  const list = images.length ? images : [];

  // A service photo is typically wider than a product shot, so its frame is a
  // little wider. Still fixed: the frame's shape never depends on the file.
  const frameRatio = natural ? "aspect-[16/9]" : "aspect-square md:aspect-[4/3]";

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
      <div
        className={`w-full max-w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-slate-100 ${frameRatio}`}
      >
        {/* `contain` keeps the whole photo visible inside the frame — no
            cropping, no quality loss — while the frame itself stays fixed. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={list[active]}
          alt={title}
          loading="eager"
          decoding="async"
          className="block h-full w-full max-h-full max-w-full object-contain"
        />
      </div>
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
