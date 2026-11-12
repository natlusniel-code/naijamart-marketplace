"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui";
import {
  aiWriteDescription,
  aiImproveTitle,
  aiSuggestTags,
  aiFixGrammar,
  aiCheckImage,
} from "@/app/ai-actions";

/**
 * Seller writing tools — Part 1, features 1–5.
 *
 * ── Every suggestion is opt-in ──────────────────────────────────────────────
 * Nothing here writes to the listing. Each tool shows its result with an
 * "Use this" button; the seller decides. That is both a trust decision and a
 * practical one — a seller knows their product better than the model does.
 *
 * ── Degradation is visible, not silent ──────────────────────────────────────
 * When the AI is unavailable the panel shows the code-side fallback and a quiet
 * note. It never shows an error dialog for an optional feature.
 */

type Props = {
  title: string;
  description: string;
  specs?: string;
  category?: string;
  price?: number;
  imageUrl?: string;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
  onTags?: (tags: string[]) => void;
};

export function AiListingTools({
  title,
  description,
  specs = "",
  category,
  price,
  imageUrl,
  onTitle,
  onDescription,
  onTags,
}: Props) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{
    kind: "title" | "description" | "tags" | "grammar" | "image";
    title?: string;
    description?: string;
    why?: string;
    tags?: string[];
    changes?: string[];
    score?: number;
    issues?: string[];
    advice?: string;
  } | null>(null);

  async function run(kind: "title" | "description" | "tags" | "grammar" | "image") {
    setBusy(kind);
    setNote("");
    setResult(null);

    try {
      if (kind === "title") {
        const r = await aiImproveTitle({ title, category });
        if (r.ok) setResult({ kind, title: r.data.title, why: r.data.why });
        else {
          setResult({ kind, title: r.fallback?.title, why: r.fallback?.why });
          setNote(r.error);
        }
      } else if (kind === "description") {
        const r = await aiWriteDescription({ name: title, specs, category, price });
        if (r.ok) setResult({ kind, title: r.data.title, description: r.data.description });
        else {
          setResult({ kind, title: r.fallback?.title, description: r.fallback?.description });
          setNote(r.error);
        }
      } else if (kind === "tags") {
        const r = await aiSuggestTags({ title, description });
        if (r.ok) setResult({ kind, tags: r.data.tags });
        else {
          setResult({ kind, tags: r.fallback?.tags });
          setNote(r.error);
        }
      } else if (kind === "grammar") {
        const r = await aiFixGrammar({ text: description });
        if (r.ok) setResult({ kind, description: r.data.text, changes: r.data.changes });
        else {
          setResult({ kind, description: r.fallback?.text, changes: r.fallback?.changes });
          setNote(r.error);
        }
      } else {
        if (!imageUrl) {
          setNote("Add a photo first, then run the check.");
          setBusy("");
          return;
        }
        const r = await aiCheckImage({ imageUrl });
        if (r.ok) setResult({ kind, score: r.data.score, issues: r.data.issues, advice: r.data.advice });
        else {
          setResult({ kind, score: r.fallback?.score, issues: r.fallback?.issues, advice: r.fallback?.advice });
          setNote(r.error);
        }
      }
    } catch {
      setNote("That tool is unavailable right now. You can still write the listing yourself.");
    }
    setBusy("");
  }

  const btn =
    "rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-700 transition hover:border-brand-400 hover:bg-brand-50/50 disabled:opacity-50";

  return (
    <div className="rounded-xl border border-brand-500/20 bg-brand-50/40 p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px]">✨</span>
        <p className="text-[12px] font-bold text-ink-900">Writing help</p>
        <span className="ml-auto text-[10.5px] text-ink-400">optional</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => run("title")} disabled={!!busy || !title.trim()} className={btn}>
          {busy === "title" ? <Spinner className="!h-3 !w-3" /> : "Improve title"}
        </button>
        <button type="button" onClick={() => run("description")} disabled={!!busy || !title.trim()} className={btn}>
          {busy === "description" ? <Spinner className="!h-3 !w-3" /> : "Write description"}
        </button>
        <button type="button" onClick={() => run("tags")} disabled={!!busy || !title.trim()} className={btn}>
          {busy === "tags" ? <Spinner className="!h-3 !w-3" /> : "Suggest tags"}
        </button>
        <button type="button" onClick={() => run("grammar")} disabled={!!busy || !description.trim()} className={btn}>
          {busy === "grammar" ? <Spinner className="!h-3 !w-3" /> : "Fix spelling"}
        </button>
        <button type="button" onClick={() => run("image")} disabled={!!busy || !imageUrl} className={btn}>
          {busy === "image" ? <Spinner className="!h-3 !w-3" /> : "Check photo"}
        </button>
      </div>

      {note && <p className="mt-2 text-[11px] text-amber-700">{note}</p>}

      {result && (
        <div className="mt-2.5 rounded-lg border border-[var(--line)] bg-white p-2.5">
          {result.kind === "title" && result.title && (
            <>
              <p className="text-[11px] font-semibold text-ink-400">Suggested title</p>
              <p className="mt-0.5 text-[12.5px] font-semibold text-ink-900">{result.title}</p>
              {result.why && <p className="mt-0.5 text-[11px] text-ink-500">{result.why}</p>}
              <button
                type="button"
                onClick={() => { onTitle(result.title!); setResult(null); }}
                className="mt-1.5 rounded-md bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white"
              >
                Use this title
              </button>
            </>
          )}

          {(result.kind === "description" || result.kind === "grammar") && result.description && (
            <>
              <p className="text-[11px] font-semibold text-ink-400">
                {result.kind === "grammar" ? "Corrected text" : "Suggested description"}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-700">
                {result.description}
              </p>
              {result.changes && result.changes.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-[10.5px] text-ink-500">
                  {result.changes.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              )}
              <button
                type="button"
                onClick={() => { onDescription(result.description!); setResult(null); }}
                className="mt-1.5 rounded-md bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white"
              >
                Use this text
              </button>
            </>
          )}

          {result.kind === "tags" && result.tags && (
            <>
              <p className="text-[11px] font-semibold text-ink-400">Suggested tags</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {result.tags.map((t) => (
                  <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-ink-600">
                    {t}
                  </span>
                ))}
              </div>
              {onTags && (
                <button
                  type="button"
                  onClick={() => { onTags(result.tags!); setResult(null); }}
                  className="mt-1.5 rounded-md bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  Add these tags
                </button>
              )}
            </>
          )}

          {result.kind === "image" && (
            <>
              <p className="text-[11px] font-semibold text-ink-400">
                Photo score: {result.score}/100
              </p>
              {result.issues && result.issues.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-[11px] text-amber-700">
                  {result.issues.map((i, n) => <li key={n}>{i}</li>)}
                </ul>
              )}
              {result.advice && <p className="mt-1 text-[11.5px] text-ink-600">{result.advice}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
