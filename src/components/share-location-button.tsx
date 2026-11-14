"use client";

import { useState } from "react";
import { canGeolocate, geolocationErrorMessage, getCurrentCoords, type Coords } from "@/lib/geo";
import { MapPopup } from "@/components/map-popup";
import { Spinner } from "@/components/ui";

/**
 * "Share My Location".
 *
 * ── What it does ──────────────────────────────────────────────────────────
 * On click (and only on click) it asks the browser for one position fix and
 * shows the result on a map that opens *inside* the page. Nothing is
 * uploaded, stored or sent to NaijaMart: the coordinates go from the
 * browser's geolocation API into a map URL that the browser itself loads.
 * There is no fetch, no Supabase call and no analytics event here.
 *
 * ── Why the map is a popup, not a new tab ─────────────────────────────────
 * A new tab loses the page the buyer was on. The popup keeps the checkout
 * or the chat underneath, and closing it puts them back exactly where they
 * were. See src/components/map-popup.tsx.
 *
 * ── Why the request lives in onClick ──────────────────────────────────────
 * `navigator.geolocation` must be called from a user gesture on some
 * browsers, and asking on page load would be a permission prompt the
 * visitor never invited. So nothing runs until the button is pressed.
 *
 * ── Why the button text is restored ───────────────────────────────────────
 * The label flips to "Getting your location…" while the fix is in flight and
 * back to its original text in `finally`, so a failure never leaves the
 * button stuck on a loading state.
 */
export function ShareLocationButton({
  className = "",
  label = "Share My Location",
  /** Called with the fix, for a caller that wants to keep it (e.g. checkout). */
  onLocated,
  /** Show the privacy note under the button. Off inside a card that has one. */
  showPrivacyNote = true,
  /** Compact styling for a dense form row. */
  compact = false,
}: {
  className?: string;
  label?: string;
  onLocated?: (c: Coords) => void;
  showPrivacyNote?: boolean;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);

  async function share() {
    setError("");

    if (!canGeolocate()) {
      setError(geolocationErrorMessage(null));
      return;
    }

    setBusy(true);
    try {
      const c = await getCurrentCoords();
      setCoords(c);
      onLocated?.(c);
    } catch (e) {
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
        aria-label={`${label} — asks your browser for permission, then shows your position on a map`}
        aria-busy={busy}
        className={
          compact
            ? "nm-btn-ghost inline-flex items-center gap-1.5 !px-2.5 !py-1.5 !text-[11.5px] disabled:opacity-60"
            : "nm-btn-ghost inline-flex items-center gap-1.5 !px-3 !py-1.5 !text-[12px] disabled:opacity-60"
        }
      >
        {busy ? <Spinner className="!h-3.5 !w-3.5" /> : <span aria-hidden="true">📍</span>}
        {busy ? "Getting your location…" : label}
      </button>

      {showPrivacyNote && (
        <p className="mt-1.5 max-w-[34ch] text-[10.5px] leading-relaxed text-ink-400">
          Your location is used only to open Google Maps and is not stored on this website.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-1.5 max-w-[38ch] text-[11px] font-medium leading-relaxed text-red-600">
          {error}
        </p>
      )}

      {coords && (
        <MapPopup
          coords={coords}
          title="Your location"
          subtitle="This is where your browser says you are."
          onClose={() => setCoords(null)}
        />
      )}
    </div>
  );
}
