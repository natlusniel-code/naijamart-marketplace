"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { markPayoutPaid } from "@/app/admin-fuckliving/actions";
import { Spinner } from "@/components/ui";

export function MarkPaid({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function mark() {
    setBusy(true);
    setErr(null);
    // Server Action — the service-role key never reaches this component.
    const result = await markPayoutPaid(payoutId, ref.trim() || undefined);
    setBusy(false);
    if (!result.ok) {
      setErr(result.error ?? "Could not save.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="nm-btn-primary !px-3 !py-1.5 !text-[11.5px]">
        Mark as paid
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        className="nm-input !w-32 !py-1.5 !text-[11.5px]"
        placeholder="Transfer ref"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
      />
      <button onClick={mark} disabled={busy} className="nm-btn-primary !px-2.5 !py-1.5 !text-[11.5px]">
        {busy ? <Spinner className="!h-3 !w-3" /> : "Confirm"}
      </button>
      <button onClick={() => setOpen(false)} className="text-[11.5px] font-semibold text-ink-500">×</button>
      {err && <span className="text-[11px] text-red-600">{err}</span>}
    </div>
  );
}
