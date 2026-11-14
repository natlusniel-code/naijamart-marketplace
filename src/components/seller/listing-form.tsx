"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, uploadToBucket } from "@/lib/supabase/client";
import { Spinner, Alert, Card, Badge } from "@/components/ui";
import { naira, discountPercent } from "@/lib/utils";
import { AiListingPanel } from "@/components/seller/ai-listing-panel";

/**
 * Read a file's real pixel dimensions.
 *
 * Used to enforce the horizontal-only rule for service photos. The browser
 * decodes the image, so this reports the true orientation regardless of the
 * file name or any EXIF rotation the browser has already applied. Resolves
 * to null if the file cannot be decoded — in that case the upload is allowed
 * through rather than blocked on a check we could not run.
 */
function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

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
  /**
   * Which kind of service this is (sql/0019). Required for a service and
   * meaningless for a product, so it is cleared when the seller switches
   * back to a product — the database rejects a product that carries one.
   */
  const [serviceMode, setServiceMode] = useState<"physical" | "online">(
    listing?.service_mode ?? "physical",
  );
  const [form, setForm] = useState({
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    category_id: listing?.category_id ?? categories[0]?.id ?? "",
    price: listing?.price ? String(listing.price) : "",
    original_price: listing?.original_price != null ? String(listing.original_price) : "",
    stock: listing?.stock != null ? String(listing.stock) : "0",
    delivery_fee_override: listing?.delivery_fee_override != null ? String(listing.delivery_fee_override) : "",
    free_delivery_threshold: listing?.free_delivery_threshold != null ? String(listing.free_delivery_threshold) : "",
    service_area: listing?.service_area ?? "",
    needs_home_visit: listing?.needs_home_visit ?? false,
    delivery_days: listing?.delivery_days != null ? String(listing.delivery_days) : "",
    fulfilment_mode: (listing?.fulfilment_mode ?? "both") as "both" | "pickup" | "delivery",
  });
  const [images, setImages] = useState<string[]>(listing?.images ?? []);
  const [tags, setTags] = useState<string[]>(listing?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function pickImage(file: File) {
    if (images.length >= 6) { setErr("Up to 6 photos per listing."); return; }
    setErr("");

    // A service photo must be HORIZONTAL (landscape).
    //
    // The gig card and the gig page show the service picture wide, so a
    // portrait or square upload would have to be cropped to fit — which is
    // exactly the quality loss the brief is about. Rather than silently
    // cropping, the upload is refused and the seller is told what to do.
    //
    // Any SIZE is fine; only the orientation matters. The check reads the
    // real pixel dimensions from the file itself, so renaming a portrait
    // photo cannot get past it.
    if (type === "service") {
      const dims = await readImageSize(file);
      if (dims && dims.width <= dims.height) {
        setErr(
          `Service photos must be horizontal (landscape). That one is ${dims.width}×${dims.height} — ` +
            `wider than it is tall is what we need. Any size is fine, just turn it sideways or pick another.`,
        );
        return;
      }
    }

    setUploading(true);
    try {
      const url = await uploadToBucket(file, `listings/${shopId}`);
      setImages((i) => [...i, url]);
    } catch (e: any) { setErr(e.message); }
    setUploading(false);
  }

  const MAX_TAGS = 20;

  /**
   * Commit whatever is in the draft box as a tag.
   *
   * Called on comma, on Enter, and on blur — so a seller who types "Sofa"
   * and then clicks away does not lose it. Normalisation (lowercase, trim,
   * collapse spaces) matches the database trigger in sql/0015, so the chip
   * the seller sees is the tag that gets stored and searched.
   */
  function commitTag(raw?: string) {
    const value = (raw ?? tagDraft).replace(/,/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    setTagDraft("");
    if (!value) return;
    setTags((current) => {
      if (current.includes(value)) return current;
      if (current.length >= MAX_TAGS) {
        setErr(`You can add up to ${MAX_TAGS} tags. Remove one to add another.`);
        return current;
      }
      return [...current, value];
    });
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "," || e.key === "Enter") {
      e.preventDefault();
      commitTag();
    } else if (e.key === "Backspace" && !tagDraft && tags.length > 0) {
      // Backspace on an empty box removes the last chip — the usual chip UX.
      setTags((t) => t.slice(0, -1));
    }
  }

  function validate() {
    if (form.title.trim().length < 3) return "Give the listing a title.";
    if (!form.price || Number(form.price) <= 0) return "Enter a price above zero.";
    if (type === "product" && Number(form.stock) < 0) return "Stock can't be negative.";
    // The database enforces this too, but catching it here means the seller
    // sees the problem next to the field instead of as a failed save.
    if (form.original_price && Number(form.original_price) < Number(form.price)) {
      return "The original price must be at least the price you are selling at.";
    }
    if (tags.length > MAX_TAGS) return `You can add up to ${MAX_TAGS} tags.`;
    return "";
  }

  async function save(status: "live" | "draft") {
    const v = validate();
    if (v) { setErr(v); return; }
    // A tag still sitting in the draft box when the seller hits Publish is
    // a tag they meant to add. Fold it in rather than dropping it.
    const pending = tagDraft.replace(/,/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const finalTags = pending && !tags.includes(pending) && tags.length < MAX_TAGS
      ? [...tags, pending]
      : tags;
    setBusy(status);
    setErr("");
    const supabase = createClient();

    const payload = {
      shop_id: shopId,
      type,
      title: form.title.trim(),
      description: form.description || null,
      category_id: form.category_id || null,
      tags: finalTags,
      price: Number(form.price),
      original_price: form.original_price ? Number(form.original_price) : null,
      stock: type === "product" ? Number(form.stock) : 0,
      images,
      // A service is performed, never shipped, so it carries no delivery
      // fee. The database clears these too (sql/0019) — this keeps the
      // saved row honest rather than relying on the trigger alone.
      delivery_fee_override: type === "product" && form.delivery_fee_override ? Number(form.delivery_fee_override) : null,
      free_delivery_threshold: type === "product" && form.free_delivery_threshold ? Number(form.free_delivery_threshold) : null,
      service_area: type === "service" && serviceMode === "physical" ? form.service_area || null : null,
      needs_home_visit: type === "service" && serviceMode === "physical" ? form.needs_home_visit : false,
      service_mode: type === "service" ? serviceMode : null,
      delivery_days: type === "service" && form.delivery_days ? Number(form.delivery_days) : null,
      // A service is performed, never shipped or collected, so the
      // pickup/delivery choice is meaningless for it and is stored as
      // 'both' (the column default) rather than a value that would imply
      // a courier. A product keeps whatever the seller chose.
      fulfilment_mode: type === "product" ? form.fulfilment_mode : "both",
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

      {/* ---------------------------------------------------------------
          Product Listing Assistant.

          Sits above the form because it FILLS the form: the seller uploads a
          photo, gets copy back, and presses "Use this in my listing" to drop
          the title, description and tags into the fields below. It never
          navigates away, so a half-typed price or stock count survives.

          Rendered for products only. A service is priced and described
          differently (plans, service area, home visit), and the assistant's
          product-shaped output would fight the form rather than help it.
         --------------------------------------------------------------- */}
      {type === "product" && (
        <AiListingPanel
          shopId={shopId}
          listingId={listing?.id}
          onApply={({ title, description, tags: aiTags }) => {
            setForm((f) => ({ ...f, title, description }));
            // Merge rather than replace: a seller may have typed tags before
            // generating, and silently dropping them would be a surprise.
            setTags((current) => {
              const merged = [...current];
              for (const t of aiTags) {
                if (merged.length >= MAX_TAGS) break;
                if (!merged.includes(t)) merged.push(t);
              }
              return merged;
            });
            setErr("");
          }}
        />
      )}

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

          {/* ---------------------------------------------------------------
              Discount. The seller enters the price they USED to charge; the
              percentage is computed, never typed, so the badge on the
              storefront can never disagree with the two numbers.
             --------------------------------------------------------------- */}
          <div className="rounded-xl border border-[var(--line)] bg-slate-50/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="nm-label !mb-0">Original price (₦)</label>
              <span className="text-[11px] text-ink-400">Optional</span>
            </div>
            <input
              className="nm-input mt-1.5"
              inputMode="numeric"
              value={form.original_price}
              onChange={(e) => setForm((f) => ({ ...f, original_price: e.target.value.replace(/\D/g, "") }))}
              placeholder="e.g. 12000 — leave empty for no discount"
            />

            {(() => {
              const pct = discountPercent(Number(form.price || 0), form.original_price ? Number(form.original_price) : null);
              const invalid = !!form.original_price && Number(form.original_price) < Number(form.price || 0);
              if (invalid) {
                return (
                  <p className="mt-1.5 text-[11.5px] font-medium text-red-600">
                    The original price must be at least ₦{Number(form.price || 0).toLocaleString("en-NG")}.
                  </p>
                );
              }
              if (pct > 0) {
                return (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[11.5px] font-bold text-white">
                      {Number.isInteger(pct) ? pct : pct.toFixed(1)}% off
                    </span>
                    <span className="text-[11.5px] text-ink-500">
                      Buyers see <s>{naira(Number(form.original_price))}</s>{" "}
                      <strong className="text-ink-900">{naira(Number(form.price))}</strong> — saving{" "}
                      {naira(Number(form.original_price) - Number(form.price))}
                    </span>
                  </div>
                );
              }
              return (
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
                  Add what the item normally sells for and we work out the percentage for you. Leave it empty and no
                  discount badge is shown.
                </p>
              );
            })()}
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
              {/* Which kind of service. This decides whether a location
                  filter can ever hide the gig, so it is asked plainly
                  rather than buried in a settings field. */}
              <div>
                <label className="nm-label">Type of service</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setServiceMode("physical")}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      serviceMode === "physical"
                        ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500"
                        : "border-[var(--line)] bg-white hover:border-brand-300"
                    }`}
                  >
                    <span className="block text-[12.5px] font-bold text-ink-900">🏠 Home visit</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">
                      Plumbing, bricklaying, repairs — you travel to the customer
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setServiceMode("online")}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      serviceMode === "online"
                        ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500"
                        : "border-[var(--line)] bg-white hover:border-brand-300"
                    }`}
                  >
                    <span className="block text-[12.5px] font-bold text-ink-900">🌐 Online</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">
                      Design, web, writing — delivered over the internet
                    </span>
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
                  {serviceMode === "online"
                    ? "Online gigs are shown to buyers in every city — there is no location limit."
                    : "Home-visit gigs are shown to buyers in your city, and bookings follow the usual local rule."}
                </p>
              </div>

              {serviceMode === "physical" && (
                <>
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
                </>
              )}

              <div>
                <label className="nm-label">Delivery time (days)</label>
                <input className="nm-input" inputMode="numeric" value={form.delivery_days}
                  onChange={(e) => setForm((f) => ({ ...f, delivery_days: e.target.value.replace(/\D/g, "") }))}
                  placeholder="e.g. 3" />
                <p className="mt-1 text-[11px] text-ink-400">How long the job takes. Shown on your gig card.</p>
              </div>

              <div className="rounded-xl bg-brand-50/70 px-3 py-2 text-[11.5px] leading-relaxed text-brand-900">
                Services carry <strong>no delivery fee</strong> — a gig is performed, not shipped.
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------------
              Tags. These are what search actually matches on, so a listing
              titled "LG 7kg Front Load Washer" is findable by "washing
              machine". Comma (or Enter) commits a chip; max 20, enforced
              here and again by the database.
             --------------------------------------------------------------- */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="nm-label !mb-0">Search tags</label>
              <span className="text-[11px] text-ink-400">{tags.length}/{MAX_TAGS}</span>
            </div>

            {tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11.5px] font-semibold text-brand-800"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags((list) => list.filter((x) => x !== t))}
                      aria-label={`Remove tag ${t}`}
                      className="grid h-3.5 w-3.5 place-items-center rounded-full bg-brand-200/70 text-[9px] leading-none text-brand-900 hover:bg-brand-300"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <input
              className="nm-input mt-1.5"
              value={tagDraft}
              disabled={tags.length >= MAX_TAGS}
              onChange={(e) => {
                const v = e.target.value;
                // Typing a comma commits immediately, so "Sofa," becomes a
                // chip without the seller reaching for Enter.
                if (v.includes(",")) {
                  v.split(",").forEach((part, i, arr) => {
                    if (i < arr.length - 1) commitTag(part);
                    else setTagDraft(part);
                  });
                } else {
                  setTagDraft(v);
                }
              }}
              onKeyDown={onTagKeyDown}
              onBlur={() => commitTag()}
              placeholder={
                tags.length >= MAX_TAGS
                  ? `Maximum ${MAX_TAGS} tags reached`
                  : "e.g. washing machine, home appliance — press comma to add"
              }
            />
            <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
              Buyers find you by these words. Add what someone would type to look for this —
              brand, type, colour, size. Up to {MAX_TAGS}.
            </p>
          </div>

          {/* images */}
          <div>
            <label className="nm-label">
              {type === "service" ? `Service photos (${images.length}/6)` : `Photos (${images.length}/6)`}
            </label>
            <div className="flex flex-wrap gap-2">
              {images.map((src, i) => (
                <div
                  key={src}
                  className={`relative overflow-hidden rounded-xl bg-slate-100 ${
                    type === "service" ? "h-16 w-28" : "h-16 w-16"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button onClick={() => setImages((l) => l.filter((_, k) => k !== i))}
                    className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/60 text-[10px] text-white">×</button>
                </div>
              ))}
              {images.length < 6 && (
                <label
                  className={`grid cursor-pointer place-items-center rounded-xl border border-dashed border-[var(--line)] text-ink-400 hover:border-brand-400 hover:bg-brand-50/40 ${
                    type === "service" ? "h-16 w-28" : "h-16 w-16"
                  }`}
                >
                  {uploading ? <Spinner /> : "+"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])} />
                </label>
              )}
            </div>
            {type === "service" && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
                Service photos must be <strong className="text-ink-600">horizontal (landscape)</strong> — wider
                than they are tall. Any size is fine; we show it at its own proportions so it never loses quality.
              </p>
            )}
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

          {/* ---------------------------------------------------------------
              How this listing is fulfilled.

              A product can be shipped, collected, or both. A seller whose
              shop is a lock-up with no courier sets "pickup only" and no
              buyer is ever offered a delivery they cannot have; a seller who
              only ships sets "delivery only" and no buyer turns up at a gate
              that is not a shop.

              Pickup carries NO delivery fee. The fee fields above still
              apply — they are what a delivery costs — but a pickup order
              never pays them, which is why the note below says so plainly.

              Hidden for a service: a gig is performed, not shipped or
              collected, so the choice cannot change anything.
             --------------------------------------------------------------- */}
          {type === "product" && (
            <div className="rounded-xl border border-[var(--line)] bg-slate-50/60 p-3">
              <label className="nm-label" htmlFor="fulfilment-mode">
                How can buyers get this?
              </label>
              <select
                id="fulfilment-mode"
                className="nm-input mt-1.5"
                value={form.fulfilment_mode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    fulfilment_mode: e.target.value as "both" | "pickup" | "delivery",
                  }))
                }
              >
                <option value="both">Pickup and delivery</option>
                <option value="pickup">Pickup only</option>
                <option value="delivery">Delivery only</option>
              </select>

              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
                {form.fulfilment_mode === "pickup"
                  ? "Buyers collect from your shop — no delivery fee is charged. Set your pickup address and pin in Shop settings."
                  : form.fulfilment_mode === "delivery"
                    ? "Buyers pay the delivery fee above. Pickup is not offered on this listing."
                    : "Buyers choose at checkout. Pickup is free; delivery pays the fee above."}
              </p>

              {form.fulfilment_mode !== "delivery" && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                  Turn on pickup in{" "}
                  <a href="/seller/settings" className="font-semibold text-brand-700 underline">
                    Shop settings
                  </a>{" "}
                  so buyers can see where to collect from.
                </p>
              )}
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
