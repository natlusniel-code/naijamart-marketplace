"use client";

import { useState } from "react";
import { aiOrderStatus } from "@/app/ai-actions";
import { Spinner } from "@/components/ui";

/**
 * Order-status assistant — Part 1, feature 9.
 *
 * ── The AI never queries the database ───────────────────────────────────────
 * The order is fetched server-side under the buyer's own RLS and passed in with
 * the question. The prompt tells the model it cannot look anything up, so it
 * cannot claim to have checked something it never saw.
 *
 * ── It is a question box, not a status display ──────────────────────────────
 * The page already shows the status. This answers the follow-up: "why is it
 * still pending?", "when will it ship?".
 */
export function OrderAssistant({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [handoff, setHandoff] = useState(false);
  const [busy, setBusy] = useState(false);

  async function ask() {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setAnswer("");
    setHandoff(false);
    try {
      const r = await aiOrderStatus({ question, orderId });
      if (r.ok) {
        setAnswer(r.data.answer);
        setHandoff(r.data.handoff);
      } else {
        setAnswer("I can't answer that right now. Message the seller from this order and they'll reply.");
        setHandoff(true);
      }
    } catch {
      setAnswer("I can't answer that right now. Message the seller from this order and they'll reply.");
      setHandoff(true);
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12.5px] font-semibold text-brand-600 underline"
      >
        Ask about this order
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-slate-50/70 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-bold text-ink-900">Ask about this order</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] font-semibold text-ink-500"
        >
          Close
        </button>
      </div>

      <div className="mt-1.5 flex gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="e.g. Why is it still pending?"
          className="nm-input !py-1.5 !text-[12px]"
        />
        <button
          type="button"
          onClick={ask}
          disabled={busy || !q.trim()}
          className="nm-btn-primary !px-3 !py-1.5 !text-[11.5px]"
        >
          {busy ? <Spinner className="!h-3 !w-3" /> : "Ask"}
        </button>
      </div>

      {answer && (
        <div className="mt-2 rounded-lg bg-white p-2">
          <p className="text-[12px] leading-relaxed text-ink-700">{answer}</p>
          {handoff && (
            <p className="mt-1 text-[11px] text-ink-500">
              A person can help further — message the seller from this order.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
