"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, uploadToBucket } from "@/lib/supabase/client";
import { Spinner, Alert } from "@/components/ui";

export function UploadReceipt({ orderId, existingUrl }: { orderId: string; existingUrl: string | null }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  async function send() {
    if (!file) { setErr("Choose the receipt image first."); return; }
    setBusy(true); setErr("");
    try {
      const supabase = createClient();
      const url = await uploadToBucket(file, `receipts/${orderId}`);
      const { error } = await supabase.rpc("submit_receipt", { p_order_id: orderId, p_receipt_url: url });
      if (error) throw new Error(error.message);
      setOk(true);
      setBusy(false);
      router.refresh();
    } catch (e: any) {
      setBusy(false);
      setErr(e.message);
    }
  }

  if (ok) return <Alert tone="green" title="Receipt sent">We&apos;re checking it now — usually within a few hours.</Alert>;

  return (
    <div>
      {existingUrl && (
        <a href={existingUrl} target="_blank" rel="noreferrer" className="mb-2 block text-[12px] font-semibold text-brand-600">
          View the receipt you sent ↗
        </a>
      )}
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[var(--line)] px-3 py-2.5 text-[12.5px] text-ink-500 hover:border-brand-400 hover:bg-brand-50/40">
        <span className="text-brand-600">📎</span>
        {file ? file.name : "Upload transfer receipt"}
        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {err && <p className="mt-1.5 text-[12px] font-medium text-red-600">{err}</p>}
      <button onClick={send} disabled={busy || !file} className="nm-btn-primary mt-2 w-full !py-2.5">
        {busy ? <><Spinner /> Sending…</> : "Submit receipt"}
      </button>
    </div>
  );
}

export function ConfirmDelivery({ orderId, pickup }: { orderId: string; pickup: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("confirm_delivery", { p_order_id: orderId });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="nm-btn-primary w-full !py-2.5">
        {pickup ? "Confirm pickup" : "Confirm delivery"}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-50 p-3">
      <p className="text-[12.5px] font-bold text-amber-900">
        Confirm you have the item{pickup ? " in hand" : ""}?
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-amber-900/80">
        This releases the seller&apos;s money after 24 hours. You can&apos;t undo it — raise an issue instead if something is wrong.
      </p>
      {err && <p className="mt-1 text-[12px] font-medium text-red-600">{err}</p>}
      <div className="mt-2.5 flex gap-2">
        <button onClick={go} disabled={busy} className="nm-btn-primary flex-1 !py-2">
          {busy ? <Spinner /> : "Yes, I received it"}
        </button>
        <button onClick={() => setOpen(false)} className="nm-btn-ghost flex-1 !py-2">Not yet</button>
      </div>
    </div>
  );
}

export function RaiseIssue({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    if (reason.trim().length < 10) { setErr("Tell us what went wrong (a sentence or two)."); return; }
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("raise_dispute", { p_order_id: orderId, p_reason: reason.trim() });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="nm-btn-ghost w-full !py-2.5 !text-red-600 hover:!bg-red-50">
        Raise an issue
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-red-500/30 bg-red-50 p-3">
      <p className="text-[12.5px] font-bold text-red-900">What went wrong?</p>
      <textarea rows={3} className="nm-input mt-2 resize-none !text-[12.5px]" value={reason}
        onChange={(e) => setReason(e.target.value)} placeholder="The item arrived damaged / it never arrived / wrong item…" />
      {err && <p className="mt-1 text-[12px] font-medium text-red-600">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={go} disabled={busy} className="nm-btn-primary flex-1 !py-2 !bg-red-600 hover:!bg-red-700">
          {busy ? <Spinner /> : "Send to support"}
        </button>
        <button onClick={() => setOpen(false)} className="nm-btn-ghost flex-1 !py-2">Cancel</button>
      </div>
    </div>
  );
}

export function LeaveReview({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function go() {
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("leave_review", { p_order_id: orderId, p_rating: rating, p_body: body || null });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
    router.refresh();
  }

  if (done) return <Alert tone="green">Thanks — your review is live on the shop page.</Alert>;

  return (
    <div className="rounded-xl border border-[var(--line)] p-3">
      <p className="text-[12.5px] font-bold text-ink-900">Rate this order</p>
      <div className="mt-1.5 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} aria-label={`${n} stars`} className="text-xl leading-none">
            <span className={n <= rating ? "text-amber-400" : "text-slate-200"}>★</span>
          </button>
        ))}
      </div>
      <textarea rows={2} className="nm-input mt-2 resize-none !text-[12.5px]" value={body}
        onChange={(e) => setBody(e.target.value)} placeholder="How was the item and the seller?" />
      {err && <p className="mt-1 text-[12px] font-medium text-red-600">{err}</p>}
      <button onClick={go} disabled={busy} className="nm-btn-primary mt-2 w-full !py-2">
        {busy ? <Spinner /> : "Post review"}
      </button>
    </div>
  );
}
