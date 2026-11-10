"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setShopStatus, toggleShopSuspend } from "@/app/admin-fuckliving/actions";
import { Spinner } from "@/components/ui";

export function SellerDecision({ shopId }: { shopId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [mode, setMode] = useState<"" | "reject" | "info">("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  async function act(action: "approve" | "request_info" | "reject") {
    if (action !== "approve" && note.trim().length < 5) {
      setErr("Write a short message — the seller receives it.");
      return;
    }
    setBusy(action); setErr("");
    // One Server Action covers all three outcomes: status + note (+ verify on approve).
    const nextStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending";
    const result = await setShopStatus(
      shopId,
      nextStatus,
      action === "approve" ? null : note.trim(),
      action === "approve" ? true : null,
    );
    setBusy("");
    if (!result.ok) { setErr(result.error ?? "Could not save."); return; }
    setMode("");
    router.refresh();
  }

  if (mode) {
    return (
      <div className="w-60 rounded-xl border border-[var(--line)] bg-slate-50 p-2.5">
        <p className="text-[11.5px] font-bold text-ink-900">
          {mode === "reject" ? "Reject this application?" : "Ask for more information"}
        </p>
        <textarea
          rows={2}
          className="nm-input mt-1 resize-none !py-1.5 !text-[11.5px]"
          placeholder={mode === "reject" ? "e.g. CAC number doesn't match the shop name" : "e.g. Upload a clearer CAC certificate"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {err && <p className="mt-1 text-[10.5px] font-medium text-red-600">{err}</p>}
        <div className="mt-1.5 flex gap-1.5">
          <button onClick={() => act(mode === "reject" ? "reject" : "request_info")} disabled={!!busy}
            className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-white ${mode === "reject" ? "bg-red-600" : "bg-ink-900"}`}>
            {busy ? "…" : mode === "reject" ? "Reject" : "Send"}
          </button>
          <button onClick={() => setMode("")} className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-ink-600">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 text-right">
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => act("approve")} disabled={!!busy} className="nm-btn-primary !px-3 !py-1.5 !text-[11.5px]">
          {busy === "approve" ? <Spinner className="!h-3 !w-3" /> : "Approve"}
        </button>
        <button onClick={() => setMode("info")} className="nm-btn-ghost !px-3 !py-1.5 !text-[11.5px]">Request more info</button>
        <button onClick={() => setMode("reject")} className="nm-btn-ghost !px-3 !py-1.5 !text-[11.5px] !text-red-600">Reject</button>
      </div>
      {err && <p className="mt-1 text-[10.5px] font-medium text-red-600">{err}</p>}
    </div>
  );
}

export function SellerSuspend({ shopId, status }: { shopId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const suspended = status === "suspended";

  async function toggle() {
    setBusy(true);
    const result = await toggleShopSuspend(shopId, suspended);
    setBusy(false);
    if (!result.ok) { setErr(result.error ?? "Could not save."); return; }
    setErr("");
    router.refresh();
  }

  return (
    <div className="text-right">
      <button onClick={toggle} disabled={busy} className={`text-[11.5px] font-semibold ${suspended ? "text-brand-600" : "text-red-600"}`}>
        {busy ? "…" : suspended ? "Reactivate" : "Suspend"}
      </button>
      {err && <p className="mt-0.5 text-[10.5px] font-medium text-red-600">{err}</p>}
    </div>
  );
}
