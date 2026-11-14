"use client";

import { useState } from "react";
import { canGeolocate, geolocationErrorMessage, getCurrentCoords, pinUrl } from "@/lib/geo";

/**
 * "Share My Location" — the footer button.
 *
 * ── What it does ──────────────────────────────────────────────────────
 * On click (and only on click) it asks the browser for one position fix and
 * opens Google Maps at that point in a new tab. Nothing is uploaded, stored
 * or sent to NaijaMart: the coordinates go from the browser's geolocation
 * API straight into a URL that the browser itself opens. There is no fetch,
 * no Supabase call and no analytics event in this component.
 *
 * ── Why the button is disabled until clicked ──────────────────────────
 * `navigator.geolocation` must be called from a user gesture on some
 * browsers, and asking on page load would be a permission prompt the
 * visitor never invited. So the request lives entirely inside `onClick`.
 *
 * ── Why the tab is opened before the fix ──────────────────────────────
 * A popup blocker only allows `window.open` while the click is still "live".
 * A geolocation fix takes a second or two, by which time the gesture has
 * expired and the tab would be blocked. So the tab is opened immediately
 * (blank), and its location is set once the coordinates arrive. If the fix
 * fails, the blank tab is closed again — the visitor never sees a stray
 * about:blank.
 */
export function ShareLocationButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function share() {
    setError("");
    setDone(false);

    if (!canGeolocate()) {
      setError(geolocationErrorMessage(null));
      return;
    }

    setBusy(true);

    // Open the tab now, while the click still counts as a user gesture.
    // `noopener` keeps the new tab from touching this window.
    const tab = window.open("", "_blank", "noopener,noreferrer");

    try {
      const coords = await getCurrentCoords();
      const url = pinUrl(coords);

      if (tab) {
        tab.location.href = url;
      } else {
        // The popup was blocked. Fall back to a same-tab navigation so the
        // feature still works — the visitor can press Back.
        window.location.href = url;
      }
      setDone(true);
    } catch (e) {
      // Close the blank tab we opened; leaving it would look like a bug.
      try {
        tab?.close();
      } catch {
        /* the tab may already be gone — nothing to do */
      }
      setError(geolocationErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={share}
        disabled={busy}
        aria-label="Share my location — opens your current position in Google Maps"
        aria-busy={busy}
        className="nm-btn-ghost inline-flex items-center gap-1.5 !px-3 !py-1.5 !text-[12px] disabled:opacity-60"
      >
        <span aria-hidden="true">{busy ? "📍" : "📍"}</span>
        {busy ? "Getting your location…" : "Share My Location"}
      </button>

      <p className="mt-1.5 max-w-[34ch] text-[10.5px] leading-relaxed text-ink-400">
        Your location is used only to open Google Maps and is not stored on this website.
      </p>

      {error && (
        <p role="alert" className="mt-1.5 max-w-[38ch] text-[11px] font-medium leading-relaxed text-red-600">
          {error}
        </p>
      )}

      {done && !error && (
        <p role="status" className="mt-1.5 text-[11px] font-medium text-brand-700">
          Opened in Google Maps.
        </p>
      )}
    </div>
  );
}
