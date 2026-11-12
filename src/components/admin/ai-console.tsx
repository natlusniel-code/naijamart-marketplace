"use client";

import { useState } from "react";
import { Spinner, Card, Badge } from "@/components/ui";
import {
  aiDailyDigest,
  aiDetectDuplicates,
  aiReviewSpam,
  aiSearchGaps,
  aiSalesNarrative,
  aiDecideSuggestion,
  aiSellerRisk,
  aiTriageComplaint,
  aiReviewListing,
  aiCleanupListing,
  aiAuditImage,
  aiPriceSanity,
  aiPayoutAnomaly,
  aiDraftReply,
} from "@/app/ai-actions";

/**
 * Admin AI console.
 *
 * ── The rule, made visible ──────────────────────────────────────────────────
 * Every panel here produces a FLAG. The admin accepts or dismisses it, and that
 * decision is written to `ai_suggestions`. Nothing on this page bans a seller,
 * approves a payout or issues a refund — those stay on their own screens, with
 * their own confirmations.
 */

type Suggestion = {
  id: string;
  feature: string;
  severity: string;
  title: string;
  detail: string | null;
  status: string;
  created_at: string;
};

export function AiConsole({ suggestions }: { suggestions: Suggestion[] }) {
  const [busy, setBusy] = useState("");
  const [digest, setDigest] = useState("");
  const [narrative, setNarrative] = useState("");
  const [dupes, setDupes] = useState<{ ids: string[]; reason: string }[] | null>(null);
  const [spam, setSpam] = useState<{ id: string; reason: string }[] | null>(null);
  const [gaps, setGaps] = useState<{ summary: string; opportunities: string[] } | null>(null);
  const [note, setNote] = useState("");
  const [decided, setDecided] = useState<Record<string, string>>({});

  // Single-subject tools: the admin pastes an id and gets a verdict.
  const [subjectId, setSubjectId] = useState("");
  const [subjectKind, setSubjectKind] = useState<
    "listing" | "shop" | "dispute" | "payout"
  >("listing");
  const [subjectOut, setSubjectOut] = useState<string[]>([]);
  const [draftIn, setDraftIn] = useState("");
  const [draftOut, setDraftOut] = useState("");

  async function runSubject() {
    const id = subjectId.trim();
    if (!id) {
      setNote("Paste the id of the listing, shop, dispute or payout first.");
      return;
    }
    setBusy("subject");
    setNote("");
    setSubjectOut([]);
    try {
      if (subjectKind === "listing") {
        const [review, image, price] = await Promise.all([
          aiReviewListing({ listingId: id }),
          aiAuditImage({ listingId: id }),
          aiPriceSanity({ listingId: id }),
        ]);
        const out: string[] = [];
        if (review.ok) {
          if (review.data.flags.length === 0) out.push("Listing review: nothing flagged.");
          else review.data.flags.forEach((f) => out.push(`[${f.severity}] ${f.title} — ${f.detail}`));
        } else out.push(`Listing review: ${review.error}`);
        if (image.ok && image.data.flag) out.push(`[${image.data.flag.severity}] ${image.data.flag.title} — ${image.data.flag.detail}`);
        if (price.ok && price.data.flag) out.push(`[${price.data.flag.severity}] ${price.data.flag.title} — ${price.data.flag.detail}`);
        setSubjectOut(out);
      } else if (subjectKind === "shop") {
        const r = await aiSellerRisk({ shopId: id });
        setSubjectOut(r.ok ? [r.data.summary] : [r.error]);
      } else if (subjectKind === "dispute") {
        const r = await aiTriageComplaint({ disputeId: id });
        setSubjectOut(r.ok ? [`Sorted as: ${r.data.category.replace(/_/g, " ")} — ${r.data.why}`] : [r.error]);
      } else {
        const r = await aiPayoutAnomaly({ payoutId: id });
        setSubjectOut(
          r.ok
            ? [r.data.flag ? `[${r.data.flag.severity}] ${r.data.flag.title} — ${r.data.flag.detail}` : "Payout matches completed orders."]
            : [r.error],
        );
      }
    } catch {
      setNote("That check is unavailable right now.");
    }
    setBusy("");
  }

  async function runCleanup() {
    const id = subjectId.trim();
    if (!id) {
      setNote("Paste a listing id first.");
      return;
    }
    setBusy("cleanup");
    setNote("");
    try {
      const r = await aiCleanupListing({ listingId: id });
      if (r.ok) {
        setSubjectOut([
          `Suggested title: ${r.data.title}`,
          `Suggested description: ${r.data.description}`,
          ...(r.data.category ? [`Suggested category: ${r.data.category}`] : []),
          ...r.data.changes.map((c) => `• ${c}`),
        ]);
      } else setNote(r.error);
    } catch {
      setNote("Cleanup is unavailable right now.");
    }
    setBusy("");
  }

  async function runDraft() {
    if (!draftIn.trim()) return;
    setBusy("draft");
    setDraftOut("");
    try {
      const r = await aiDraftReply({ message: draftIn });
      if (r.ok) setDraftOut(r.data.draft);
      else setNote(r.error);
    } catch {
      setNote("Drafting is unavailable right now.");
    }
    setBusy("");
  }

  async function run(kind: "digest" | "dupes" | "spam" | "gaps" | "narrative") {
    setBusy(kind);
    setNote("");
    try {
      if (kind === "digest") {
        const r = await aiDailyDigest();
        if (r.ok) setDigest(r.data.digest);
        else setNote(r.error);
      } else if (kind === "dupes") {
        const r = await aiDetectDuplicates();
        if (r.ok) setDupes(r.data.groups);
        else setNote(r.error);
      } else if (kind === "spam") {
        const r = await aiReviewSpam();
        if (r.ok) setSpam(r.data.suspicious);
        else setNote(r.error);
      } else if (kind === "gaps") {
        const r = await aiSearchGaps();
        if (r.ok) setGaps(r.data);
        else setNote(r.error);
      } else {
        const r = await aiSalesNarrative();
        if (r.ok) setNarrative(r.data.narrative);
        else setNote(r.error);
      }
    } catch {
      setNote("That report is unavailable right now. The underlying numbers are still on the dashboard.");
    }
    setBusy("");
  }

  async function decide(id: string, decision: "accepted" | "dismissed") {
    const r = await aiDecideSuggestion({ suggestionId: id, decision });
    if (r.ok) setDecided((d) => ({ ...d, [id]: decision }));
    else setNote(r.error);
  }

  const btn =
    "rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-700 transition hover:border-brand-400 hover:bg-brand-50/50 disabled:opacity-50";

  const sevTone = (s: string) => (s === "high" ? "red" : s === "warn" ? "amber" : "gray") as "red" | "amber" | "gray";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">AI assistant</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          The AI flags. You decide. Nothing here changes a seller, a payout or a refund on its own.
        </p>
      </div>

      {note && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-900">
          {note}
        </div>
      )}

      {/* reports */}
      <Card className="p-4">
        <p className="text-[14px] font-bold text-ink-900">Reports</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button onClick={() => run("digest")} disabled={!!busy} className={btn}>
            {busy === "digest" ? <Spinner className="!h-3 !w-3" /> : "Morning digest"}
          </button>
          <button onClick={() => run("narrative")} disabled={!!busy} className={btn}>
            {busy === "narrative" ? <Spinner className="!h-3 !w-3" /> : "This week's story"}
          </button>
          <button onClick={() => run("dupes")} disabled={!!busy} className={btn}>
            {busy === "dupes" ? <Spinner className="!h-3 !w-3" /> : "Duplicate listings"}
          </button>
          <button onClick={() => run("spam")} disabled={!!busy} className={btn}>
            {busy === "spam" ? <Spinner className="!h-3 !w-3" /> : "Fake reviews"}
          </button>
          <button onClick={() => run("gaps")} disabled={!!busy} className={btn}>
            {busy === "gaps" ? <Spinner className="!h-3 !w-3" /> : "Search gaps"}
          </button>
        </div>

        {digest && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] font-semibold text-ink-400">Morning digest</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700">{digest}</p>
          </div>
        )}

        {narrative && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] font-semibold text-ink-400">This week</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700">{narrative}</p>
          </div>
        )}

        {dupes && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] font-semibold text-ink-400">
              Duplicate groups: {dupes.length}
            </p>
            {dupes.length === 0 ? (
              <p className="mt-1 text-[12px] text-ink-500">No duplicates found.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {dupes.map((g, i) => (
                  <li key={i} className="text-[12px] text-ink-700">
                    <span className="font-semibold">{g.ids.length} listings</span> — {g.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {spam && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] font-semibold text-ink-400">
              Suspicious reviews: {spam.length}
            </p>
            {spam.length === 0 ? (
              <p className="mt-1 text-[12px] text-ink-500">Nothing suspicious found.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {spam.map((s) => (
                  <li key={s.id} className="text-[12px] text-ink-700">{s.reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {gaps && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] font-semibold text-ink-400">Search gaps</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700">{gaps.summary}</p>
            {gaps.opportunities.length > 0 && (
              <ul className="mt-1.5 list-inside list-disc text-[12px] text-ink-600">
                {gaps.opportunities.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* single-subject checks */}
      <Card className="p-4">
        <p className="text-[14px] font-bold text-ink-900">Check one thing</p>
        <p className="mt-0.5 text-[12px] text-ink-500">
          Paste an id and the AI will flag what it sees. You still decide.
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <select
            value={subjectKind}
            onChange={(e) => setSubjectKind(e.target.value as any)}
            className="nm-input !w-auto !py-1.5 !text-[12px]"
          >
            <option value="listing">Listing</option>
            <option value="shop">Seller</option>
            <option value="dispute">Complaint</option>
            <option value="payout">Payout</option>
          </select>
          <input
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            placeholder="id…"
            className="nm-input !w-64 !py-1.5 !font-mono !text-[11.5px]"
          />
          <button onClick={runSubject} disabled={!!busy} className={btn}>
            {busy === "subject" ? <Spinner className="!h-3 !w-3" /> : "Check"}
          </button>
          {subjectKind === "listing" && (
            <button onClick={runCleanup} disabled={!!busy} className={btn}>
              {busy === "cleanup" ? <Spinner className="!h-3 !w-3" /> : "Clean up text"}
            </button>
          )}
        </div>

        {subjectOut.length > 0 && (
          <ul className="mt-2 space-y-1 rounded-xl bg-slate-50 p-3">
            {subjectOut.map((line, i) => (
              <li key={i} className="text-[12px] leading-relaxed text-ink-700">{line}</li>
            ))}
          </ul>
        )}
      </Card>

      {/* support drafting */}
      <Card className="p-4">
        <p className="text-[14px] font-bold text-ink-900">Draft a support reply</p>
        <p className="mt-0.5 text-[12px] text-ink-500">
          Paste the buyer's message. You review and send it yourself.
        </p>
        <textarea
          rows={3}
          value={draftIn}
          onChange={(e) => setDraftIn(e.target.value)}
          placeholder="Buyer's message…"
          className="nm-input mt-2 resize-none !text-[12.5px]"
        />
        <button onClick={runDraft} disabled={!!busy || !draftIn.trim()} className={`${btn} mt-1.5`}>
          {busy === "draft" ? <Spinner className="!h-3 !w-3" /> : "Draft reply"}
        </button>
        {draftOut && (
          <div className="mt-2 rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] font-semibold text-ink-400">Draft</p>
            <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-700">{draftOut}</p>
          </div>
        )}
      </Card>

      {/* the queue */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-bold text-ink-900">Flagged for review</p>
          <p className="text-[12px] text-ink-500">{suggestions.length} open</p>
        </div>

        {suggestions.length === 0 ? (
          <p className="mt-1.5 text-[12.5px] text-ink-500">
            Nothing flagged. Run a report above, or open a listing to check it.
          </p>
        ) : (
          <div className="mt-2.5 space-y-2">
            {suggestions.map((s) => {
              const state = decided[s.id] ?? s.status;
              return (
                <div key={s.id} className="rounded-xl border border-[var(--line)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={sevTone(s.severity)}>{s.severity}</Badge>
                        <span className="text-[10.5px] font-mono text-ink-400">{s.feature}</span>
                      </div>
                      <p className="mt-1 text-[13px] font-semibold text-ink-900">{s.title}</p>
                      {s.detail && <p className="mt-0.5 text-[12px] text-ink-600">{s.detail}</p>}
                    </div>

                    {state === "open" ? (
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => decide(s.id, "accepted")}
                          className="rounded-md bg-ink-900 px-2.5 py-1 text-[11px] font-semibold text-white"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => decide(s.id, "dismissed")}
                          className="rounded-md border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-ink-600"
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : (
                      <Badge tone={state === "accepted" ? "green" : "gray"}>{state}</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
