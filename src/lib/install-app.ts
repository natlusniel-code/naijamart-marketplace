"use client";

/**
 * "Install app" plumbing for Chrome / Android / desktop.
 *
 * ── What the browser actually gives us ────────────────────────────────────
 * Chrome fires `beforeinstallprompt` when the site meets the install criteria
 * (manifest + icons + service worker + HTTPS). The event must be captured and
 * kept — calling `prompt()` later, from a click, is the only way to show the
 * install dialog. If we let the event go, Chrome shows its own mini-infobar
 * and we lose the ability to trigger it from our own button.
 *
 * The event can fire BEFORE React has mounted, so `layout.tsx` installs a tiny
 * inline listener that stashes it on `window.__nmInstallPrompt`. Everything
 * here reads from that stash, which means a button rendered a second later
 * still works.
 *
 * ── What we cannot know ───────────────────────────────────────────────────
 * There is no API that answers "is this app installed?" for a browser tab.
 * `display-mode: standalone` is only true while the app is running AS the
 * installed app. So we combine three signals:
 *
 *   1. `display-mode: standalone` — running as the installed app right now.
 *   2. `appinstalled` — fired in this browser at some point; remembered in
 *      localStorage so the profile page stops offering it afterwards.
 *   3. `getInstalledRelatedApps()` — Chrome-only, and only when the manifest
 *      declares a related app. Not used here; it returns nothing for a plain
 *      PWA without a Play Store entry.
 *
 * So "already installed" is best-effort: exact while the app is open as an
 * app, and remembered per browser otherwise. A user who installs on their
 * phone and then opens the site in a different browser will be offered it
 * again — that is a browser limitation, not a bug we can fix from the page.
 */

const DISMISS_KEY = "nm:install-dismissed-at";
const INSTALLED_KEY = "nm:app-installed";

/** How long a dismissal is respected before the prompt may appear again. */
const DISMISS_DAYS = 30;

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

declare global {
  interface Window {
    __nmInstallPrompt?: InstallPromptEvent | null;
    __nmInstallListeners?: Array<() => void>;
  }
}

/** True while the page is running as the installed app. */
export function isRunningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)");
  if (mq?.matches) return true;
  // iOS Safari's own flag, for the "Add to Home Screen" route.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** True when this browser has installed the app at some point. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (isRunningStandalone()) return true;
  try {
    return window.localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

/** The captured `beforeinstallprompt` event, if Chrome has offered one. */
export function getInstallPrompt(): InstallPromptEvent | null {
  if (typeof window === "undefined") return null;
  return window.__nmInstallPrompt ?? null;
}

/** True when we can actually show the install dialog right now. */
export function canInstall(): boolean {
  return !isInstalled() && getInstallPrompt() !== null;
}

/** True when the user said "not now" recently. */
export function isDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function dismissInstall(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode — the prompt just reappears next visit */
  }
}

/**
 * Show the browser's install dialog.
 *
 * Must be called from a user gesture. Returns what the user chose, or
 * `unavailable` when Chrome has not offered an install prompt (already
 * installed, criteria not met, or a browser that does not support it — Safari
 * on iOS has no programmatic install at all).
 */
export async function promptInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const evt = getInstallPrompt();
  if (!evt) return "unavailable";

  try {
    await evt.prompt();
    const choice = await evt.userChoice;
    // The event is single-use: Chrome will not let us prompt again with it.
    window.__nmInstallPrompt = null;
    if (choice.outcome === "accepted") {
      markInstalled();
      return "accepted";
    }
    dismissInstall();
    return "dismissed";
  } catch {
    window.__nmInstallPrompt = null;
    return "unavailable";
  }
}

/**
 * Wait for Chrome to hand us `beforeinstallprompt`.
 *
 * The event can fire a moment after the page mounts, so a click that lands
 * first would otherwise find nothing and fall through to the manual
 * instructions. Resolves with the event, or `null` if it never arrives
 * within `ms` (iOS Safari never fires it at all).
 */
export function waitForInstallPrompt(ms = 2500): Promise<InstallPromptEvent | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const existing = getInstallPrompt();
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let done = false;
    const finish = (evt: InstallPromptEvent | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("nm:install-available", onAvailable);
      clearTimeout(timer);
      resolve(evt);
    };
    const onAvailable = () => finish(getInstallPrompt());
    const timer = setTimeout(() => finish(getInstallPrompt()), ms);
    window.addEventListener("nm:install-available", onAvailable);
  });
}

function markInstalled(): void {
  try {
    window.localStorage.setItem(INSTALLED_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to install-state changes: the prompt becoming available, and the
 * app being installed. Returns an unsubscribe function.
 *
 * Used by the components so a button that rendered before Chrome fired
 * `beforeinstallprompt` still lights up when it does.
 */
export function onInstallStateChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onAvailable = () => cb();
  const onInstalled = () => {
    markInstalled();
    cb();
  };

  window.addEventListener("nm:install-available", onAvailable);
  window.addEventListener("appinstalled", onInstalled);

  const mq = window.matchMedia?.("(display-mode: standalone)");
  mq?.addEventListener?.("change", onAvailable);

  return () => {
    window.removeEventListener("nm:install-available", onAvailable);
    window.removeEventListener("appinstalled", onInstalled);
    mq?.removeEventListener?.("change", onAvailable);
  };
}
