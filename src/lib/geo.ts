/**
 * Map links and the one-shot position read.
 *
 * ── Why no Maps SDK ───────────────────────────────────────────────────────
 * Every Google link here is a normal `https://www.google.com/maps…` URL.
 * There is no JavaScript API, no Embed API and no API key anywhere in the
 * project: a key would have to be shipped to the browser, restricted per
 * domain and paid for, to do something a URL already does. A plain link also
 * works in the in-app browsers (WhatsApp, Instagram) where the SDK often
 * does not.
 *
 * ── The in-site map ───────────────────────────────────────────────────────
 * The popup map is an OpenStreetMap tile embed (`openstreetmap.org/export/
 * embed.html`). It is a plain URL with no key and no Google dependency, so
 * the map can live inside the page without an API key. Google Maps is still
 * one tap away for directions, because that is what a Nigerian buyer
 * actually navigates with.
 *
 * ── Privacy ───────────────────────────────────────────────────────────────
 * Nothing in this file sends anything anywhere. It formats numbers into a
 * string and reads the browser's own position. The coordinates only leave
 * the device when the user's own browser opens the resulting link.
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
 * The in-site map: an OpenStreetMap tile embed around a point.
 *
 * `bbox` is west,south,east,north. A ±0.008° box is roughly a 1.5 km square
 * at Nigerian latitudes — wide enough to show the street and the next one,
 * tight enough that the pin is not a dot in a city-wide view.
 *
 * No key, no SDK, no Google. The iframe is sandboxed by the browser and the
 * coordinates are in the URL only, never in a request to NaijaMart.
 */
export function osmEmbedUrl(c: Coords, span = 0.008) {
  const west = (c.lng - span).toFixed(5);
  const south = (c.lat - span).toFixed(5);
  const east = (c.lng + span).toFixed(5);
  const north = (c.lat + span).toFixed(5);
  return (
    "https://www.openstreetmap.org/export/embed.html" +
    `?bbox=${west}%2C${south}%2C${east}%2C${north}` +
    "&layer=mapnik" +
    `&marker=${fmt(c.lat)}%2C${fmt(c.lng)}`
  );
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
 * We add two of our own:
 *   0 no geolocation API at all
 *   4 the page is not on HTTPS, so the browser silently refuses
 * Anything else is reported as unsupported, because that is what it
 * behaves like.
 */
export function geolocationErrorMessage(err: unknown): string {
  const code = (err as { code?: number } | null)?.code;
  switch (code) {
    case 1:
      return "Location permission was denied. Allow location for this site in your browser settings, then try again.";
    case 2:
      return "Your location is unavailable right now. Move somewhere with a clearer signal, or check that location services are switched on.";
    case 3:
      return "We could not get a location fix. Check that location services are on and that you are not indoors with no signal, then try again.";
    case 4:
      return "Location sharing needs a secure (https) connection. Open this page over https and try again.";
    default:
      return "This browser does not support location sharing. You can still type your address instead.";
  }
}

/** True when this browser can do a one-shot fix at all. */
export function canGeolocate() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * True when the page is allowed to ask for a position at all.
 *
 * Browsers only expose geolocation on a secure context. On plain http the
 * API exists but every call fails with PERMISSION_DENIED, which reads to the
 * user as "you said no" when they never saw a prompt. Checking up front lets
 * us say the real reason.
 */
export function isSecureContextOk() {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

/** The permission state, when the browser will tell us. */
async function permissionState(): Promise<PermissionState | "unknown"> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state;
  } catch {
    // Safari and some in-app browsers do not implement this query.
    return "unknown";
  }
}

/** One `getCurrentPosition` call, as a promise. */
function once(opts: PositionOptions): Promise<Coords> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    // A watchdog on top of the browser's own timeout. Some Android WebViews
    // and in-app browsers never fire either callback when the GPS chip is
    // asleep, which is exactly the "took too long" the user saw. Our timer
    // is a little longer than the browser's so the browser's own TIMEOUT
    // (with its better message) wins when it does fire.
    const guard = setTimeout(() => {
      done(() => reject({ code: 3 }));
    }, (opts.timeout ?? 10000) + 1500);

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          done(() => {
            clearTimeout(guard);
            resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          }),
        (err) =>
          done(() => {
            clearTimeout(guard);
            reject(err);
          }),
        opts,
      );
    } catch (e) {
      done(() => {
        clearTimeout(guard);
        reject(e);
      });
    }
  });
}

/**
 * One-shot position read, with a retry ladder.
 *
 * ── Why a ladder ──────────────────────────────────────────────────────────
 * A single high-accuracy request is the wrong default on a phone: indoors it
 * can burn the full timeout and then fail, which is the bug this replaces.
 * So we try three times, each cheaper than the last:
 *
 *   1. high accuracy, 8 s, no cache    — the good fix, when the sky is visible
 *   2. coarse,       12 s, 5 min cache — cell/Wi-Fi, usually instant
 *   3. coarse,       20 s, any cache   — accepts a stale fix rather than fail
 *
 * A PERMISSION_DENIED is terminal: retrying cannot help, and asking three
 * times would look like a broken button. Everything else falls through to
 * the next rung, and only the last error is reported.
 *
 * ── Stale permission ──────────────────────────────────────────────────────
 * If the browser says the permission is already `granted` but the first fix
 * times out, that is almost always a cold GPS chip rather than a refusal —
 * rung 2 and 3 then return a cached or coarse position instead of failing.
 * If it says `denied`, we fail immediately with the honest message instead
 * of waiting 40 s for three timeouts.
 */
export async function getCurrentCoords(): Promise<Coords> {
  if (!canGeolocate()) throw { code: 0 };
  if (!isSecureContextOk()) throw { code: 4 };

  const state = await permissionState();
  if (state === "denied") throw { code: 1 };

  const attempts: PositionOptions[] = [
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 },
    { enableHighAccuracy: false, timeout: 20000, maximumAge: Infinity },
  ];

  let last: unknown = { code: 3 };
  for (const opts of attempts) {
    try {
      return await once(opts);
    } catch (e) {
      last = e;
      // A refusal is final. A timeout or an unavailable fix is worth another
      // try with a cheaper strategy.
      if ((e as { code?: number })?.code === 1) throw e;
    }
  }
  throw last;
}
