"use client";

import { useState } from "react";
import { aiSupportChat } from "@/app/ai-actions";
import { Spinner } from "@/components/ui";

/**
 * Support chatbot — Part 1, feature 7.
 *
 * ── It answers from a fixed policy document, or hands off ───────────────────
 * The prompt forbids inventing a policy. When the model is unsure it sets
 * `handoff`, and the UI shows a real route to a human (WhatsApp) rather than a
 * dead end. That is the difference between a useful assistant and a liability.
 *
 * ── It is a floating panel, not a page ──────────────────────────────────────
 * Buyers should be able to ask without losing their place in the shop.
 */

type Turn = { role: "user" | "assistant"; content: string; handoff?: boolean };

export function SupportChat({ whatsapp }: { whatsapp: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;

    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: "user", content: q }]);
    setInput("");
    setBusy(true);

    try {
      const r = await aiSupportChat({ question: q, history });
      if (r.ok) {
        setTurns((t) => [
          ...t,
          { role: "assistant", content: r.data.answer, handoff: r.data.handoff },
        ]);
      } else {
        setTurns((t) => [
          ...t,
          {
            role: "assistant",
            content:
              "I can't answer that right now. Message our team on WhatsApp and a person will reply.",
            handoff: true,
          },
        ]);
      }
    } catch {
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: "I can't answer that right now. Message our team on WhatsApp and a person will reply.",
          handoff: true,
        },
      ]);
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 grid h-12 w-12 place-items-center rounded-full bg-ink-900 text-white shadow-lg transition hover:bg-ink-800"
        aria-label="Ask a question"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-2xl border border-[var(--line)] bg-white shadow-2xl sm:bottom-4 sm:rounded-2xl">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3.5 py-2.5">
        <div>
          <p className="text-[13px] font-bold text-ink-900">NaijaMart help</p>
          <p className="text-[10.5px] text-ink-400">Delivery, returns, payments, seller rules</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 text-[12px] font-semibold text-ink-500 hover:bg-slate-100"
        >
          Close
        </button>
      </div>

      <div className="max-h-[50vh] space-y-2 overflow-y-auto px-3.5 py-3">
        {turns.length === 0 && (
          <div className="space-y-1.5">
            <p className="text-[12px] text-ink-500">Ask about anything on NaijaMart:</p>
            {[
              "How long does delivery take?",
              "Can I get a refund?",
              "How do I become a seller?",
            ].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setInput(s)}
                className="block w-full rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-left text-[11.5px] text-ink-600 hover:border-brand-400 hover:bg-brand-50/40"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "text-right" : ""}>
            <div
              className={
                t.role === "user"
                  ? "inline-block max-w-[85%] rounded-2xl rounded-br-sm bg-brand-500 px-3 py-1.5 text-left text-[12px] text-white"
                  : "inline-block max-w-[90%] rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-1.5 text-[12px] text-ink-800"
              }
            >
              {t.content}
            </div>
            {t.handoff && (
              <a
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[11px] font-semibold text-brand-600 underline"
              >
                Message a person on WhatsApp →
              </a>
            )}
          </div>
        ))}

        {busy && (
          <div className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-100 px-3 py-1.5">
            <Spinner className="!h-3 !w-3" />
            <span className="text-[11.5px] text-ink-500">Thinking…</span>
          </div>
        )}
      </div>

      <div className="flex gap-1.5 border-t border-[var(--line)] p-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type your question…"
          className="nm-input !py-2 !text-[12.5px]"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !input.trim()}
          className="nm-btn-primary !px-3 !py-2 !text-[12px]"
        >
          Send
        </button>
      </div>
    </div>
  );
}
