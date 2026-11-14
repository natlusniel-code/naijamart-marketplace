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
import { Spinner } from "@/components/ui";

/**
 * Where to collect from — shown to a buyer who chose pickup.
 *
 * ── Two links, two jobs ───────────────────────────────────────────────
 * "Open in Maps" drops a pin on the shop, which is what a buyer wants when
 * they are about to leave and just need to see the area.
 *
 * "Directions from me" is the one the brief asks for: it asks the browser
 * for the buyer's own position and builds a turn-by-turn URL from there to
 * the shop. It needs the buyer's location, so it is a button and never
 * runs on load — a map on a listing page must not prompt for location.
 *
 * ── No key, no SDK ────────────────────────────────────────────────────
 * Every URL comes from src/lib/geo.ts and is a plain https://www.google.com
 * /maps link. Nothing here loads a script or needs an API key.
 *
 * ── Degrading honestly ────────────────────────────────────────────────
 * A shop may have an address with no pin (the common case: the seller typed
 * an address but never stood in the shop with the "use my location" button).
 * Then "Open in Maps" searches the address instead, and directions are given
 * from the buyer's position to that address text — Google geocodes it. A
 * shop with neither shows a plain "ask the seller" line rather than an empty
 * card.
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

  const coords: Coords | null =
    typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;

  const place = (address ?? "").trim();
  const fallbackPlace = [shopName, city].filter(Boolean).join(", ");

  async function directions() {
    setErr("");
    if (!canGeolocate()) {
      setErr(geolocationErrorMessage(null));
      return;
    }

    setBusy(true);
    // Open the tab inside the click so the popup blocker allows it; the
    // fix takes a second and the gesture would have expired by then.
    const tab = window.open("", "_blank", "noopener,noreferrer");

    try {
      const me = await getCurrentCoords();
      setFromMe(me);

      const url = coords
        ? directionsUrl(me, coords)
        : directionsToAddressUrl(me, place || fallbackPlace);

      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      try {
        tab?.close();
      } catch {
        /* already gone */
      }
      setErr(geolocationErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const openUrl = coords ? pinUrl(coords) : addressUrl(place || fallbackPlace);

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
              {fallbackPlace} — the seller has not added a street address yet. Message them for the exact spot.
            </p>
          )}
          {coords && (
            <p className="mt-1 font-mono text-[10.5px] text-ink-400">{coordsLabel(coords)}</p>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <a
          href={openUrl}
          target="_blank"
          rel="noreferrer"
          className="nm-btn-ghost !px-2.5 !py-1.5 !text-[11.5px]"
        >
          🗺️ Open in Maps
        </a>

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
    </div>
  );
}
