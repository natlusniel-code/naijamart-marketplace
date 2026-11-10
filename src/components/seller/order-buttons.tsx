"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner, Alert, Badge } from "@/components/ui";

export function AcceptDecline({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");

  async function accept() {
    setBusy("accept"); setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("seller_accept_order", { p_order_id: orderId });
    setBusy("");
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  async function decline() {
    if (reason.trim().length < 5) { setErr("Tell the buyer why you can't fulfil it."); return; }
    setBusy("decline"); setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("seller_decline_order", { p_order_id: orderId, p_reason: reason.trim() });
    setBusy("");
    if (error) { setErr(error.message); return; }
    setDeclining(false);
    router.refresh();
  }

  if (declining) {
    return (
      <div className="rounded-xl border border-red-500/25 bg-red-50 p-2.5">
        <p className="text-[11.5px] font-bold text-red-900">Decline this order?</p>
        <p className="mt-0.5 text-[11px] text-red-900/70">The buyer is refunded and the item goes back in stock.</p>
        <input className="nm-input mt-1.5 !py-1.5 !text-[12px]" placeholder="Reason (shown to buyer)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <p className="mt-1 text-[11px] font-medium text-red-700">{err}</p>}
        <div className="mt-1.5 flex gap-1.5">
          <button onClick={decline} disabled={busy === "decline"} className="nm-btn flex-1 !py-1.5 !text-[11.5px] !bg-red-600 !text-white">
            {busy === "decline" ? <Spinner className="!h-3 !w-3" /> : "Decline"}
          </button>
          <button onClick={() => setDeclining(false)} className="nm-btn-ghost !py-1.5 !text-[11.5px]">Keep</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <button onClick={accept} disabled={!!busy} className="nm-btn-primary flex-1 !py-2 !text-[12.5px]">
          {busy === "accept" ? <Spinner className="!h-3.5 !w-3.5" /> : "Accept order"}
        </button>
        <button onClick={() => setDeclining(true)} className="nm-btn-ghost flex-1 !py-2 !text-[12.5px]">Decline</button>
      </div>
      {err && <p className="mt-1 text-[11px] font-medium text-red-600">{err}</p>}
    </div>
  );
}

export function AdvanceOrder({
  orderId,
  status,
  fulfilment,
}: {
  orderId: string;
  status: string;
  fulfilment: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const next =
    ["paid", "accepted"].includes(status)
      ? { to: "processing", label: "Start preparing" }
      : status === "processing"
        ? fulfilment === "pickup"
          ? { to: "ready_for_pickup", label: "Mark ready for pickup" }
          : { to: "shipped", label: "Mark as shipped" }
        : null;

  async function go() {
    if (!next) return;
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("seller_advance_order", { p_order_id: orderId, p_next: next.to });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  if (!next) return null;

  return (
    <div>
      <button onClick={go} disabled={busy} className="nm-btn-primary w-full !py-2 !text-[12.5px]">
        {busy ? <Spinner className="!h-3.5 !w-3.5" /> : next.label}
      </button>
      {err && <p className="mt-1 text-[11px] font-medium text-red-600">{err}</p>}
    </div>
  );
}
