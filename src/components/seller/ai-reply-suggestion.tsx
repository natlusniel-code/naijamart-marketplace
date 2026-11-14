"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui";

/**
 * The AI reply suggestion, shown to the seller while they are online.
 *
 * ── What it does ─────────────────────────────────────────────────────────
 * Reads the pending suggestion the server wrote after the buyer's last
 * message and offers it three ways: **Send** (as written), **Edit** (drops
 * it into the composer so the seller can change it) and **Dismiss**.
 * Nothing is sent unless the seller presses send.
 *
 * ── Why it reloads on new messages ───────────────────────────────────────
 * A suggestion is only about the buyer's LATEST message. When a new one
 * arrives the old draft is stale, so this watches the same `messages`
 * channel the thread uses and refetches. Showing a reply to a question the
 * buyer has already moved on from would be actively unhelpful.
 *
 * ── Why it can be turned off ─────────────────────────────────────────────
 * `shops.ai_reply_enabled` is the seller's switch, honoured on the server.
 * A seller who wants no AI in their shop turns it off in the chat header
 * and this component renders nothing.
 */
export function AiReplySuggestion({
  chatId,
  enabled = true,
  onUse,
  onDismissed,
}: {
  chatId: string;
  /** Read from `shops.ai_reply_enabled`. */
  enabled?: boolean;
  /** Drop the text into the composer. */
  onUse: (body: string) => void;
  /** Called once the seller dismisses, so the parent can stop showing it. */
  onDismissed?: () => void;
}) {
  const [suggestion, setSuggestion] = useState<{
    id: string;
    body: string;
    mode: string;
    status: string;
    error: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    async function load() {
      // A `failed` row is shown too: it carries the reason the AI could not
      // write a draft, which is the difference between "the AI is broken"
      // and "the AI had nothing to say". Without it a failure was silence.
      const { data } = await supabase
        .from("ai_reply_suggestions")
        .select("id,body,mode,status,error")
        .eq("chat_id", chatId)
        .in("status", ["pending", "failed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      setSuggestion(
        data
          ? {
              id: data.id,
              body: data.body ?? "",
              mode: data.mode,
              status: data.status,
              error: (data as any).error ?? null,
            }
          : null,
      );
      setLoading(false);
    }

    load();

    // Refetch whenever a new message lands: the draft is about the latest
    // buyer message and nothing else.
    const channel = supabase
      .channel(`ai-suggest-${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [chatId, enabled]);

  async function dismiss() {
    if (!suggestion) return;
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("ai_reply_suggestions")
      .update({ status: "dismissed" })
      .eq("id", suggestion.id);
    setBusy(false);
    setSuggestion(null);
    onDismissed?.();
  }

  if (!enabled || loading) return null;
  if (!suggestion) return null;

  // ── The AI could not write a draft ──────────────────────────────────────
  // Shown instead of nothing. The seller gets the reason and a way to clear
  // it; the buyer's message is already saved either way.
  if (suggestion.status === "failed") {
    return (
      <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-amber-800">
            <span aria-hidden>✨</span> AI reply unavailable
          </p>
          <button
            onClick={dismiss}
            disabled={busy}
            className="shrink-0 text-[10.5px] font-semibold text-amber-700 hover:text-amber-900"
            aria-label="Dismiss AI error"
          >
            {busy ? <Spinner /> : "Dismiss"}
          </button>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-amber-900">
          {suggestion.error ??
            "The AI could not write a reply for this message. Your buyer's message is saved — reply manually or try again."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-brand-200 bg-brand-50/70 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-brand-700">
          <span aria-hidden>✨</span> Suggested reply
        </p>
        <button
          onClick={dismiss}
          disabled={busy}
          className="text-[10.5px] font-semibold text-ink-400 hover:text-ink-700"
          aria-label="Dismiss suggestion"
        >
          {busy ? <Spinner /> : "Dismiss"}
        </button>
      </div>

      <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-800">
        {suggestion.body}
      </p>

      <div className="mt-2 flex items-center gap-1.5">
        <button
          onClick={() => onUse(suggestion.body)}
          className="nm-btn-primary !px-3 !py-1.5 !text-[11.5px]"
        >
          Use this
        </button>
        <span className="text-[10.5px] text-ink-400">
          You can edit it before sending.
        </span>
      </div>
    </div>
  );
}
