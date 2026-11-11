/**
 * Global loading state — one store for the whole site.
 *
 * ── Why a store and not React state in a component ────────────────────────
 * Three different things need to drive the same loader: a link click, a
 * `fetch` starting, and the router finishing. They live in different places
 * (a capture-phase document listener, a patched `window.fetch`, and a
 * `usePathname` effect), so they cannot share component state. This module is
 * the single source of truth they all write to, and `GlobalLoader` is the only
 * thing that reads it.
 *
 * ── The two kinds of load ─────────────────────────────────────────────────
 * `navigation` — the user clicked a link and a new page is coming. The overlay
 *   blocks input, because a second click would start a second navigation.
 * `data` — a request is in flight but the page is staying put. The overlay is
 *   shown but does NOT block input: locking the whole UI every time a list
 *   refreshes would make the site feel broken.
 *
 * ── Timing ────────────────────────────────────────────────────────────────
 *   * `SHOW_DELAY` — a data request must still be pending after this long
 *     before the loader appears. Without it, every 20ms request flashes the
 *     overlay and the site strobes.
 *   * `MIN_VISIBLE` — once shown, the loader stays at least this long, so a
 *     fast navigation does not produce a 30ms flicker.
 *   * `FADE_OUT` — the CSS fade, during which the overlay is still mounted.
 *   * `TIMEOUT` — after this long the loader gives up and offers a retry.
 */

export type LoadKind = "navigation" | "data";

export type LoaderState = {
  /** True while the overlay should be on screen (including the fade-out). */
  visible: boolean;
  /** True during the 200ms fade-out, so the component can animate. */
  fading: boolean;
  /** True when the load exceeded TIMEOUT and the retry message is shown. */
  failed: boolean;
  /** Text under the icon. */
  label: string;
  /** Navigation blocks input; data does not. */
  blocking: boolean;
};

export const SHOW_DELAY = 120;
export const MIN_VISIBLE = 400;
export const FADE_OUT = 200;
export const TIMEOUT = 30_000;

const INITIAL: LoaderState = {
  visible: false,
  fading: false,
  failed: false,
  label: "Loading...",
  blocking: false,
};

let state: LoaderState = INITIAL;
const listeners = new Set<(s: LoaderState) => void>();

/** Pending work, keyed so a stop can only clear its own entry. */
const pending = new Map<string, LoadKind>();

let showTimer: ReturnType<typeof setTimeout> | null = null;
let minVisibleUntil = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;
let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

function emit(next: Partial<LoaderState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
}

export function subscribeLoader(cb: (s: LoaderState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

export function getLoaderState(): LoaderState {
  return state;
}

function clearTimers() {
  if (showTimer) clearTimeout(showTimer);
  if (hideTimer) clearTimeout(hideTimer);
  if (fadeTimer) clearTimeout(fadeTimer);
  if (timeoutTimer) clearTimeout(timeoutTimer);
  showTimer = hideTimer = fadeTimer = timeoutTimer = null;
}

function showNow(label: string, blocking: boolean) {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (fadeTimer) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
  minVisibleUntil = Date.now() + MIN_VISIBLE;
  emit({ visible: true, fading: false, failed: false, label, blocking });

  if (timeoutTimer) clearTimeout(timeoutTimer);
  timeoutTimer = setTimeout(() => {
    // Give up: stop spinning, offer a reload, and — critically — stop blocking
    // input. A stuck overlay that still swallowed clicks would leave the user
    // unable to do anything at all, including press Retry.
    emit({ failed: true, blocking: false });
  }, TIMEOUT);
}

/**
 * Begin a load. Returns a token to pass to `stopLoading`.
 *
 * `label` is only used when this call is the one that actually shows the
 * overlay — a navigation that starts while a data request is already showing
 * the loader still updates the text, because the user's intent changed.
 */
export function startLoading(kind: LoadKind, label = "Loading..."): string {
  const token = `${kind}:${++seq}`;
  pending.set(token, kind);

  if (state.visible && !state.fading) {
    // Already on screen: just retitle it. A navigation outranks a data load.
    if (kind === "navigation" || !state.blocking) {
      emit({ label, blocking: kind === "navigation" || state.blocking });
    }
    return token;
  }

  if (showTimer) clearTimeout(showTimer);
  const delay = kind === "navigation" ? 0 : SHOW_DELAY;
  showTimer = setTimeout(() => {
    showTimer = null;
    if (pending.size === 0) return;
    showNow(label, kind === "navigation");
  }, delay);

  return token;
}

/** End a load. The overlay hides only when nothing else is pending. */
export function stopLoading(token?: string) {
  if (token) pending.delete(token);
  else pending.clear();

  if (pending.size > 0) return;

  if (showTimer) {
    // It never became visible — nothing to hide.
    clearTimeout(showTimer);
    showTimer = null;
    return;
  }
  if (!state.visible || state.fading) return;

  const wait = Math.max(0, minVisibleUntil - Date.now());
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (pending.size > 0) return;
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    emit({ fading: true });
    fadeTimer = setTimeout(() => {
      fadeTimer = null;
      emit({ visible: false, fading: false, failed: false, blocking: false });
    }, FADE_OUT);
  }, wait);
}

/** Hard reset — used by the retry button and on a full page load. */
export function resetLoader() {
  clearTimers();
  pending.clear();
  state = INITIAL;
  listeners.forEach((l) => l(state));
}

/**
 * The text shown under the icon, derived from the destination path.
 *
 * Only the four routes the brief names get specific copy; everything else
 * says "Loading...". Guessing a label for every route would produce awkward
 * sentences ("Loading admin-fuckliving...") for no benefit.
 */
export function labelForPath(path: string): string {
  const p = path.split("?")[0].split("#")[0];
  if (p === "/cart") return "Loading your cart...";
  if (p === "/checkout") return "Loading checkout...";
  if (p.startsWith("/shop/")) return "Loading shop...";
  if (p.startsWith("/listing/")) return "Loading product...";
  return "Loading...";
}
