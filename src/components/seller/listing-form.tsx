"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, uploadToBucket } from "@/lib/supabase/client";
import { Spinner, Alert, Card, Badge } from "@/components/ui";
import { naira } from "@/lib/utils";

export function ListingForm({
  shopId,
  categories,
  listing,
  shopDefaults,
}: {
  shopId: string;
  categories: { id: string; name: string }[];
  listing?: any;
  shopDefaults: { delivery_fee: number; free_delivery_threshold: number | null };
}) {
  const router = useRouter();
  const editing = !!listing;

  const [type, setType] = useState<"product" | "service">(listing?.type ?? "product");
  const [form, setForm] = useState({
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    category_id: listing?.category_id ?? categories[0]?.id ?? "",
    price: listing?.price ? String(listing.price) : "",
    stock: listing?.stock != null ? String(listing.stock) : "0",
    delivery_fee_override: listing?.delivery_fee_override != null ? String(listing.delivery_fee_override) : "",
    free_delivery_threshold: listing?.free_delivery_threshold != null ? String(listing.free_delivery_threshold) : "",
    service_area: listing?.service_area ?? "",
    needs_home_visit: listing?.needs_home_visit ?? false,
  });
  const [images, setImages] = useState<string[]>(listing?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function pickImage(file: File) {
    if (images.length >= 6) { setErr("Up to 6 photos per listing."); return; }
    setUploading(true);
    setErr("");
    try {
      const url = await uploadToBucket(file, `listings/${shopId}`);
      setImages((i) => [...i, url]);
    } catch (e: any) { setErr(e.message); }
    setUploading(false);
  }

  function validate() {
    if (form.title.trim().length < 3) return "Give the listing a title.";
    if (!form.price || Number(form.price) <= 0) return "Enter a price above zero.";
    if (type === "product" && Number(form.stock) < 0) return "Stock can't be negative.";
    return "";
  }

  async function save(status: "live" | "draft") {
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(status);
    setErr("");
    const supabase = createClient();

    const payload = {
      shop_id: shopId,
      type,
      title: form.title.trim(),
      description: form.description || null,
      category_id: form.category_id || null,
      price: Number(form.price),
      stock: type === "product" ? Number(form.stock) : 0,
      images,
      delivery_fee_override: form.delivery_fee_override ? Number(form.delivery_fee_override) : null,
      free_delivery_threshold: form.free_delivery_threshold ? Number(form.free_delivery_threshold) : null,
      service_area: type === "service" ? form.service_area || null : null,
      needs_home_visit: type === "service" ? form.needs_home_visit : false,
      status,
    };

    const { error } = editing
      ? await supabase.from("listings").update(payload).eq("id", listing.id)
      : await supabase.from("listings").insert(payload);

    setBusy("");
    if (error) { setErr(error.message); return; }
    router.push("/seller/listings");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-[21px] font-extrabold tracking-tight text-ink-900">
          {editing ? "Edit listing" : "Add listing"}
        </h1>
        {editing && <Badge tone="gray">{listing.status}</Badge>}
      </div>

      <Card className="p-4">
        {/* type toggle */}
        <div className="flex gap-2">
          {(["product", "service"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`nm-chip !py-2 ${type === t ? "nm-chip-active" : ""}`}
            >
              {t === "product" ? "📦 Product" : "🛠️ Service"}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-3">
          <div>
            <label className="nm-label">Title</label>
            <input className="nm-input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={type === "product" ? "Wireless Earbuds Pro" : "Plumber — home service"} />
          </div>
          <div>
            <label className="nm-label">Description</label>
            <textarea rows={4} className="nm-input resize-none" value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What you're selling, condition, what's included…" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="nm-label">Category</label>
              <select className="nm-input" value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="nm-label">{type === "service" ? "Starting price (₦)" : "Price (₦)"}</label>
              <input className="nm-input" inputMode="numeric" value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value.replace(/\D/g, "") }))} placeholder="8000" />
            </div>
          </div>

          {type === "product" ? (
            <div>
              <label className="nm-label">Stock</label>
              <input className="nm-input" inputMode="numeric" value={form.stock}
                onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value.replace(/\D/g, "") }))} />
              <p className="mt-1 text-[11px] text-ink-400">At 5 or fewer we show a low-stock warning on your dashboard.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div>
                <label className="nm-label">Service area</label>
                <input className="nm-input" value={form.service_area}
                  onChange={(e) => setForm((f) => ({ ...f, service_area: e.target.value }))} placeholder="Abeokuta South and nearby LGAs" />
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-ink-700">
                <input type="checkbox" checked={form.needs_home_visit} className="h-4 w-4 rounded text-brand-500"
                  onChange={(e) => setForm((f) => ({ ...f, needs_home_visit: e.target.checked }))} />
                I come to the customer (&quot;home visit&quot;)
              </label>
            </div>
          )}

          {/* images */}
          <div>
            <label className="nm-label">Photos ({images.length}/6)</label>
            <div className="flex flex-wrap gap-2">
              {images.map((src, i) => (
                <div key={src} className="relative h-16 w-16 overflow-hidden rounded-xl bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button onClick={() => setImages((l) => l.filter((_, k) => k !== i))}
                    className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/60 text-[10px] text-white">×</button>
                </div>
              ))}
              {images.length < 6 && (
                <label className="grid h-16 w-16 cursor-pointer place-items-center rounded-xl border border-dashed border-[var(--line)] text-ink-400 hover:border-brand-400 hover:bg-brand-50/40">
                  {uploading ? <Spinner /> : "+"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])} />
                </label>
              )}
            </div>
          </div>

          {type === "product" && (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="nm-label">Delivery fee (₦)</label>
                <input className="nm-input" inputMode="numeric" value={form.delivery_fee_override}
                  onChange={(e) => setForm((f) => ({ ...f, delivery_fee_override: e.target.value.replace(/\D/g, "") }))}
                  placeholder={`Shop default: ${shopDefaults.delivery_fee}`} />
              </div>
              <div>
                <label className="nm-label">Free above (₦)</label>
                <input className="nm-input" inputMode="numeric" value={form.free_delivery_threshold}
                  onChange={(e) => setForm((f) => ({ ...f, free_delivery_threshold: e.target.value.replace(/\D/g, "") }))}
                  placeholder={shopDefaults.free_delivery_threshold ? `Shop: ${shopDefaults.free_delivery_threshold}` : "e.g. 20000"} />
              </div>
            </div>
          )}

          <div className="rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] leading-relaxed text-ink-500">
            NaijaMart takes {". "}5% commission on each order. Buyers pay {form.price ? naira(Number(form.price)) : "your price"} plus any delivery — you receive{" "}
            {form.price ? naira(Math.round(Number(form.price) * 0.95)) : "95%"} of the item price after delivery is confirmed.
          </div>
        </div>

        {err && <div className="mt-3"><Alert tone="red">{err}</Alert></div>}

        <div className="mt-4 flex gap-2">
          <button onClick={() => save("draft")} disabled={!!busy} className="nm-btn-ghost flex-1 !py-3">
            {busy === "draft" ? <Spinner /> : "Save as draft"}
          </button>
          <button onClick={() => save("live")} disabled={!!busy} className="nm-btn-primary flex-1 !py-3">
            {busy === "live" ? <><Spinner /> Publishing…</> : editing ? "Save & publish" : "Publish"}
          </button>
        </div>
      </Card>
    </div>
  );
}
