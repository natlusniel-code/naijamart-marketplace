"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, uploadToBucket } from "@/lib/supabase/client";
import { NIGERIA_STATES, lgasFor, slugify, cn } from "@/lib/utils";
import { supportWhatsAppUrl } from "@/lib/support";
import { Spinner, Alert, Card, Badge } from "@/components/ui";

type Props = {
  step: 1 | 2 | 3 | 4;
  shop?: any;
  signedIn: boolean;
  categories: { name: string }[];
  subscriptionPrice: number;
  bank: { bank_name: string; bank_account_number: string; bank_account_name: string };
  initial?: Partial<{ name: string; city: string; state: string }>;
};

const STEP_LABELS = ["Business profile", "Verification", "Plan", "Review"];

export function OnboardingFlow({ step, shop, signedIn, categories, subscriptionPrice, bank }: Props) {
  const router = useRouter();

  const [form, setForm] = useState({
    name: shop?.name ?? "",
    description: shop?.description ?? "",
    category: shop?.category ?? "Electronics vendors",
    kind: shop?.kind ?? "both",
    state: shop?.state ?? "Ogun",
    city: shop?.city ?? "Abeokuta South",
    logo_url: shop?.logo_url ?? "",
  });
  const [verif, setVerif] = useState({
    nin_or_cac: shop?.nin_or_cac ?? "",
    bank_account_name: shop?.bank_account_name ?? "",
    bank_account_number: shop?.bank_account_number ?? "",
    bank_name: shop?.bank_name ?? "SmartCash",
    documents: (shop?.documents ?? []) as string[],
  });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState("");

  const lg = lgasFor(form.state);

  if (!signedIn) {
    return (
      <Card className="mx-auto max-w-md p-6 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-2xl">🏪</div>
        <h1 className="mt-3 text-[19px] font-extrabold text-ink-900">Open your shop on NaijaMart</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
          List goods or offer services to buyers in your state. Free to start — the first ₦{subscriptionPrice.toLocaleString()} comes out of your first payout.
        </p>
        <Link href="/signup?role=seller" className="nm-btn-primary mt-4 w-full">Create a seller account</Link>
        <Link href="/signin?next=%2Fseller%2Fonboarding" className="nm-btn-ghost mt-2 w-full">I already have an account</Link>
      </Card>
    );
  }

  async function uploadLogo(file: File) {
    setUploading("logo");
    try {
      const url = await uploadToBucket(file, "shops");
      setForm((f) => ({ ...f, logo_url: url }));
    } catch (e: any) { setErr(e.message); }
    setUploading("");
  }

  async function uploadDoc(file: File) {
    setUploading("doc");
    try {
      const url = await uploadToBucket(file, "documents");
      setVerif((v) => ({ ...v, documents: [...v.documents, url] }));
    } catch (e: any) { setErr(e.message); }
    setUploading("");
  }

  async function saveStep1() {
    if (form.name.trim().length < 2) { setErr("Give your shop a name."); return; }
    setBusy(true); setErr("");
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();

    if (shop) {
      const { error } = await supabase.from("shops").update({
        name: form.name.trim(), description: form.description, category: form.category,
        kind: form.kind, state: form.state, city: form.city, logo_url: form.logo_url || null,
      }).eq("id", shop.id);
      if (error) { setBusy(false); setErr(error.message); return; }
    } else {
      const { error } = await supabase.from("shops").insert({
        owner_id: u.user!.id,
        name: form.name.trim(),
        slug: `${slugify(form.name)}-${Math.random().toString(36).slice(2, 6)}`,
        description: form.description,
        category: form.category,
        kind: form.kind,
        state: form.state,
        city: form.city,
        logo_url: form.logo_url || null,
        status: "pending",
      });
      if (error) { setBusy(false); setErr(error.message); return; }
    }

    // ── One account, one role ───────────────────────────────────────────────
    // Opening a shop makes this account a seller. The database does this
    // itself — a trigger on `shops` promotes the owner in the same
    // transaction (sql/0014) — so this call is a belt-and-braces repeat for
    // the case where the trigger is not yet deployed. It is idempotent and
    // only ever moves buyer -> seller, so it can never demote anyone. Any
    // error is ignored: the shop row is what matters, and the trigger has
    // already done the work.
    await supabase.rpc("promote_shop_owner_to_seller", { p_user: u.user!.id });

    setBusy(false);
    router.push("/seller/onboarding?step=2");
    router.refresh();
  }

  async function saveStep2() {
    if (!verif.nin_or_cac.trim()) { setErr("Enter your NIN or CAC number."); return; }
    if (!verif.bank_account_name.trim()) { setErr("Enter the name on your bank account."); return; }
    if (!/^\d{10}$/.test(verif.bank_account_number.trim())) {
      setErr("Enter your 10-digit account number.");
      return;
    }
    // ── Documents are compulsory ────────────────────────────────────────────
    // Verification is the whole point of this step: an admin cannot approve a
    // seller they cannot identify. This used to be optional, so a shop could
    // reach the approval queue with no ID on file and the reviewer had nothing
    // to check. The database now refuses to approve such a shop
    // (sql/0016, `shops_require_documents`), and this is the matching check in
    // the form so the seller is told here rather than by a failed approval.
    if (verif.documents.length === 0) {
      setErr(
        "Upload at least one ID document — your NIN slip, national ID, driver's licence or voter's card.",
      );
      return;
    }
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.from("shops").update({
      nin_or_cac: verif.nin_or_cac.trim(),
      bank_account_name: verif.bank_account_name.trim(),
      bank_account_number: verif.bank_account_number.trim(),
      bank_name: verif.bank_name,
      documents: verif.documents,
    }).eq("id", shop.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.push("/seller/onboarding?step=3");
    router.refresh();
  }

  async function saveStep3() {
    if (!receipt) { setErr("Upload the transfer receipt so we can activate your shop."); return; }
    setBusy(true); setErr("");
    try {
      const supabase = createClient();
      const url = await uploadToBucket(receipt, `subscriptions/${shop.id}`);
      const { error } = await supabase.from("payments").insert({
        shop_id: shop.id,
        type: "subscription",
        amount: subscriptionPrice,
        reference: `SUB-${shop.id.slice(0, 6).toUpperCase()}`,
        receipt_url: url,
      });
      if (error) throw new Error(error.message);
      await supabase.from("shops").update({ subscription_status: "pending" }).eq("id", shop.id);
      setBusy(false);
      router.push("/seller/onboarding?step=4");
      router.refresh();
    } catch (e: any) {
      setBusy(false);
      setErr(e.message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* progress */}
      <ol className="mb-5 flex items-center gap-1.5">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const active = n === step;
          return (
            <li key={label} className="flex flex-1 items-center gap-1.5">
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                  done ? "bg-brand-500 text-white" : active ? "bg-brand-500 text-white ring-4 ring-brand-500/15" : "bg-slate-200 text-ink-500",
                )}
              >
                {done ? "✓" : n}
              </span>
              <span className={cn("hidden text-[11.5px] font-semibold sm:block", active || done ? "text-ink-900" : "text-ink-400")}>
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <Card className="p-4">
          <h1 className="text-[19px] font-extrabold tracking-tight text-ink-900">Business profile</h1>
          <p className="mt-1 text-[13px] text-ink-500">This is what buyers see. You can change it later.</p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="nm-label">Shop name</label>
              <input className="nm-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="TechHub Abeokuta" />
            </div>
            <div>
              <label className="nm-label">Shop description</label>
              <textarea rows={3} className="nm-input resize-none" value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Genuine phones, accessories and repairs. Same-day pickup in Kuto." />
            </div>
            <div>
              <label className="nm-label">Logo</label>
              <div className="flex items-center gap-3">
                <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-xl border border-dashed border-[var(--line)] bg-slate-50">
                  {form.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.logo_url} alt="" className="h-full w-full object-cover" />
                  ) : uploading === "logo" ? <Spinner /> : <span className="text-xl text-ink-400">🏪</span>}
                </div>
                <label className="nm-btn-ghost cursor-pointer !py-2 !text-[12.5px]">
                  {form.logo_url ? "Change logo" : "Upload logo"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="nm-label">Category</label>
                <select className="nm-input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                  {categories.map((c) => <option key={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="nm-label">I sell</label>
                <select className="nm-input" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                  <option value="goods">Goods only</option>
                  <option value="services">Services only</option>
                  <option value="both">Both goods and services</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="nm-label">State</label>
                <select className="nm-input" value={form.state}
                  onChange={(e) => setForm((f) => ({ ...f, state: e.target.value, city: lgasFor(e.target.value)[0] ?? f.city }))}>
                  {NIGERIA_STATES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="nm-label">City / LGA</label>
                <select className="nm-input" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}>
                  {(lg.length ? lg : [form.city]).filter(Boolean).map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <Alert tone="blue">
              Buyers can only order from sellers in their own city. Choose the city where you actually deliver from.
            </Alert>
          </div>

          {err && <div className="mt-3"><Alert tone="red">{err}</Alert></div>}
          <button onClick={saveStep1} disabled={busy} className="nm-btn-primary mt-4 w-full !py-3">
            {busy ? <><Spinner /> Saving…</> : "Next"}
          </button>
        </Card>
      )}

      {step === 2 && (
        <Card className="p-4">
          <h1 className="text-[19px] font-extrabold tracking-tight text-ink-900">Verification</h1>
          <p className="mt-1 text-[13px] text-ink-500">
            We verify every seller before the shop goes live. Your details are only used to verify your business.
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="nm-label">NIN or CAC number</label>
              <input className="nm-input" value={verif.nin_or_cac}
                onChange={(e) => setVerif((v) => ({ ...v, nin_or_cac: e.target.value }))} placeholder="CAC RC number or your NIN" />
            </div>
            <div>
              <label className="nm-label">Bank account name</label>
              <input className="nm-input" value={verif.bank_account_name}
                onChange={(e) => setVerif((v) => ({ ...v, bank_account_name: e.target.value }))} placeholder="Must match your ID" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="nm-label">Account number</label>
                <input className="nm-input" inputMode="numeric" value={verif.bank_account_number}
                  onChange={(e) => setVerif((v) => ({ ...v, bank_account_number: e.target.value.replace(/\D/g, "") }))} placeholder="10 digits" />
              </div>
              <div>
                <label className="nm-label">Bank</label>
                <select className="nm-input" value={verif.bank_name} onChange={(e) => setVerif((v) => ({ ...v, bank_name: e.target.value }))}>
                  {["SmartCash", "GTBank", "Access Bank", "Zenith Bank", "First Bank", "UBA", "Kuda", "Opay", "Moniepoint", "Sterling", "Fidelity"].map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="nm-label">
                ID document <span className="text-red-600">*</span>
              </label>
              <p className="mb-1.5 text-[11.5px] leading-relaxed text-ink-500">
                Required. Upload one of: NIN slip, national ID card, driver&apos;s licence or
                voter&apos;s card. A CAC certificate is also accepted for a registered business.
              </p>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[var(--line)] px-3 py-2.5 text-[12.5px] text-ink-500 hover:border-brand-400 hover:bg-brand-50/40">
                <span className="text-brand-600">📎</span>
                {uploading === "doc" ? "Uploading…" : "Upload NIN, ID, driver's licence or voter's card"}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  required
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadDoc(e.target.files[0])}
                />
              </label>
              {verif.documents.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {verif.documents.map((d) => (
                    <li key={d}><a href={d} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-brand-600">Document uploaded ✓</a></li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {err && <div className="mt-3"><Alert tone="red">{err}</Alert></div>}
          <div className="mt-4 flex gap-2">
            <Link href="/seller/onboarding?step=1" className="nm-btn-ghost !py-3">Back</Link>
            <button onClick={saveStep2} disabled={busy} className="nm-btn-primary flex-1 !py-3">
              {busy ? <><Spinner /> Saving…</> : "Next"}
            </button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="p-4">
          <h1 className="text-[19px] font-extrabold tracking-tight text-ink-900">Choose your plan</h1>
          <p className="mt-1 text-[13px] text-ink-500">One subscription covers unlimited listings.</p>

          <div className="mt-3 rounded-2xl border border-brand-500/25 bg-brand-50/60 p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-[13.5px] font-bold text-brand-900">Seller subscription</p>
              <p className="text-[19px] font-extrabold text-brand-900">₦{subscriptionPrice.toLocaleString()} <span className="text-[12px] font-medium">/ month</span></p>
            </div>
            <ul className="mt-2 space-y-1 text-[12.5px] text-brand-900/80">
              <li>✓ List unlimited products and services</li>
              <li>✓ Receive orders from buyers in your city</li>
              <li>✓ Get paid 4 days after delivery</li>
              <li>✓ 5% commission per order — nothing else</li>
            </ul>
          </div>

          <div className="mt-3 rounded-xl border border-[var(--line)] p-3">
            <p className="text-[12px] font-bold text-ink-900">Transfer to</p>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              <dt className="text-ink-500">Bank</dt><dd className="font-semibold">{bank.bank_name}</dd>
              <dt className="text-ink-500">Account</dt><dd className="font-mono font-semibold">{bank.bank_account_number}</dd>
              <dt className="text-ink-500">Name</dt><dd className="font-semibold">{bank.bank_account_name}</dd>
              <dt className="text-ink-500">Amount</dt><dd className="font-semibold">₦{subscriptionPrice.toLocaleString()}</dd>
              <dt className="text-ink-500">Reference</dt><dd className="font-mono font-bold text-brand-700">SUB-{(shop?.id ?? "").slice(0, 6).toUpperCase()}</dd>
            </dl>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-400">
              Your first ₦{subscriptionPrice.toLocaleString()} can also be deducted from your first payout instead of paying now — just tell support.
            </p>
          </div>

          <div className="mt-3">
            <label className="nm-label">Upload receipt</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[var(--line)] px-3 py-2.5 text-[12.5px] text-ink-500 hover:border-brand-400 hover:bg-brand-50/40">
              <span className="text-brand-600">📎</span>
              {receipt ? receipt.name : "Choose the transfer receipt"}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
            </label>
          </div>

          {err && <div className="mt-3"><Alert tone="red">{err}</Alert></div>}
          <div className="mt-4 flex gap-2">
            <Link href="/seller/onboarding?step=2" className="nm-btn-ghost !py-3">Back</Link>
            <button onClick={saveStep3} disabled={busy} className="nm-btn-primary flex-1 !py-3">
              {busy ? <><Spinner /> Submitting…</> : "I have paid — submit for approval"}
            </button>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card className="p-6 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-50">
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-amber-600" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" />
            </svg>
          </div>
          <h1 className="mt-3 text-[21px] font-extrabold tracking-tight text-ink-900">Your shop is under review</h1>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-500">
            We&apos;re verifying your payment and details. This usually takes less than 24 hours.
          </p>

          <ol className="mx-auto mt-4 max-w-sm space-y-2 text-left">
            {[
              { label: "Details submitted", done: true },
              { label: "Payment received", done: true },
              { label: "Under review", current: true },
              { label: "Approved", done: false },
            ].map((s) => (
              <li key={s.label} className="flex items-center gap-2.5">
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${s.done ? "bg-brand-500 text-white" : s.current ? "bg-amber-400 text-white ring-4 ring-amber-400/20" : "border-2 border-slate-200 text-transparent"}`}>
                  ✓
                </span>
                <span className={`text-[12.5px] ${s.done ? "font-semibold text-ink-900" : s.current ? "font-semibold text-amber-700" : "text-ink-400"}`}>
                  {s.label}{s.current && " · current"}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <a
              href={supportWhatsAppUrl("Hi, I just submitted my NaijaMart seller application.")}
              target="_blank" rel="noreferrer" className="nm-btn-ghost"
            >
              Contact support on WhatsApp
            </a>
            <Link href="/" className="nm-btn-primary">Keep browsing</Link>
          </div>
        </Card>
      )}
    </div>
  );
}
