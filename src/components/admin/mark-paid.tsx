"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui";

export function MarkPaid({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function mark() {
    setBusy(true);
    const supabase = createClient();
    // Goes through the RPC so the payout row and its orders.payout_status stay in sync.
    const { error } = await supabase.rpc("admin_mark_payout_paid", {
      p_payout_id: payoutId,
      p_reference: ref.trim() || null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
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
