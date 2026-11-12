"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { verifyPayment } from "@/app/admin-fuckliving/actions";
import { Spinner } from "@/components/ui";

/**
 * Receipt review — Part 3, Step 3.
 *
 * ── What the admin needs, in one glance ─────────────────────────────────────
 * The receipt image, the fields the AI read, and EXACTLY which rule failed.
 * That is the whole design goal: review should take seconds, not minutes.
 *
 * ── The AI's verdict is advisory ────────────────────────────────────────────
 * The Verify / Reject buttons are the admin's, and they call the same
 * `verifyPayment` action that existed before this feature. The AI panel above
 * them is evidence, not authority.
 */

type RuleResult = {
  rule: string;
  label: string;
  passed: boolean;
  detail: string;
  blocking: boolean;
};

type Receipt = {
  id: string;
  amount: number | null;
  txn_at: string | null;
  sender_name: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  txn_reference: string | null;
  success_wording: string | null;
  field_confidence: Record<string, number> | null;
  tamper_signals: string[] | null;
  tamper_score: number | null;
  rule_results: RuleResult[] | null;
  rules_passed: boolean;
  failed_rule: string | null;
  outcome: string;
  outcome_reason: string | null;
  ai_available: boolean;
  ai_model: string | null;
};

export function ReceiptReview({
  paymentId,
  receiptUrl,
  kind,
  label,
  receipt,
}: {
  paymentId: string;
  receiptUrl: string | null;
  kind: "order" | "subscription";
  label: string;
  /** The AI's reading of this receipt, if one exists. */
  receipt?: Receipt | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(false);
  const [showRules, setShowRules] = useState(false);

  async function decide(action: "verify" | "reject") {
    if (action === "reject" && reason.trim().length < 5) {
      setErr("A reason is required — the buyer sees it.");
      return;
    }
    setBusy(action);
    setErr("");
    const result = await verifyPayment(
      paymentId,
      action === "verify",
      action === "reject" ? reason.trim() : undefined,
    );
    setBusy("");
    if (!result.ok) {
      setErr(result.error ?? "Could not save.");
      return;
    }
    setRejecting(false);
    router.refresh();
  }

  const failed = receipt?.rule_results?.find((r) => r.blocking && !r.passed);

  return (
    <div className="shrink-0">
      <div className="flex items-start gap-2">
        <button
          onClick={() => receiptUrl && setZoom(true)}
          className="h-20 w-16 overflow-hidden rounded-lg border border-[var(--line)] bg-slate-50 text-[10px] text-ink-400"
          title="Open receipt"
        >
          {receiptUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={receiptUrl} alt="receipt" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full place-items-center">no file</span>
          )}
        </button>

        <div className="flex flex-col gap-1">
          <button onClick={() => decide("verify")} disabled={!!busy} className="nm-btn-primary !px-3 !py-1.5 !text-[11.5px]">
            {busy === "verify" ? <Spinner className="!h-3 !w-3" /> : kind === "order" ? "Verify" : "Approve"}
          </button>
          <button onClick={() => setRejecting(true)} className="nm-btn-ghost !px-3 !py-1.5 !text-[11.5px] !text-red-600">
            Reject
          </button>
        </div>
      </div>

      {err && <p className="mt-1 max-w-[180px] text-[10.5px] font-medium text-red-600">{err}</p>}

      {/* ── The AI's reading ───────────────────────────────────────────── */}
      {receipt && (
        <div className="mt-2 w-64 rounded-xl border border-[var(--line)] bg-slate-50/70 p-2">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold text-ink-700">
              {receipt.ai_available ? "AI read this receipt" : "AI could not read it"}
            </p>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${
                receipt.rules_passed
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {receipt.rules_passed ? "all checks passed" : "needs you"}
            </span>
          </div>

          {receipt.ai_available ? (
            <>
              <dl className="mt-1.5 space-y-0.5 text-[10.5px]">
                <Row k="Amount" v={receipt.amount != null ? `₦${Number(receipt.amount).toLocaleString()}` : "—"} />
                <Row k="Paid at" v={receipt.txn_at ? new Date(receipt.txn_at).toLocaleString() : "—"} />
                <Row k="Bank" v={receipt.bank_name ?? "—"} />
                <Row k="Account name" v={receipt.account_name ?? "—"} />
                <Row k="Reference" v={receipt.txn_reference ?? "—"} mono />
                <Row k="Sender" v={receipt.sender_name ?? "—"} />
              </dl>

              {failed && (
                <p className="mt-1.5 rounded-md bg-red-50 px-1.5 py-1 text-[10.5px] font-semibold text-red-800">
                  Failed: {failed.label} — {failed.detail}
                </p>
              )}

              {receipt.tamper_signals && receipt.tamper_signals.length > 0 && (
                <p className="mt-1 text-[10px] text-amber-700">
                  ⚠ {receipt.tamper_signals.join("; ")}
                </p>
              )}

              <button
                onClick={() => setShowRules((s) => !s)}
                className="mt-1.5 text-[10px] font-semibold text-brand-600 underline"
              >
                {showRules ? "Hide" : "Show"} all {receipt.rule_results?.length ?? 0} checks
              </button>

              {showRules && (
                <ul className="mt-1 space-y-0.5">
                  {(receipt.rule_results ?? []).map((r) => (
                    <li key={r.rule} className="flex items-start gap-1 text-[10px]">
                      <span className={r.passed ? "text-emerald-600" : r.blocking ? "text-red-600" : "text-amber-600"}>
                        {r.passed ? "✓" : r.blocking ? "✕" : "!"}
                      </span>
                      <span className="text-ink-600">
                        <span className="font-semibold">{r.label}</span> — {r.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-1 text-[10.5px] text-ink-500">
              {receipt.outcome_reason ?? "Automatic reading was unavailable."} Check the image yourself.
            </p>
          )}
        </div>
      )}

      {rejecting && (
        <div className="mt-2 w-56 rounded-xl border border-red-500/25 bg-red-50 p-2">
          <p className="text-[11px] font-bold text-red-900">Reject {label}?</p>
          <p className="text-[10px] text-red-900/70">The buyer is notified with your reason.</p>
          <textarea
            rows={2}
            className="nm-input mt-1 resize-none !py-1.5 !text-[11.5px]"
            placeholder="e.g. Amount received doesn't match"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-1 flex gap-1">
            <button onClick={() => decide("reject")} disabled={!!busy} className="flex-1 rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white">
              {busy === "reject" ? "…" : "Reject"}
            </button>
            <button onClick={() => setRejecting(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-ink-600">Cancel</button>
          </div>
        </div>
      )}

      {zoom && receiptUrl && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setZoom(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={receiptUrl} alt="receipt" className="max-h-[85vh] max-w-full rounded-xl bg-white object-contain" />
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="shrink-0 text-ink-400">{k}</dt>
      <dd className={`truncate text-right font-medium text-ink-800 ${mono ? "font-mono" : ""}`} title={v}>
        {v}
      </dd>
    </div>
  );
}
