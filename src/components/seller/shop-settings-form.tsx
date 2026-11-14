"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, uploadToBucket } from "@/lib/supabase/client";
import { Card, Spinner, Alert, Badge } from "@/components/ui";
import { PickupLocationFields } from "@/components/seller/pickup-location-fields";
import { naira } from "@/lib/utils";

export function ShopSettingsForm({ shop }: { shop: any }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: shop.name,
    description: shop.description ?? "",
    category: shop.category ?? "",
    kind: shop.kind,
    logo_url: shop.logo_url ?? "",
    banner_url: shop.banner_url ?? "",
    delivery_fee: String(shop.delivery_fee ?? 500),
    free_delivery_threshold: shop.free_delivery_threshold != null ? String(shop.free_delivery_threshold) : "",
    pickup_available: !!shop.pickup_available,
    shop_address: shop.shop_address ?? "",
    shop_lat: (shop.shop_lat ?? null) as number | null,
    shop_lng: (shop.shop_lng ?? null) as number | null,
    bank_name: shop.bank_name ?? "SmartCash",
    bank_account_number: shop.bank_account_number ?? "",
    bank_account_name: shop.bank_account_name ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState("");
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");

  async function upload(kind: "logo" | "banner", file: File) {
    setUploading(kind);
    try {
      const url = await uploadToBucket(file, `shops/${shop.id}`);
      setForm((f) => ({ ...f, [`${kind}_url`]: url }));
    } catch (e: any) { setErr(e.message); }
    setUploading("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setOk(false);
    const supabase = createClient();
    const { error } = await supabase.from("shops").update({
      name: form.name.trim(),
      description: form.description || null,
      category: form.category || null,
      kind: form.kind,
      logo_url: form.logo_url || null,
      banner_url: form.banner_url || null,
      delivery_fee: Number(form.delivery_fee) || 0,
      free_delivery_threshold: form.free_delivery_threshold ? Number(form.free_delivery_threshold) : null,
      pickup_available: form.pickup_available,
      shop_address: form.shop_address.trim() || null,
      shop_lat: form.shop_lat,
      shop_lng: form.shop_lng,
      bank_name: form.bank_name,
      bank_account_number: form.bank_account_number,
      bank_account_name: form.bank_account_name,
    }).eq("id", shop.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <Card className="p-4 space-y-3">
        <p className="text-[13.5px] font-bold text-ink-900">Shop profile</p>
        <div>
          <label className="nm-label">Shop name</label>
          <input className="nm-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="nm-label">Description</label>
          <textarea rows={3} className="nm-input resize-none" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="nm-label">Logo</label>
            <div className="flex items-center gap-2">
              <div className="h-11 w-11 overflow-hidden rounded-xl bg-slate-100">
                {form.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logo_url} alt="" className="h-full w-full object-cover" />
                ) : <div className="grid h-full place-items-center text-sm text-ink-400">🏪</div>}
              </div>
              <label className="nm-btn-ghost cursor-pointer !px-2.5 !py-1.5 !text-[11.5px]">
                {uploading === "logo" ? <Spinner className="!h-3 !w-3" /> : "Change"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload("logo", e.target.files[0])} />
              </label>
            </div>
          </div>
          <div>
            <label className="nm-label">Banner</label>
            <div className="flex items-center gap-2">
              <div className="h-11 w-16 overflow-hidden rounded-lg bg-slate-100">
                {form.banner_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.banner_url} alt="" className="h-full w-full object-cover" />
                ) : <div className="grid h-full place-items-center text-sm text-ink-400">▭</div>}
              </div>
              <label className="nm-btn-ghost cursor-pointer !px-2.5 !py-1.5 !text-[11.5px]">
                {uploading === "banner" ? <Spinner className="!h-3 !w-3" /> : "Change"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload("banner", e.target.files[0])} />
              </label>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="nm-label">Category</label>
            <input className="nm-input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
          </div>
          <div>
            <label className="nm-label">I sell</label>
            <select className="nm-input" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
              <option value="goods">Goods only</option>
              <option value="services">Services only</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-slate-50 px-3 py-2">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-ink-900">Location</p>
            <Badge tone="gray">🔒 Locked</Badge>
          </div>
          <p className="mt-0.5 text-[12px] text-ink-600">{shop.city}, {shop.state}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
            Changing your city needs a NaijaMart review because it changes who can order from you. Message support to request a change.
          </p>
        </div>
      </Card>

      <Card className="p-4 space-y-2.5">
        <p className="text-[13.5px] font-bold text-ink-900">Delivery</p>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="nm-label">Flat fee per order (₦)</label>
            <input className="nm-input" inputMode="numeric" value={form.delivery_fee}
              onChange={(e) => setForm((f) => ({ ...f, delivery_fee: e.target.value.replace(/\D/g, "") }))} />
          </div>
          <div>
            <label className="nm-label">Free delivery above (₦)</label>
            <input className="nm-input" inputMode="numeric" value={form.free_delivery_threshold}
              onChange={(e) => setForm((f) => ({ ...f, free_delivery_threshold: e.target.value.replace(/\D/g, "") }))} placeholder="20000" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-700">
          <input type="checkbox" checked={form.pickup_available} className="h-4 w-4 rounded text-brand-500"
            onChange={(e) => setForm((f) => ({ ...f, pickup_available: e.target.checked }))} />
          Buyers can pick up from my shop
        </label>
        <p className="text-[11px] text-ink-400">
          A buyer paying {naira(Number(form.free_delivery_threshold) || 0)} or more ships free.
        </p>

        {/* Pickup point.
            Only shown when pickup is switched on: an address and a pin for a
            shop nobody can collect from would be a field that changes
            nothing. The fee above still applies to delivery only — pickup is
            always free, which is the point of offering it. */}
        {form.pickup_available && (
          <div className="border-t border-[var(--line)] pt-3">
            <p className="mb-2 text-[12.5px] font-bold text-ink-900">Pickup point</p>
            <PickupLocationFields
              lat={form.shop_lat}
              lng={form.shop_lng}
              address={form.shop_address}
              onChange={(next) =>
                setForm((f) => ({
                  ...f,
                  shop_lat: next.lat,
                  shop_lng: next.lng,
                  shop_address: next.address,
                }))
              }
            />
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-2.5">
        <p className="text-[13.5px] font-bold text-ink-900">Bank account (for payouts)</p>
        <div>
          <label className="nm-label">Account name</label>
          <input className="nm-input" value={form.bank_account_name} onChange={(e) => setForm((f) => ({ ...f, bank_account_name: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="nm-label">Account number</label>
            <input className="nm-input" inputMode="numeric" value={form.bank_account_number}
              onChange={(e) => setForm((f) => ({ ...f, bank_account_number: e.target.value.replace(/\D/g, "") }))} />
          </div>
          <div>
            <label className="nm-label">Bank</label>
            <select className="nm-input" value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}>
              {["SmartCash", "GTBank", "Access Bank", "Zenith Bank", "First Bank", "UBA", "Kuda", "Opay", "Moniepoint", "Sterling", "Fidelity"].map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {err && <Alert tone="red">{err}</Alert>}
      {ok && !err && <Alert tone="green">Settings saved.</Alert>}

      <button type="submit" disabled={busy} className="nm-btn-primary w-full !py-3">
        {busy ? <><Spinner /> Saving…</> : "Save changes"}
      </button>
    </form>
  );
}
