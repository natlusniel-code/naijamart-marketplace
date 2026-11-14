"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, Spinner, Alert } from "@/components/ui";
import { addFaq, deleteFaq, listFaqs, updateFaq, type FaqRow } from "@/app/seller/(hub)/settings/faq-actions";

/**
 * The seller's own FAQs, used to condition the AI buyer reply.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 * The AI reply already knows the shop's delivery fee, its listings and the
 * recent thread. It does NOT know the things a seller answers in their own
 * words — "do you deliver to Ibadan", "can I pay on delivery", "how long
 * does a custom order take". A Premium seller writes those answers here
 * once, and the AI is given them as the seller's own words, so its replies
 * follow the seller's FAQ content instead of guessing.
 *
 * ── Why it is only rendered for Premium ──────────────────────────────────
 * The parent page checks `shopHasFeature(shop.id, "aiReply")` and renders
 * this only when it is true, so a Basic seller never sees it. The server
 * actions re-check the same gate, so hiding the UI is not the only defence.
 */
export function SellerFaqManager({ initialFaqs }: { initialFaqs: FaqRow[] }) {
  const [faqs, setFaqs] = useState<FaqRow[]>(initialFaqs);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQ, setEditQ] = useState("");
  const [editA, setEditA] = useState("");
  const [pending, startTransition] = useTransition();

  // Keep in step if the server re-renders with a fresh list.
  useEffect(() => {
    setFaqs(initialFaqs);
  }, [initialFaqs]);

  function add() {
    setErr("");
    setNotice("");
    if (!question.trim()) {
      setErr("Write the question.");
      return;
    }
    if (!answer.trim()) {
      setErr("Write the answer.");
      return;
    }
    startTransition(async () => {
      const res = await addFaq({ question, answer });
      if (!res.ok) {
        setErr(res.error ?? "Could not save that FAQ.");
        return;
      }
      setFaqs(res.faqs ?? []);
      setQuestion("");
      setAnswer("");
      setNotice("FAQ added. The AI will use it when replying to buyers.");
    });
  }

  function saveEdit(id: string) {
    setErr("");
    setNotice("");
    startTransition(async () => {
      const res = await updateFaq({ id, question: editQ, answer: editA });
      if (!res.ok) {
        setErr(res.error ?? "Could not update that FAQ.");
        return;
      }
      setFaqs(res.faqs ?? []);
      setEditingId(null);
      setNotice("FAQ updated.");
    });
  }

  function remove(id: string) {
    setErr("");
    setNotice("");
    startTransition(async () => {
      const res = await deleteFaq(id);
      if (!res.ok) {
        setErr(res.error ?? "Could not delete that FAQ.");
        return;
      }
      setFaqs(res.faqs ?? []);
      setNotice("FAQ removed.");
    });
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold text-ink-900">Your FAQs</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-500">
            Write the answers you give buyers most often. The AI reply uses them, so it
            answers the way you would.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-brand-700">
          Premium
        </span>
      </div>

      {err && (
        <div className="mt-2.5">
          <Alert tone="red">{err}</Alert>
        </div>
      )}
      {notice && !err && (
        <div className="mt-2.5">
          <Alert tone="green">{notice}</Alert>
        </div>
      )}

      {/* existing FAQs */}
      {faqs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {faqs.map((f) => (
            <li key={f.id} className="rounded-xl border border-[var(--line)] bg-slate-50/60 p-2.5">
              {editingId === f.id ? (
                <div className="space-y-2">
                  <input
                    className="nm-input"
                    value={editQ}
                    onChange={(e) => setEditQ(e.target.value)}
                    placeholder="Question"
                    maxLength={200}
                  />
                  <textarea
                    rows={3}
                    className="nm-input resize-y"
                    value={editA}
                    onChange={(e) => setEditA(e.target.value)}
                    placeholder="Answer"
                    maxLength={1000}
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => saveEdit(f.id)}
                      disabled={pending}
                      className="nm-btn-primary !px-3 !py-1.5 !text-[11.5px]"
                    >
                      {pending ? <Spinner /> : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="nm-btn-ghost !px-3 !py-1.5 !text-[11.5px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12.5px] font-bold text-ink-900">{f.question}</p>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(f.id);
                          setEditQ(f.question);
                          setEditA(f.answer);
                          setErr("");
                          setNotice("");
                        }}
                        className="text-[11px] font-semibold text-brand-700 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(f.id)}
                        disabled={pending}
                        className="text-[11px] font-semibold text-ink-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-700">
                    {f.answer}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {faqs.length === 0 && (
        <p className="mt-3 rounded-xl border border-dashed border-[var(--line)] bg-slate-50/60 px-3 py-4 text-center text-[11.5px] leading-relaxed text-ink-400">
          No FAQs yet. Add your first one below — for example “Do you deliver to Ibadan?”
        </p>
      )}

      {/* add a new FAQ */}
      <div className="mt-3 space-y-2 border-t border-[var(--line)] pt-3">
        <p className="text-[12px] font-bold text-ink-900">Add an FAQ</p>
        <input
          className="nm-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Do you deliver to Ibadan?"
          maxLength={200}
        />
        <textarea
          rows={3}
          className="nm-input resize-y"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="e.g. Yes — delivery to Ibadan is ₦1,500 and takes 2 days."
          maxLength={1000}
        />
        <button
          type="button"
          onClick={add}
          disabled={pending}
          className="nm-btn-primary w-full !py-2.5 !text-[13px]"
        >
          {pending ? <Spinner /> : "Add FAQ"}
        </button>
      </div>
    </Card>
  );
}
