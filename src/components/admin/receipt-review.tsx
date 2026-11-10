"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { verifyPayment } from "@/app/admin-fuckliving/actions";
import { Spinner } from "@/components/ui";

export function ReceiptReview({
  paymentId,
  receiptUrl,
  kind,
  label,
}: {
  paymentId: string;
  receiptUrl: string | null;
  kind: "order" | "subscription";
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(false);

  async function decide(action: "verify" | "reject") {
    if (action === "reject" && reason.trim().length < 5) {
      setErr("A reason is required — the buyer sees it.");
      return;
    }
    setBusy(action); setErr("");
    // Server Action: runs with the service-role key, so the DB guard still holds.
    const result = await verifyPayment(
      paymentId,
      action === "verify",
      action === "reject" ? reason.trim() : undefined,
    );
    setBusy("");
    if (!result.ok) { setErr(result.error ?? "Could not save."); return; }
    setRejecting(false);
    router.refresh();
  }

  return (
    <div className="shrink-0">
      <div className="flex items-start gap-2">
        {/* receipt thumbnail */}
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
          <button onClick={() => setRejecting(true)} className="nm-btn-ghost !px-3 !py-1.5 !text-[11.5px] !text-red-600">Reject</button>
        </div>
      </div>

      {err && <p className="mt-1 max-w-[180px] text-[10.5px] font-medium text-red-600">{err}</p>}

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
