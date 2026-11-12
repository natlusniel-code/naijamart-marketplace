"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeLoader, resetLoader, type LoaderState } from "@/lib/global-loader";

/**
 * The one global loading overlay for the whole site.
 *
 * Rendered once in the root layout, so every route — storefront, seller hub,
 * admin console, auth pages — gets it without any page opting in.
 *
 * ── Design ───────────────────────────────────────────────────────────────
 * The centre is the NaijaMart app icon (the same artwork as the favicon), with
 * a thin two-tone green ring spinning around it and a soft green glow beneath.
 * Sizes are 88px on desktop and 72px on mobile, with the ring a little larger
 * than the icon. Everything is CSS — no image spinner, no blue.
 *
 * ── Accessibility ────────────────────────────────────────────────────────
 * The overlay is `role="status"` with `aria-live="polite"` and `aria-busy`, so
 * a screen reader announces the loading text once rather than on every frame.
 * The spinner itself is `aria-hidden` — it carries no information.
 *
 * ── Why `pointer-events` is conditional ──────────────────────────────────
 * A navigation must block a second click (the brief asks for it, and a double
 * click on "Checkout" would otherwise create two orders). A background data
 * refresh must not: the user should still be able to scroll and tap while a
 * list reloads. `blocking` comes from the store.
 */
export function GlobalLoader() {
  const [s, setS] = useState<LoaderState>({
    visible: false,
    fading: false,
    failed: false,
    label: "Loading...",
    blocking: false,
  });

  useEffect(() => subscribeLoader(setS), []);

  if (!s.visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={!s.fading}
      aria-label={s.failed ? "Loading failed" : s.label}
      className={[
        // Highest layer on the site: above the sticky header (z-30), the
        // install toast (z-40) and the mobile tab bar.
        "fixed inset-0 z-[9999] flex items-center justify-center",
        // Semi-transparent white: the page stays faintly visible, so the user
        // keeps their bearings instead of staring at a blank screen.
        //
        // Deliberately NOT `backdrop-blur`. A backdrop filter over the whole
        // viewport forces the compositor to re-blur everything underneath on
        // every frame the overlay is up — on a mid-range phone that alone is
        // enough to make the page feel like it has frozen, which is the
        // opposite of what a loading indicator is for. A flat translucent
        // white gives the same "the site is busy" signal at a fraction of the
        // cost.
        "bg-white/80",
        // Fade in fast, fade out over 200ms.
        "transition-opacity duration-200",
        s.fading ? "opacity-0" : "opacity-100",
        // `failed` must accept clicks too. The timeout sets `blocking: false`
        // so the user is not trapped behind a dead overlay — but that also
        // made the overlay `pointer-events-none`, which is why the Retry
        // button did nothing: the click passed straight through to the page
        // underneath and the button was never hit. The retry panel is the one
        // thing that MUST be clickable when the load has failed.
        s.blocking || s.failed ? "pointer-events-auto" : "pointer-events-none",
      ].join(" ")}
      // ── Scroll must never be a casualty of the overlay ───────────────────
      //
      // This used to set `touch-action: none` while blocking. A blocking
      // overlay that stayed mounted (see the wishlist-heart bug) therefore
      // also killed every touch scroll for the rest of the session — the
      // "will not scroll at all" report. `touch-action` is now left alone:
      // the overlay still swallows CLICKS (they land on it, not the link
      // underneath), while a drag or wheel still chains through to the
      // document and scrolls the page as normal.
      style={{ overscrollBehavior: "auto" }}
    >
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        {s.failed ? (
          <RetryPanel />
        ) : (
          <>
            <Spinner />
            <p className="text-[13.5px] font-semibold text-ink-700">{s.label}</p>
          </>
        )}
      </div>
    </div>
  );
}

/** The icon + spinning ring. */
function Spinner() {
  return (
    <div className="relative grid place-items-center">
      {/* Soft green glow under the icon. */}
      <span
        aria-hidden
        className="nm-loader-glow absolute h-[92px] w-[92px] rounded-[26px] sm:h-[108px] sm:w-[108px] sm:rounded-[30px]"
      />

      {/* The ring: a conic gradient masked to a thin circle, so one arc is
          solid brand green and the rest fades out — the two-tone sweep in the
          brief. Masking (rather than an SVG dash) keeps it perfectly smooth at
          any size and lets the gradient do the fading. */}
      <span
        aria-hidden
        className="nm-loader-ring absolute h-[92px] w-[92px] rounded-full sm:h-[108px] sm:w-[108px]"
      />

      {/* The app icon — the same artwork as the favicon. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon-192.png"
        alt=""
        width={88}
        height={88}
        className="nm-loader-icon relative h-[72px] w-[72px] rounded-[20px] shadow-[0_6px_18px_rgba(11,138,62,0.28)] sm:h-[88px] sm:w-[88px] sm:rounded-[24px]"
      />
    </div>
  );
}

/** Shown after 30s: the load is not coming back, so offer a reload. */
function RetryPanel() {
  const router = useRouter();

  /**
   * Retry the page that failed, in place.
   *
   * `window.location.reload()` was the old handler and it is the wrong tool:
   * a full reload throws away the client router, the cart in memory and any
   * scroll position, and on a slow connection it re-downloads the whole app
   * just to retry one route. `router.refresh()` re-runs the server components
   * for the current URL, which is exactly the work that timed out.
   *
   * `resetLoader()` runs FIRST so the overlay is torn down before the refresh
   * starts — otherwise the stale `failed` state would still be on screen and
   * the user would see the retry panel over the page they just retried.
   */
  function retry() {
    resetLoader();
    router.refresh();
  }

  return (
    <div className="max-w-[300px] rounded-2xl border border-[var(--line)] bg-white px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.14)]">
      <p className="text-[14px] font-bold text-ink-900">This is taking too long</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
        The page didn&apos;t finish loading. Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={retry}
        className="nm-btn-primary mt-3 w-full !py-2 !text-[13px]"
      >
        Retry
      </button>
    </div>
  );
}
