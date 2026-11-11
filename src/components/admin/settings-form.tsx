"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSettings } from "@/app/admin-fuckliving/actions";
import { Spinner, Alert } from "@/components/ui";

export function SettingsForm({ settings }: { settings: any }) {
  const router = useRouter();
  const [form, setForm] = useState({
    commission_pct: String((Number(settings?.commission_rate ?? 0.05) * 100).toFixed(1)),
    subscription_price: String(settings?.subscription_price ?? 5000),
    default_delivery_fee: String(settings?.default_delivery_fee ?? 500),
    free_delivery_default: String(settings?.free_delivery_default ?? 20000),
    terms_text: settings?.terms_text ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setOk(false);
    const result = await saveSettings({
      commission_rate: Number(form.commission_pct) / 100,
      subscription_price: Number(form.subscription_price),
      default_delivery_fee: Number(form.default_delivery_fee),
      free_delivery_default: Number(form.free_delivery_default),
      terms_text: form.terms_text,
    });
    setBusy(false);
    if (!result.ok) { setErr(result.error ?? "Could not save."); return; }
    setOk(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="nm-label">Commission (%)</label>
          <input className="nm-input" inputMode="decimal" value={form.commission_pct}
            onChange={(e) => setForm((f) => ({ ...f, commission_pct: e.target.value }))} />
        </div>
        <div>
          <label className="nm-label">Subscription (₦ / month)</label>
          <input className="nm-input" inputMode="numeric" value={form.subscription_price}
            onChange={(e) => setForm((f) => ({ ...f, subscription_price: e.target.value.replace(/\D/g, "") }))} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="nm-label">Default delivery fee (₦)</label>
          <input className="nm-input" inputMode="numeric" value={form.default_delivery_fee}
            onChange={(e) => setForm((f) => ({ ...f, default_delivery_fee: e.target.value.replace(/\D/g, "") }))} />
        </div>
        <div>
          <label className="nm-label">Default free above (₦)</label>
          <input className="nm-input" inputMode="numeric" value={form.free_delivery_default}
            onChange={(e) => setForm((f) => ({ ...f, free_delivery_default: e.target.value.replace(/\D/g, "") }))} />
        </div>
      </div>

      <p className="pt-1 text-[12.5px] font-bold text-ink-900">Escrow bank accounts</p>
      <p className="text-[11.5px] text-ink-500">
        Managed on the{" "}
        <a href="/admin-fuckliving/payment-accounts" className="font-semibold text-brand-600 underline">
          Payment accounts
        </a>{" "}
        page — add as many as you need and buyers are rotated across the active ones.
      </p>

      <p className="pt-1 text-[12.5px] font-bold text-ink-900">Terms & refund policy</p>
      <textarea rows={5} className="nm-input resize-y !text-[12px]" value={form.terms_text}
        onChange={(e) => setForm((f) => ({ ...f, terms_text: e.target.value }))} />

      {err && <Alert tone="red">{err}</Alert>}
      {ok && <Alert tone="green">Settings saved.</Alert>}

      <button type="submit" disabled={busy} className="nm-btn-primary w-full !py-2.5">
        {busy ? <><Spinner /> Saving…</> : "Save settings"}
      </button>
    </form>
  );
}
