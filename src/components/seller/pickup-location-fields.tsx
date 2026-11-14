"use client";

import { useState } from "react";
import { canGeolocate, coordsLabel, geolocationErrorMessage, getCurrentCoords, type Coords } from "@/lib/geo";
import { MapPopup } from "@/components/map-popup";
import { Spinner } from "@/components/ui";

/**
 * The seller's pickup point.
 *
 * ── Why the pin is captured here, not typed ───────────────────────────
 * A seller knows where their shop is; they do not know its latitude. Asking
 * them to type coordinates would produce garbage. So the pin is read from
 * the browser while the seller is standing in (or near) the shop, and the
 * address is typed as the human-readable half. Both are optional — a shop
 * with only an address still gets a working "Directions" link, because
 * Google geocodes the text.
 *
 * ── Privacy ───────────────────────────────────────────────────────────
 * The coordinates are only written to the database when the seller presses
 * Save on the settings form. Reading them here just fills the form. Nothing
 * is sent on page load, and nothing is sent until the seller asks for it.
 */
export function PickupLocationFields({
  lat,
  lng,
  address,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  address: string;
  onChange: (next: { lat: number | null; lng: number | null; address: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showMap, setShowMap] = useState(false);

  const coords: Coords | null =
    typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;

  async function useMyLocation() {
    setErr("");
    if (!canGeolocate()) {
      setErr(geolocationErrorMessage(null));
      return;
    }
    setBusy(true);
    try {
      const c = await getCurrentCoords();
      onChange({ lat: c.lat, lng: c.lng, address });
    } catch (e) {
      setErr(geolocationErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <div>
        <label className="nm-label" htmlFor="shop-address">
          Shop address (for pickup)
        </label>
        <input
          id="shop-address"
          className="nm-input"
          value={address}
          onChange={(e) => onChange({ lat, lng, address: e.target.value })}
          placeholder="e.g. 12 Kuto Road, beside First Bank, Abeokuta"
        />
        <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
          Shown to a buyer who chooses pickup. Be specific — this is what they will look for.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--line)] bg-slate-50/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-ink-900">Pin your shop on the map</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
              {coords
                ? `Pinned at ${coordsLabel(coords)}`
                : "Optional. A pin lets a buyer open directions straight to your door."}
            </p>
          </div>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={busy}
            className="nm-btn-ghost shrink-0 !px-2.5 !py-1.5 !text-[11.5px] disabled:opacity-60"
            aria-label="Use my current location as the shop pickup pin"
          >
            {busy ? <><Spinner className="!h-3 !w-3" /> Locating…</> : "📍 Use my location"}
          </button>
        </div>

        {coords && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMap(true)}
              className="text-[11.5px] font-semibold text-brand-700 underline"
            >
              Preview on map
            </button>
            <span className="text-ink-300">·</span>
            <button
              type="button"
              onClick={() => onChange({ lat: null, lng: null, address })}
              className="text-[11.5px] font-semibold text-ink-400 hover:text-red-600"
            >
              Remove pin
            </button>
          </div>
        )}

        {err && (
          <p role="alert" className="mt-2 text-[11px] font-medium leading-relaxed text-red-600">
            {err}
          </p>
        )}

        <p className="mt-2 text-[10.5px] leading-relaxed text-ink-400">
          Your location is used only to place the pin and is not shared until you save.
        </p>
      </div>

      {showMap && coords && (
        <MapPopup
          coords={coords}
          title="Your shop pickup point"
          subtitle={address || "This is the pin buyers will be sent to."}
          onClose={() => setShowMap(false)}
        />
      )}
    </div>
  );
}
