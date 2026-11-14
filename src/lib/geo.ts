/**
 * Map links, built from plain URLs.
 *
 * ── Why no Maps SDK ───────────────────────────────────────────────────
 * Every link here is a normal `https://www.google.com/maps…` URL. There is
 * no JavaScript API, no Embed API and no API key anywhere in the project:
 * a key would have to be shipped to the browser, restricted per domain and
 * paid for, to do something a URL already does. A plain link also works in
 * the in-app browsers (WhatsApp, Instagram) where the SDK often does not.
 *
 * ── Privacy ───────────────────────────────────────────────────────────
 * Nothing in this file sends anything anywhere. It formats numbers into a
 * string. The coordinates only leave the device when the user's own browser
 * opens the resulting link.
 */

/** A coordinate pair, as the browser reports it. */
export type Coords = { lat: number; lng: number };

/**
 * Round to 5 decimal places (~1 m). More precision than that is noise from
 * the GPS fix, and a shorter URL is easier to read and to share.
 */
function fmt(n: number) {
  return Number(n.toFixed(5)).toString();
}

/** True when both numbers are real, finite coordinates. */
export function hasCoords(c: Partial<Coords> | null | undefined): c is Coords {
  return (
    !!c &&
    typeof c.lat === "number" &&
    typeof c.lng === "number" &&
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lng) &&
    Math.abs(c.lat) <= 90 &&
    Math.abs(c.lng) <= 180
  );
}

/**
 * Drop a pin at a point.
 *   https://www.google.com/maps?q=LATITUDE,LONGITUDE
 * This is the exact format the brief asks for.
 */
export function pinUrl(c: Coords) {
  return `https://www.google.com/maps?q=${fmt(c.lat)},${fmt(c.lng)}`;
}

/**
 * Turn-by-turn directions from one point to another.
 *
 * `api=1` is the documented "Maps URLs" parameter set — it is a URL scheme,
 * not the JavaScript API, and needs no key. `travelmode=driving` is the
 * default a Nigerian buyer on a bike or in a bus expects; Google still
 * offers walking/transit on the page itself.
 */
export function directionsUrl(from: Coords, to: Coords) {
  return (
    "https://www.google.com/maps/dir/?api=1" +
    `&origin=${fmt(from.lat)},${fmt(from.lng)}` +
    `&destination=${fmt(to.lat)},${fmt(to.lng)}` +
    "&travelmode=driving"
  );
}

/**
 * Directions to a place by name, when the other side has an address but no
 * pin. Google geocodes the text itself, so this still lands on the shop.
 */
export function directionsToAddressUrl(from: Coords, address: string) {
  return (
    "https://www.google.com/maps/dir/?api=1" +
    `&origin=${fmt(from.lat)},${fmt(from.lng)}` +
    `&destination=${encodeURIComponent(address)}` +
    "&travelmode=driving"
  );
}

/** A search link for an address with no coordinates. */
export function addressUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * Human-readable coordinate pair, for the small print under a shared pin.
 * Four decimals is enough to recognise a neighbourhood without printing a
 * number nobody can read.
 */
export function coordsLabel(c: Coords) {
  return `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
}

/**
 * The message a user sees when the browser refuses or fails a fix.
 *
 * `GeolocationPositionError` codes are fixed by the spec:
 *   1 PERMISSION_DENIED · 2 POSITION_UNAVAILABLE · 3 TIMEOUT
 * Anything else (including a browser with no `geolocation` at all) is
 * reported as unsupported, because that is what it behaves like.
 */
export function geolocationErrorMessage(err: unknown): string {
  const code = (err as { code?: number } | null)?.code;
  switch (code) {
    case 1:
      return "Location permission was denied. Allow location for this site in your browser settings, then try again.";
    case 2:
      return "Your location is unavailable right now. Move somewhere with a clearer signal, or check that location services are switched on.";
    case 3:
      return "Getting your location took too long. Please try again.";
    default:
      return "This browser does not support location sharing. You can still type your address instead.";
  }
}

/** True when this browser can do a one-shot fix at all. */
export function canGeolocate() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * One-shot position read, wrapped in a promise.
 *
 * `enableHighAccuracy` is off on purpose: a coarse cell/Wi-Fi fix arrives in
 * a second or two, and for "open my area in Maps" or "where should the rider
 * come to" that is plenty. High accuracy can take 30 s and drains the
 * battery, which is a bad trade on a phone in a shop.
 */
export function getCurrentCoords(timeoutMs = 12000): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!canGeolocate()) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}
