"use client";

import { useRef, useState } from "react";
import { askBuyerSupport } from "@/app/(shop)/profile/support/actions";
import { Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "assistant"; body: string };

/**
 * The questions a buyer actually asks, as one-tap starters.
 *
 * These are the four that would otherwise become a WhatsApp message: where
 * is my order, how does payment work, can I pick it up, and how do I get a
 * refund. Tapping one sends it immediately, so a buyer on a phone does not
 * have to type.
 */
const STARTERS = [
  "Where is my order?",
  "How does payment work?",
  "Can I pick up my order instead?",
  "How do I get a refund?",
];

/**
 * The buyer support chat.
 *
 * ── Why it looks like the admin copilot ───────────────────────────────
 * Same bubble layout, same input row, same colours — a buyer who has seen
 * one AI surface in this app should recognise the other. The only
 * difference is the footer: this one says plainly that it cannot change
 * an order, because a buyer is more likely than an admin to assume it can.
 */
export function SupportChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    setErr("");
    setText("");
    setBusy(true);

    const history = turns.map((t) => ({ role: t.role, body: t.body }));
    setTurns((prev) => [...prev, { role: "user", body: q }]);

    const result = await askBuyerSupport({ question: q, history });
    setBusy(false);

    if (!result.ok) {
      setErr(result.error ?? "The support assistant could not answer.");
      return;
    }

    setTurns((prev) => [...prev, { role: "assistant", body: result.answer ?? "" }]);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  return (
    <div className="space-y-3">
      {turns.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          {STARTERS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[11.5px] font-semibold text-ink-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2.5">
        {turns.map((t, i) => (
          <div key={i} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5",
                t.role === "user" ? "bg-ink-900 text-white" : "border border-[var(--line)] bg-white",
              )}
            >
              <p
                className={cn(
                  "whitespace-pre-wrap text-[12.5px] leading-relaxed",
                  t.role === "user" ? "text-white" : "text-ink-800",
                )}
              >
                {t.body}
              </p>
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-[var(--line)] bg-white px-3.5 py-2.5">
              <Spinner />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {err && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">{err}</p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about your order, delivery or payment…"
          className="nm-input flex-1"
          aria-label="Ask support"
        />
        <button disabled={busy || !text.trim()} className="nm-btn-primary !px-4">
          Ask
        </button>
      </form>

      <p className="text-[11px] leading-relaxed text-ink-400">
        Support reads your own orders and the platform rules. It cannot cancel, refund or change an
        order — for that, raise an issue on the order or message a human on the Help page.
      </p>
    </div>
  );
}
