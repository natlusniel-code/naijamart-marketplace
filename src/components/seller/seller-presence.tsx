"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The seller presence heartbeat.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The AI reply has to know whether the seller is at their desk. There is no
 * reliable way to infer that from message reads (a seller can read on their
 * phone and walk away), so the seller's shell says so explicitly: while the
 * Seller Hub is open, this pings `touch_seller_presence()` every 60
 * seconds, and `seller_is_online` treats "seen in the last 3 minutes" as
 * online.
 *
 * ── Why 60 seconds and a 3-minute window ─────────────────────────────────
 * A 60 s ping is cheap and survives a slow tab. The 3-minute window means a
 * page navigation or a brief tab switch does not flip the seller to
 * offline and start the bot replying to buyers they are about to answer
 * themselves — while a closed laptop goes offline within 3 minutes, which
 * is the behaviour a buyer expects.
 *
 * ── Why it also pings on visibility change ───────────────────────────────
 * A backgrounded tab has its timers throttled to about once a minute, and
 * a tab restored after an hour would otherwise look offline until the next
 * tick. Pinging on `visibilitychange` makes "I just came back" register
 * immediately.
 */
export function SellerPresence() {
  useEffect(() => {
    const supabase = createClient();
    let stopped = false;

    async function ping() {
      if (stopped) return;
      // ── Only a VISIBLE tab counts as presence ──────────────────────────
      // This used to ping unconditionally, including from a backgrounded
      // tab. Browsers throttle background timers to roughly once a minute
      // rather than stopping them, so a seller who left the hub open in
      // another tab — or whose phone was in their pocket with the tab
      // alive — kept `last_seen_at` fresh forever. `seller_is_online` then
      // said "online" for days, and every buyer message became a
      // `suggested` draft nobody sent. That was the unanswered-chat bug.
      //
      // A hidden tab is not a seller at their desk. Skipping the ping lets
      // the 3-minute window lapse, which is the honest answer.
      if (document.visibilityState !== "visible") return;
      // Fire and forget: a failed heartbeat is not worth surfacing.
      await supabase.rpc("touch_seller_presence").then(
        () => {},
        () => {},
      );
    }

    // Immediately, so opening the hub marks the seller online.
    ping();

    const timer = setInterval(ping, 60_000);

    function onVisible() {
      if (document.visibilityState === "visible") ping();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Renders nothing: it is a side effect, not a UI element.
  return null;
}
