"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { naira } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";

export function RequestPayout({ shopId, amount }: { shopId: string; amount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function request() {
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("request_payout", { p_shop_id: shopId });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk(`Requested ${naira(Number(data))}. We'll process it within 4 days.`);
    router.refresh();
  }

  if (ok) return <Alert tone="green">{ok}</Alert>;

  return (
    <div>
      <button onClick={request} disabled={busy || amount <= 0} className="nm-btn-primary w-full !py-2.5">
        {busy ? <><Spinner /> Requesting…</> : amount > 0 ? `Request payout · ${naira(amount)}` : "Nothing available yet"}
      </button>
      {amount <= 0 && (
        <p className="mt-1.5 text-center text-[11.5px] text-brand-900/60">
          Your balance unlocks 4 days after a buyer confirms delivery.
        </p>
      )}
      {err && <p className="mt-1.5 text-[12px] font-medium text-red-600">{err}</p>}
    </div>
  );
}
