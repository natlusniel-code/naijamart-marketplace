/**
 * A fixed-width frame that any uploaded photo sits inside.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * A seller uploads whatever their camera produced — 3024x4032, 600x800,
 * 4000x600. Letting an image dictate the page's layout is what made the page
 * resize, scroll sideways and (on mobile) force the browser to zoom out. The
 * brief asks for the opposite: one frame with a horizontal, fixed shape, and
 * every photo fitted INSIDE it. The frame's size never depends on the file.
 *
 * ── How it guarantees that ─────────────────────────────────────────────────
 * Three mechanisms, each closing a different hole:
 *
 *   1. `aspect-ratio` on the frame. The frame's height is derived from its
 *      width, so a tall photo cannot make the page taller than the design and
 *      a wide one cannot make it wider.
 *   2. `object-fit: contain`. The photo is scaled to fit inside the frame with
 *      its whole self visible — no cropping, so no quality is lost — and the
 *      leftover space is painted in the frame's own background rather than
 *      stretching the frame.
 *   3. `max-width: 100%` + `min-width: 0` on the frame. Inside a flex or grid
 *      column a child defaults to `min-width: auto`, meaning "never shrink
 *      below my content". That is precisely how one wide upload used to widen
 *      the document. These two rules remove the floor.
 *
 * The image itself is additionally `max-h-full max-w-full`, so even if a
 * browser ignores `aspect-ratio` the photo still cannot exceed its box.
 */

type Ratio = "16/9" | "4/3" | "3/2" | "1/1" | "16/10";

const RATIO_CLASS: Record<Ratio, string> = {
  "16/9": "aspect-[16/9]",
  "4/3": "aspect-[4/3]",
  "3/2": "aspect-[3/2]",
  "1/1": "aspect-square",
  "16/10": "aspect-[16/10]",
};

export function ImageFrame({
  src,
  alt,
  ratio = "4/3",
  /** Fixed width in pixels. Omit to fill the column (still aspect-locked). */
  width,
  className = "",
  frameClassName = "",
  /** `cover` crops to fill (cards); `contain` shows the whole photo (detail). */
  fit = "contain",
  priority = false,
  onError,
}: {
  src: string | null | undefined;
  alt: string;
  ratio?: Ratio;
  width?: number;
  className?: string;
  frameClassName?: string;
  fit?: "cover" | "contain";
  priority?: boolean;
  onError?: () => void;
}) {
  const frameStyle = width
    ? { width: `${width}px`, maxWidth: "100%" }
    : { maxWidth: "100%" };

  return (
    <div
      className={[
        // The frame: a horizontal, fixed shape that cannot be resized by its
        // contents. `min-w-0` is what stops a flex parent being widened.
        "min-w-0 shrink-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-slate-100",
        RATIO_CLASS[ratio],
        className,
      ].join(" ")}
      style={frameStyle}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onError={onError}
          className={[
            // Fill the frame's box exactly, but never exceed it.
            "block h-full w-full max-h-full max-w-full",
            fit === "cover" ? "object-cover" : "object-contain",
            frameClassName,
          ].join(" ")}
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-4xl text-slate-300">
          📦
        </div>
      )}
    </div>
  );
}
