/**
 * A photo shown at its own proportions, with a blurred copy of itself filling
 * the frame behind it.
 *
 * ── The problem this solves ───────────────────────────────────────
 * A service photo is usually wider or taller than the space reserved for it.
 * `object-cover` crops the artwork away; `object-contain` keeps the whole
 * photo but leaves two flat bars, which reads as a broken layout with the
 * image "floating in a box". Earlier attempts filled that leftover space with
 * `background-repeat`, which produced the tiled/looping effect — the same
 * logo badge printed three times across the frame.
 *
 * ── The shape now ─────────────────────────────────────────────────
 *
 *      ┌─────────────────────────────┐
 *      │  blurred copy, scaled to    │  ← `object-cover` + heavy blur,
 *      │  COVER the whole frame      │     so there is no edge and no tile
 *      │   ┌───────────────────┐     │
 *      │   │  the real photo,  │     │  ← `object-contain`, sharp,
 *      │   │  centred, sharp   │     │     never stretched
 *      │   └───────────────────┘     │
 *      └─────────────────────────────┘
 *
 * The blurred layer is the SAME image, absolutely positioned and scaled up
 * slightly (`scale-110`) so the blur's soft edges cannot expose a seam at the
 * frame border. It is `aria-hidden` and carries an empty alt: a screen reader
 * must announce the artwork once, not twice.
 *
 * The sharp copy sets the frame's height. It is `max-h-full`/`max-w-full` with
 * `object-contain`, so a portrait photo cannot widen the page and a panorama
 * cannot make it taller — the layout is still driven by the column, not by the
 * file. `min-w-0` on the frame is what lets it shrink inside a flex or grid
 * column instead of forcing the document wider.
 */
export function BlurredFrame({
  src,
  alt,
  /** Tailwind aspect class for the frame. Defaults to a service-friendly 16:10. */
  aspectClass = "aspect-[16/10]",
  className = "",
  priority = false,
}: {
  src: string;
  alt: string;
  aspectClass?: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div
      className={[
        "relative min-w-0 w-full max-w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-slate-900",
        aspectClass,
        className,
      ].join(" ")}
    >
      {/* blurred duplicate — fills the whole frame, never tiles */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
      />
      {/* a light scrim so a very bright photo does not wash out the edges */}
      <div className="absolute inset-0 bg-black/10" aria-hidden="true" />

      {/* the real photo, centred and sharp */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className="relative block h-full w-full max-h-full max-w-full object-contain"
      />
    </div>
  );
}
