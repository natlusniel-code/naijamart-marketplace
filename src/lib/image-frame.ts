/**
 * The one product-photo frame.
 *
 * ── Why this is a module and not a class string in two files ──────────────
 * The seller's upload tile and the buyer's product preview used to be written
 * independently: the upload tile was a 64×64 square, while the storefront
 * preview was `aspect-square` on a phone but widened to `aspect-[4/3]` from
 * `md` up. The same photo therefore had two different shapes depending on who
 * was looking at it, and the buyer's copy cropped the edges off with
 * `object-cover`.
 *
 * Both sides now import these constants, so the frame cannot drift again: one
 * square, at every breakpoint, with the whole photo fitted inside it.
 *
 * ── Why `contain` and not `cover` ─────────────────────────────────────────
 * The brief is explicit: an uploaded image must be shown IN FULL inside a
 * fixed frame. `object-cover` fills the frame by cropping whatever does not
 * fit, which is exactly the quality loss being reported. `object-contain`
 * scales the photo down until all of it is visible and paints the leftover
 * space in the frame's own background, so the frame stays the same size no
 * matter what the seller uploaded.
 */

/** The frame's aspect ratio, as a CSS `aspect-ratio` value. */
export const PRODUCT_FRAME_RATIO = "1 / 1";

/** The same ratio as a Tailwind class, for the frame element. */
export const PRODUCT_FRAME_ASPECT = "aspect-square";

/** How a photo sits inside the frame: whole photo, never cropped. */
export const PRODUCT_FRAME_FIT = "object-contain";

/** The seller's upload tile, in pixels. Square, to match the frame above. */
export const PRODUCT_TILE_SIZE = 64;
