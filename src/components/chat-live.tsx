"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Live chat signals: presence, typing, and the online/offline headline.
 *
 * ── Why a Realtime channel and not the database ────────────────────────
 * "Is the other person typing right now" is true for a second or two and
 * is worthless once stored. Writing it to a table would mean a row per
 * keystroke burst, a cleanup job, and a stale "typing…" left behind by a
 * closed tab. Supabase Realtime broadcast carries it peer-to-peer and
 * forgets it the moment the socket drops, which is exactly the lifetime
 * the signal has.
 *
 * Presence rides the same channel: `track()` on subscribe, and the `sync`
 * event tells us who else is in this thread. That is the only honest
 * answer for a BUYER, who has no heartbeat of their own.
 *
 * ── Why the seller is different ────────────────────────────────────────
 * A seller's "online" must mean "at their desk", not "has this one thread
 * open" — they may be in the hub answering a different buyer. So the
 * buyer's view of the seller is seeded from `seller_is_online()`
 * (sql/0035, the 3-minute heartbeat) and re-read on a timer, with thread
 * presence as an additional "definitely here" signal.
 *
 * The two are OR-ed, never AND-ed: either one is enough to say the seller
 * is around, and telling a buyer "Offline" while their seller is actively
 * replying in the hub would be a lie.
 */

const TYPING_TTL_MS = 4_000;
const TYPING_THROTTLE_MS = 1_500;
const SELLER_POLL_MS = 30_000;

export type ChatPresence = {
  /** True when the other party should be shown as Online. */
  otherOnline: boolean;
  /** True while the other party is composing. */
  otherTyping: boolean;
  /** Call on every keystroke; throttled internally. */
  notifyTyping: () => void;
  /** Call when the composer is emptied or the message is sent. */
  stopTyping: () => void;
  /** Call when a message arrives, so the dots clear at once. */
  clearOtherTyping: () => void;
};

export function useChatPresence({
  chatId,
  meId,
  otherId,
  amSeller,
  shopId,
  sellerOnlineSeed = false,
}: {
  chatId: string;
  meId: string;
  otherId: string;
  amSeller: boolean;
  /** The shop behind this thread — what `seller_is_online` is asked about. */
  shopId: string | null;
  /** `seller_is_online(shop_id)` read on the server, for the first paint. */
  sellerOnlineSeed?: boolean;
}): ChatPresence {
  const [otherPresent, setOtherPresent] = useState(false);
  const [sellerOnline, setSellerOnline] = useState(sellerOnlineSeed);
  const [otherTyping, setOtherTyping] = useState(false);

  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  /* ── The channel: presence + typing ─────────────────────────────── */
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase.channel(`chat-live-${chatId}`, {
      config: {
        // `self: false` — never receive our own typing echo and show dots
        // for ourselves.
        broadcast: { self: false },
        presence: { key: meId },
      },
    });

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState() as Record<string, unknown[]>;
      setOtherPresent(Object.prototype.hasOwnProperty.call(state, otherId));
    });

    ch.on("broadcast", { event: "typing" }, ({ payload }: { payload: any }) => {
      if (payload?.from !== otherId) return;
      setOtherTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      // A sender that goes quiet without sending (closed the tab, lost
      // signal) must not leave the dots dancing forever.
      typingTimer.current = setTimeout(() => setOtherTyping(false), TYPING_TTL_MS);
    });

    ch.on("broadcast", { event: "stop-typing" }, ({ payload }: { payload: any }) => {
      if (payload?.from !== otherId) return;
      if (typingTimer.current) clearTimeout(typingTimer.current);
      setOtherTyping(false);
    });

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void ch.track({ user_id: meId, at: Date.now() });
      }
    });

    channelRef.current = ch;

    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      channelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [chatId, meId, otherId]);

  /* ── The seller's heartbeat, for the buyer's headline ───────────── */
  useEffect(() => {
    // A seller does not poll themselves: their own heartbeat is what the
    // column holds, and their view of the buyer comes from presence.
    if (amSeller || !shopId) return;
    let stopped = false;

    async function poll() {
      if (stopped) return;
      const supabase = createClient();
      const { data } = await supabase.rpc("seller_is_online", { p_shop_id: shopId });
      if (!stopped && typeof data === "boolean") setSellerOnline(data);
    }

    // Re-read on a timer so a seller who closes the hub flips to Offline
    // without the buyer reloading the page.
    const timer = setInterval(poll, SELLER_POLL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [amSeller, shopId]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE_MS) return;
    lastTypingSent.current = now;
    void channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { from: meId },
    });
  }, [meId]);

  const stopTyping = useCallback(() => {
    lastTypingSent.current = 0;
    void channelRef.current?.send({
      type: "broadcast",
      event: "stop-typing",
      payload: { from: meId },
    });
  }, [meId]);

  const clearOtherTyping = useCallback(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    setOtherTyping(false);
  }, []);

  // A seller is "online" if their heartbeat says so OR they are in this
  // thread. A buyer is "online" only if they are in this thread — there is
  // no buyer heartbeat, and inventing one would be a claim we cannot back.
  const otherOnline = amSeller ? otherPresent : sellerOnline || otherPresent;

  return { otherOnline, otherTyping, notifyTyping, stopTyping, clearOtherTyping };
}

/**
 * Three dancing dots, shown under the conversation while the other party
 * composes. `aria-live` so a screen reader announces it once rather than
 * on every animation frame.
 */
export function TypingDots({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1.5" aria-live="polite">
      <span className="flex items-end gap-[3px]" aria-hidden>
        <span className="nm-typing-dot" />
        <span className="nm-typing-dot" style={{ animationDelay: "0.15s" }} />
        <span className="nm-typing-dot" style={{ animationDelay: "0.3s" }} />
      </span>
      <span className="text-[11px] text-ink-400">{label}</span>
    </div>
  );
}

/**
 * The online/offline headline at the top of the thread.
 *
 * Green dot + "Online", black dot + "Offline" — the two states the brief
 * names. The dot is `aria-hidden` and the word carries the meaning, so the
 * status is never colour-only.
 */
export function PresenceHeadline({ online }: { online: boolean }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold">
      <span
        aria-hidden
        className={`inline-block h-2 w-2 rounded-full ${
          online ? "bg-emerald-500" : "bg-ink-900"
        }`}
      />
      <span className={online ? "text-emerald-600" : "text-ink-900"}>
        {online ? "Online" : "Offline"}
      </span>
    </p>
  );
}
