"use client";

import { useState } from "react";
import { aiSummariseReviews } from "@/app/ai-actions";
import { Spinner } from "@/components/ui";

/**
 * Review summariser — Part 1, feature 13.
 *
 * Groups what reviewers actually said into positives, complaints and themes.
 * It is a button, not an automatic render: a shop with 200 reviews should not
 * pay for a summary on every page view, and a buyer who wants the raw reviews
 * should not have to scroll past a summary to find them.
 */
export function ReviewSummary({ shopId, count }: { shopId: string; count: number }) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<{
    positives: string[];
    complaints: string[];
    themes: string[];
  } | null>(null);
  const [note, setNote] = useState("");

  if (count < 3) return null;

  async function run() {
    setBusy(true);
    setNote("");
    try {
      const r = await aiSummariseReviews({ shopId });
      if (r.ok) setData(r.data);
      else setNote("A summary isn't available right now — the reviews below are all there.");
    } catch {
      setNote("A summary isn't available right now — the reviews below are all there.");
    }
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-slate-50/60 p-3">
      {!data ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-ink-600">
            {count} reviews — want the short version?
          </p>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="shrink-0 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-ink-700 hover:border-brand-400"
          >
            {busy ? <Spinner className="!h-3 !w-3" /> : "Summarise"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {data.positives.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-emerald-700">What buyers liked</p>
              <ul className="mt-0.5 list-inside list-disc text-[11.5px] text-ink-600">
                {data.positives.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
          {data.complaints.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-amber-700">What they complained about</p>
              <ul className="mt-0.5 list-inside list-disc text-[11.5px] text-ink-600">
                {data.complaints.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
          {data.themes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.themes.map((t) => (
                <span key={t} className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-medium text-ink-600">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {note && <p className="mt-1 text-[11px] text-ink-500">{note}</p>}
    </div>
  );
}
