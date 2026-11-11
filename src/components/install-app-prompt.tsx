"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  canInstall,
  dismissInstall,
  isDismissed,
  isInstalled,
  onInstallStateChange,
  promptInstall,
} from "@/lib/install-app";

/**
 * The "Install app" toast shown after a user signs in.
 *
 * ── Why a toast and not a modal ───────────────────────────────────────────
 * The request was explicit: a pop-up that does not disturb the site. A modal
 * would block the page the user just asked for. This is a small card pinned
 * above the mobile tab bar (bottom-right on desktop), it never covers the
 * header or the content column, and it can be dismissed with one tap. It also
 * does not steal focus, so a buyer who signed in to check an order can ignore
 * it and carry on.
 *
 * ── When it appears ───────────────────────────────────────────────────────
 *   * only for a signed-in user (the layout renders it only when there is a
 *     session, so a logged-out visitor never sees it);
 *   * only once per browser session — `sessionStorage`, so navigating around
 *     after signing in does not re-show it on every page;
 *   * only when Chrome has actually offered an install prompt. If the app is
 *     already installed, or the browser cannot install it, nothing renders at
 *     all rather than showing a button that would do nothing;
 *   * not within 30 days of the user dismissing it;
 *   * not on the profile page, which has its own permanent "Install app" row.
 *     Showing both at once is the same offer twice on one screen.
 */
export function InstallAppPrompt() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  // The profile page carries the row instead — see install-app-row.tsx.
  const suppressed = pathname === "/profile";

  useEffect(() => {
    // Chrome only considers the site installable once a service worker with a
    // `fetch` handler is registered on the origin. `public/sw.js` is that
    // worker (it also powers notifications). Registering here means it happens
    // for every signed-in page, not only on the notifications screen.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* installability degrades; the rest of the site is unaffected */
      });
    }

    // One showing per session. `sessionStorage` survives client-side
    // navigation but not a new tab, which is the behaviour we want: sign in
    // again in a new tab and the offer is made again.
    let alreadyShown = false;
    try {
      alreadyShown = window.sessionStorage.getItem("nm:install-toast-shown") === "1";
    } catch {
      /* private mode: fall through and show it */
    }

    function evaluate() {
      if (alreadyShown) return;
      if (suppressed) {
        setShow(false);
        return;
      }
      if (isInstalled() || isDismissed()) {
        setShow(false);
        return;
      }
      if (canInstall()) {
        setShow(true);
        alreadyShown = true;
        try {
          window.sessionStorage.setItem("nm:install-toast-shown", "1");
        } catch {
          /* ignore */
        }
      }
    }

    // Chrome may fire `beforeinstallprompt` a moment after hydration, so
    // evaluate now and again whenever the install state changes.
    evaluate();
    const off = onInstallStateChange(evaluate);
    return off;
  }, [suppressed]);

  async function install() {
    setBusy(true);
    setNote("");
    const result = await promptInstall();
    setBusy(false);

    if (result === "accepted") {
      setShow(false);
      return;
    }
    if (result === "dismissed") {
      setShow(false);
      return;
    }
    // Chrome withdrew the prompt (already installed elsewhere, or the event
    // was consumed). Say so instead of leaving a dead button on screen.
    setNote("Your browser isn't offering the install prompt right now. Use the browser menu → “Install app”.");
  }

  function close() {
    dismissInstall();
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-[76px] z-40 mx-auto max-w-sm rounded-2xl border border-[var(--line)] bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.16)] md:inset-x-auto md:bottom-5 md:right-5 md:mx-0 md:w-[330px]"
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icon-192.png"
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold text-ink-900">Install app</p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-500">
            Add NaijaMart to your phone&apos;s home screen — it opens full screen, like an app.
          </p>
          {note && <p className="mt-1.5 text-[11.5px] leading-snug text-amber-700">{note}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={install}
              disabled={busy}
              className="nm-btn-primary !px-3 !py-1.5 !text-[12.5px]"
            >
              {busy ? "Opening…" : "Install app"}
            </button>
            <button
              onClick={close}
              className="rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-ink-500 hover:bg-slate-50"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          onClick={close}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 rounded-lg p-1.5 text-ink-400 hover:bg-slate-50 hover:text-ink-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
