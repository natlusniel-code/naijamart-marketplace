"use client";

import { useEffect, useState } from "react";
import {
  canInstall,
  getInstallPrompt,
  isInstalled,
  onInstallStateChange,
  promptInstall,
  waitForInstallPrompt,
} from "@/lib/install-app";

/**
 * The "Install app" row on the profile page.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * A user who has NOT installed the app sees "Install app". A user who HAS
 * installed it sees nothing at all — the row is not rendered, not merely
 * disabled, so there is no dead control on their profile.
 *
 * ── How "installed" is decided ────────────────────────────────────────────
 * `isInstalled()` (src/lib/install-app.ts) is true when the page is running as
 * the installed app (`display-mode: standalone`), or when this browser has
 * fired `appinstalled` before (remembered in localStorage). That is as close
 * as a web page can get: no browser exposes "is this PWA installed?" to a tab.
 *
 * ── Why there is a fallback message ───────────────────────────────────────
 * Chrome only offers a programmatic install prompt once it has decided the
 * site is installable, and iOS Safari never offers one at all. Rather than
 * hide the row in those cases — which would leave a user who genuinely has not
 * installed it with no way to do so — the row stays and explains the manual
 * route (browser menu → Install app, or Share → Add to Home Screen).
 */
export function InstallAppRow() {
  // `null` until we have read the browser state, so the server-rendered HTML
  // and the first client render agree (no hydration mismatch, no flash of a
  // row that then disappears for someone who already installed it).
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    function sync() {
      setInstalled(isInstalled());
      setAvailable(canInstall());
    }
    sync();
    return onInstallStateChange(sync);
  }, []);

  async function install() {
    setBusy(true);
    setNote("");
    const result = await promptInstall();
    setBusy(false);

    if (result === "accepted") {
      setInstalled(true);
      return;
    }
    if (result === "dismissed") {
      setNote("No problem — you can install any time from this page.");
      return;
    }
    // No prompt available: show the manual instructions instead of failing.
    setShowHelp(true);
  }

  /**
   * The button must install, not explain.
   *
   * Chrome only hands us `beforeinstallprompt` once it has decided the site
   * qualifies, and it can fire after this component mounted. So a click that
   * arrives before the event is captured waits for it (a few hundred ms in
   * practice) and then prompts — instead of falling straight through to the
   * "here is how to do it yourself" panel, which is what users were seeing.
   */
  async function installNow() {
    if (getInstallPrompt()) {
      await install();
      return;
    }
    setBusy(true);
    setNote("");
    const evt = await waitForInstallPrompt(2500);
    setBusy(false);
    if (evt) {
      await install();
      return;
    }
    // Genuinely unavailable (iOS Safari, or already installed elsewhere).
    setShowHelp(true);
  }

  // Not yet known, or already installed → render nothing.
  if (installed === null || installed) return null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-ink-900">Install app</p>
          <p className="text-[11.5px] text-ink-500">
            Add NaijaMart to your home screen for one-tap access
          </p>
        </div>
        <button
          onClick={installNow}
          disabled={busy}
          className="nm-btn-primary shrink-0 !px-3 !py-1.5 !text-[12.5px]"
        >
          {busy ? "Installing…" : "Install app"}
        </button>
      </div>

      {note && <p className="mt-1.5 text-[11.5px] text-ink-500">{note}</p>}

      {showHelp && (
        <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-600">
          <p className="font-semibold text-ink-900">Install it from your browser menu</p>
          <p className="mt-1">
            <span className="font-semibold">Android / Chrome:</span> tap the ⋮ menu, then{" "}
            <span className="font-semibold">Install app</span> (or “Add to Home screen”).
          </p>
          <p className="mt-1">
            <span className="font-semibold">iPhone / Safari:</span> tap the Share button, then{" "}
            <span className="font-semibold">Add to Home Screen</span>.
          </p>
          <p className="mt-1">
            <span className="font-semibold">Desktop Chrome:</span> the install icon in the address bar,
            or ⋮ menu → <span className="font-semibold">Install NaijaMart</span>.
          </p>
        </div>
      )}

      {!available && !showHelp && (
        <button
          onClick={() => setShowHelp(true)}
          className="mt-1 text-[11.5px] font-semibold text-brand-600 hover:underline"
        >
          How do I install it?
        </button>
      )}
    </div>
  );
}
