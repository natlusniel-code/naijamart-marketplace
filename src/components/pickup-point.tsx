"use client";

import { useState } from "react";
import {
  addressUrl,
  canGeolocate,
  coordsLabel,
  directionsToAddressUrl,
  directionsUrl,
  geolocationErrorMessage,
  getCurrentCoords,
  pinUrl,
  type Coords,
} from "@/lib/geo";
import { MapPopup } from "@/components/map-popup";
import { Spinner } from "@/components/ui";

/**
 * Where to collect from — shown to a buyer who chose pickup.
 *
 * ── Renders nothing without a location ────────────────────────────────────
 * A seller who has not set a pickup address or a pin has no location to
 * show. Printing "the seller has not added a street address yet" on a
 * checkout card is noise that reads like a broken feature, so this
 * component returns `null` in that case. The caller does not need to test
 * for it — the card simply is not there.
 *
 * ── The map opens in the page ─────────────────────────────────────────────
 * "Show on map" opens the in-site popup (src/components/map-popup.tsx)
 * rather than a new tab, so the buyer keeps their checkout underneath.
 * "Directions" asks for the buyer's own position and then opens the same
 * popup with a route link — the position is used only to build that link
 * and is never saved.
 *
 * ── No key, no SDK ────────────────────────────────────────────────────────
 * Every URL comes from src/lib/geo.ts. The in-site map is an OpenStreetMap
 * tile embed; the Google links are plain `https://www.google.com/maps`
 * URLs. Nothing here loads a script or needs an API key.
 */
export function PickupPoint({
  shopName,
  city,
  address,
  lat,
  lng,
  compact = false,
}: {
  shopName: string;
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fromMe, setFromMe] = useState<Coords | null>(null);
  const [showMap, setShowMap] = useState(false);

  const coords: Coords | null =
    typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;

  const place = (address ?? "").trim();

  // No pin and no address: there is no location to show. Say nothing rather
  // than render an empty card that looks like a bug.
  if (!coords && !place) return null;

  async function directions() {
    setErr("");
    if (!canGeolocate()) {
      setErr(geolocationErrorMessage(null));
      return;
    }

    setBusy(true);
    try {
      const me = await getCurrentCoords();
      setFromMe(me);
      // With a pin we can route point-to-point; with only an address Google
      // geocodes the text, which still lands on the shop.
      const url = coords
        ? directionsUrl(me, coords)
        : directionsToAddressUrl(me, place);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(geolocationErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const openUrl = coords ? pinUrl(coords) : addressUrl(place);

  return (
    <div
      className={
        compact
          ? "rounded-xl border border-brand-500/25 bg-brand-50/60 p-3"
          : "nm-card p-4"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-ink-900">📍 Pick up from {shopName}</p>
          {place ? (
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">{place}</p>
          ) : (
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
              {[shopName, city].filter(Boolean).join(", ")}
            </p>
          )}
          {coords && (
            <p className="mt-1 font-mono text-[10.5px] text-ink-400">{coordsLabel(coords)}</p>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {coords ? (
          <button
            type="button"
            onClick={() => setShowMap(true)}
            className="nm-btn-ghost !px-2.5 !py-1.5 !text-[11.5px]"
            aria-label={`Show ${shopName} on a map`}
          >
            🗺️ Show on map
          </button>
        ) : (
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            className="nm-btn-ghost !px-2.5 !py-1.5 !text-[11.5px]"
          >
            🗺️ Open in Maps
          </a>
        )}

        <button
          type="button"
          onClick={directions}
          disabled={busy}
          aria-label={`Get directions from my current location to ${shopName}`}
          className="nm-btn-primary !px-2.5 !py-1.5 !text-[11.5px] disabled:opacity-60"
        >
          {busy ? <><Spinner className="!h-3 !w-3" /> Locating…</> : "➤ Directions from me"}
        </button>
      </div>

      {fromMe && !err && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-400">
          Started from {coordsLabel(fromMe)}. Your position was used only to build the link and was
          not saved.
        </p>
      )}

      {err && (
        <p role="alert" className="mt-1.5 text-[11px] font-medium leading-relaxed text-red-600">
          {err}
        </p>
      )}

      {!compact && (
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink-400">
          Pickup is free — no delivery fee is charged for an order you collect yourself.
        </p>
      )}

      {showMap && coords && (
        <MapPopup
          coords={coords}
          title={`Pick up from ${shopName}`}
          subtitle={place || [shopName, city].filter(Boolean).join(", ")}
          destination={fromMe}
          destinationLabel={shopName}
          onClose={() => setShowMap(false)}
        />
      )}
    </div>
  );
}
