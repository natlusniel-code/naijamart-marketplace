"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, uploadToBucket } from "@/lib/supabase/client";
import { Spinner, Alert } from "@/components/ui";

export function SubscriptionReceipt({ shopId, price }: { shopId: string; price: number }) {
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
      const url = await uploadToBucket(file, `subscriptions/${shopId}`);
      const { error } = await supabase.from("payments").insert({
        shop_id: shopId,
        type: "subscription",
        amount: price,
        reference: `SUB-${shopId.slice(0, 6).toUpperCase()}`,
        receipt_url: url,
      });
      if (error) throw new Error(error.message);
      await supabase.from("shops").update({ subscription_status: "pending" }).eq("id", shopId);
      setOk(true);
      setBusy(false);
      router.refresh();
    } catch (e: any) { setBusy(false); setErr(e.message); }
  }

  if (ok) return <Alert tone="green" title="Receipt submitted">We&apos;ll verify it and turn your listings back on.</Alert>;

  return (
    <div>
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[var(--line)] px-3 py-2.5 text-[12.5px] text-ink-500 hover:border-brand-400 hover:bg-brand-50/40">
        <span className="text-brand-600">📎</span>
        {file ? file.name : "Upload renewal receipt"}
        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {err && <p className="mt-1.5 text-[12px] font-medium text-red-600">{err}</p>}
      <button onClick={send} disabled={busy || !file} className="nm-btn-primary mt-2 w-full !py-2.5">
        {busy ? <><Spinner /> Submitting…</> : "Submit renewal"}
      </button>
    </div>
  );
}
