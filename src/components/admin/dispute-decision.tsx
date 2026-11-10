"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolveDispute } from "@/app/admin-fuckliving/actions";

export function DisputeDecision({ disputeId }: { disputeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  async function decide(outcome: "resolved_buyer" | "resolved_seller") {
    if (note.trim().length < 5) { setErr("Add a one-line resolution note."); return; }
    setBusy(outcome); setErr("");
    const result = await resolveDispute(disputeId, outcome, note.trim());
    setBusy("");
    if (!result.ok) { setErr(result.error ?? "Could not save."); return; }
    router.refresh();
  }

  return (
    <div className="w-full max-w-xs shrink-0">
      <input
        className="nm-input !py-1.5 !text-[11.5px]"
        placeholder="Resolution note (both sides see it)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="mt-1.5 flex gap-1.5">
        <button onClick={() => decide("resolved_buyer")} disabled={!!busy} className="flex-1 rounded-lg bg-ink-900 px-2 py-1.5 text-[11px] font-semibold text-white">
          {busy === "resolved_buyer" ? "…" : "Refund buyer"}
        </button>
        <button onClick={() => decide("resolved_seller")} disabled={!!busy} className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-[11px] font-semibold text-white">
          {busy === "resolved_seller" ? "…" : "Release to seller"}
        </button>
      </div>
      {err && <p className="mt-1 text-[10.5px] font-medium text-red-600">{err}</p>}
    </div>
  );
}
