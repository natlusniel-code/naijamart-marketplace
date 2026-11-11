"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, uploadToBucket } from "@/lib/supabase/client";
import { readCart, writeCart, clearCart, shopSubtotal, shopDelivery, type Cart } from "@/lib/cart";
import { naira } from "@/lib/utils";
import { Spinner, Alert, Badge } from "@/components/ui";
import { SupportLink } from "@/components/support-link";
import { CopyValue, CopyPaymentDetails } from "@/components/copy-value";

type SavedAddress = {
  id: string;
  label: string;
  line1: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  is_default: boolean;
};

export function CheckoutFlow({
  signedIn,
  isBanned,
  profileCity,
  profileState,
  account,
  addresses,
}: {
  signedIn: boolean;
  isBanned: boolean;
  profileCity: string | null;
  profileState: string | null;
  account: {
    bank_name: string;
    account_number: string;
    account_name: string;
    label: string | null;
  } | null;
  addresses: SavedAddress[];
}) {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [addressesState, setAddressesState] = useState<SavedAddress[]>(addresses);
  const [chosenAddress, setChosenAddress] = useState<string>(addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? "");
  const [newAddress, setNewAddress] = useState({ line1: "", city: profileCity ?? "", state: "", phone: "", label: "Home" });
  const [adding, setAdding] = useState(addresses.length === 0);
  const [note, setNote] = useState("");
  const [receipts, setReceipts] = useState<Record<string, File | null>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    setCart(readCart());
  }, []);

  const shops = useMemo(() => (cart ? Object.values(cart) : []), [cart]);
  const grand = shops.reduce((n, s) => n + shopSubtotal(s) + shopDelivery(s), 0);

  // ₦20,000 is the cross-LGA threshold (platform_settings.cross_lga_min_total).
  // The server enforces it in place_order(); this only mirrors the message.
  const CROSS_LGA_MIN = 20000;

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-2xl">🔐</div>
        <h1 className="mt-4 text-[20px] font-extrabold text-ink-900">Sign in to check out</h1>
        <p className="mt-1.5 text-[13.5px] text-ink-500">
          We need an account to hold your payment in escrow and to send you the order updates.
        </p>
        <Link href="/signin?next=%2Fcheckout" className="nm-btn-primary mt-5 w-full">Sign in</Link>
        <Link href="/signup" className="nm-btn-ghost mt-2 w-full">Create an account</Link>
      </div>
    );
  }

  if (cart === null) return <div className="h-72 nm-skeleton rounded-2xl" />;

  if (shops.length === 0) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-[20px] font-extrabold text-ink-900">Your cart is empty</h1>
        <p className="mt-1.5 text-[13.5px] text-ink-500">Add an item before checking out.</p>
        <Link href="/" className="nm-btn-primary mt-5 inline-flex">Browse the marketplace</Link>
      </div>
    );
  }

  const addressObj = addressesState.find((a) => a.id === chosenAddress);
  const addressText = addressObj
    ? `${addressObj.label}: ${addressObj.line1}, ${addressObj.city ?? ""} ${addressObj.state ?? ""}`.trim()
    : "";

  /**
   * Distance rule, mirrored from place_order() so the buyer sees the same
   * message before submitting. The RPC is still the authority.
   *   total >  ₦20,000 → any LGA, but inside the buyer's own state
   *   total <= ₦20,000 → the buyer's own state AND LGA
   */
  function rangeProblem(shop: (typeof shops)[number]): string | null {
    const total = shopSubtotal(shop) + shopDelivery(shop);
    const sameState =
      !profileState || !shop.state || shop.state.toLowerCase() === profileState.toLowerCase();
    const sameLga =
      !profileCity || !shop.city || shop.city.toLowerCase() === profileCity.toLowerCase();

    if (total > CROSS_LGA_MIN) {
      if (sameState) return null;
      return `${shop.shopName} is in ${shop.state ?? "another state"}. Orders over ${naira(
        CROSS_LGA_MIN
      )} can be delivered to any LGA in your own state (${profileState ?? "your state"}), but not outside it.`;
    }

    if (sameState && sameLga) return null;
    return `${shop.shopName} is in ${shop.city ?? shop.state ?? "another area"}, outside your LGA (${
      profileCity ?? "not set"
    }). Orders under ${naira(CROSS_LGA_MIN)} can only be placed with sellers in your own LGA — add more items to reach ${naira(
      CROSS_LGA_MIN
    )} and you can order from any LGA in ${profileState ?? "your"} state.`;
  }

  const outOfRange = shops
    .map((s) => ({ shop: s, problem: rangeProblem(s) }))
    .filter((r): r is { shop: (typeof shops)[number]; problem: string } => !!r.problem);

  async function saveAddress() {
    if (!newAddress.line1.trim()) return;
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("addresses")
      .insert({
        user_id: userData.user!.id,
        label: newAddress.label || "Home",
        line1: newAddress.line1.trim(),
        city: newAddress.city || profileCity,
        state: newAddress.state || null,
        phone: newAddress.phone || null,
        is_default: addressesState.length === 0,
      })
      .select("*")
      .single();
    if (error) { setErr(error.message); return; }
    setAddressesState((a) => [...a, data as SavedAddress]);
    setChosenAddress((data as SavedAddress).id);
    setAdding(false);
  }

  async function placeAll() {
    if (outOfRange.length) {
      setErr(outOfRange[0].problem);
      return;
    }
    if (!agreed) {
      setErr("Please accept the NaijaMart Marketplace Policy and the payment terms to continue.");
      return;
    }
    for (const s of shops) {
      if (s.fulfilment === "delivery" && !addressText) {
        setErr("Add a delivery address, or switch that shop to pickup.");
        return;
      }
      if (!receipts[s.shopId]) {
        setErr(`Upload the transfer receipt for ${s.shopName} so we can verify your payment.`);
        return;
      }
    }

    setBusy(true);
    setErr("");
    const supabase = createClient();

    try {
      for (const s of shops) {
        const { data: order, error } = await supabase.rpc("place_order", {
          p_shop_id: s.shopId,
          p_items: s.lines.map((l) => ({ listing_id: l.listingId, quantity: l.quantity })),
          p_fulfilment: s.fulfilment,
          p_address: s.fulfilment === "delivery" ? addressText : null,
          p_note: note || null,
        });

        if (error) throw new Error(`${s.shopName}: ${error.message}`);

        const row = Array.isArray(order) ? order[0] : order;
        const file = receipts[s.shopId];
        if (file) {
          const url = await uploadToBucket(file, `receipts/${row.id}`);
          const { error: recErr } = await supabase.rpc("submit_receipt", {
            p_order_id: row.id,
            p_receipt_url: url,
          });
          if (recErr) throw new Error(`${s.shopName}: ${recErr.message}`);
        }
      }

      clearCart();
      router.push("/orders?placed=1");
      router.refresh();
    } catch (e: any) {
      setBusy(false);
      setErr(e.message ?? "Something went wrong placing your order.");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] lg:items-start">
      <div className="space-y-4">
        {isBanned && (
          <Alert tone="red" title="This account is suspended">
            You can browse, but you can&apos;t place orders.{" "}
            <SupportLink className="!text-red-700">Contact support on WhatsApp</SupportLink> to resolve it.
          </Alert>
        )}

        {/* address */}
        <div className="nm-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14.5px] font-bold text-ink-900">Delivery address</h2>
            {addressesState.length > 0 && !adding && (
              <button onClick={() => setAdding(true)} className="text-[12.5px] font-semibold text-brand-600">+ Add new</button>
            )}
          </div>

          {addressesState.length > 0 && !adding && (
            <div className="mt-2.5 space-y-2">
              {addressesState.map((a) => (
                <label
                  key={a.id}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition ${
                    chosenAddress === a.id ? "border-brand-500 bg-brand-50/50" : "border-[var(--line)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="addr"
                    checked={chosenAddress === a.id}
                    onChange={() => setChosenAddress(a.id)}
                    className="mt-0.5 text-brand-500 focus:ring-brand-500"
                  />
                  <span>
                    <span className="text-[13px] font-semibold text-ink-900">{a.label}</span>
                    <span className="block text-[12.5px] text-ink-500">{a.line1}{a.city ? `, ${a.city}` : ""} {a.state ?? ""}</span>
                    {a.phone && <span className="block text-[12px] text-ink-400">{a.phone}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}

          {adding && (
            <div className="mt-2.5 space-y-2.5">
              <input className="nm-input" placeholder="Street address, e.g. 12 Kuto Road" value={newAddress.line1}
                onChange={(e) => setNewAddress((a) => ({ ...a, line1: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2.5">
                <input className="nm-input" placeholder="City" value={newAddress.city}
                  onChange={(e) => setNewAddress((a) => ({ ...a, city: e.target.value }))} />
                <input className="nm-input" placeholder="State" value={newAddress.state}
                  onChange={(e) => setNewAddress((a) => ({ ...a, state: e.target.value }))} />
              </div>
              <input className="nm-input" placeholder="Phone for the rider" value={newAddress.phone}
                onChange={(e) => setNewAddress((a) => ({ ...a, phone: e.target.value }))} />
              <div className="flex gap-2">
                <button onClick={saveAddress} className="nm-btn-soft flex-1 !py-2">Save address</button>
                {addressesState.length > 0 && (
                  <button onClick={() => setAdding(false)} className="nm-btn-ghost !py-2">Cancel</button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* per-shop orders + payment instructions */}
        {shops.map((s) => {
          const sub = shopSubtotal(s);
          const fee = shopDelivery(s);
          return (
            <div key={s.shopId} className="nm-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
                <p className="text-[13.5px] font-bold text-ink-900">🏪 {s.shopName}</p>
                <Badge tone={s.fulfilment === "pickup" ? "blue" : "gray"}>
                  {s.fulfilment === "pickup" ? "Pickup" : "Delivery"}
                </Badge>
              </div>

              <div className="divide-y divide-[var(--line)] px-4">
                {s.lines.map((l) => (
                  <div key={l.listingId} className="flex justify-between gap-3 py-2.5">
                    <p className="text-[12.5px] text-ink-600">
                      {l.title} <span className="text-ink-400">×{l.quantity}</span>
                    </p>
                    <p className="shrink-0 text-[12.5px] font-semibold text-ink-900">{naira(l.price * l.quantity)}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-1 border-t border-[var(--line)] px-4 py-2.5 text-[12.5px]">
                <div className="flex justify-between"><span className="text-ink-500">Subtotal</span><span className="font-semibold">{naira(sub)}</span></div>
                <div className="flex justify-between"><span className="text-ink-500">Delivery</span><span className="font-semibold">{fee === 0 ? "Free" : naira(fee)}</span></div>
                <div className="flex justify-between pt-1 text-[14px]"><span className="font-bold text-ink-900">Transfer exactly</span><span className="font-extrabold text-ink-900">{naira(sub + fee)}</span></div>
              </div>

              {/* bank details — the account reserved for THIS buyer (sql/0011) */}
              <div className="mx-4 mb-3 rounded-xl border border-brand-500/25 bg-brand-50/60 p-3">
                <p className="text-[12px] font-bold text-brand-900">Pay NaijaMart (escrow account)</p>
                {account ? (
                  <>
                    <dl className="mt-1.5 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[12.5px]">
                      <dt className="text-brand-900/60">Bank</dt>
                      <dd className="text-brand-900">
                        <CopyValue value={account.bank_name} label="bank name" />
                      </dd>
                      <dt className="text-brand-900/60">Account</dt>
                      <dd className="text-brand-900">
                        <CopyValue value={account.account_number} label="account number" mono />
                      </dd>
                      <dt className="text-brand-900/60">Name</dt>
                      <dd className="text-brand-900">
                        <CopyValue value={account.account_name} label="account name" />
                      </dd>
                      <dt className="text-brand-900/60">Amount</dt>
                      <dd className="text-brand-900">
                        {/* Shows "₦12,500" but copies the bare digits — a transfer form rejects the symbol. */}
                        <CopyValue value={String(sub + fee)} label="amount" className="text-[13.5px]">
                          {naira(sub + fee)}
                        </CopyValue>
                      </dd>
                    </dl>
                    <CopyPaymentDetails
                      bank={account.bank_name}
                      accountNumber={account.account_number}
                      accountName={account.account_name}
                      amount={String(sub + fee)}
                      amountLabel={naira(sub + fee)}
                    />
                  </>
                ) : (
                  <p className="mt-1.5 text-[12.5px] text-brand-900/80">
                    No payment account is set up yet. Please contact support before transferring.
                  </p>
                )}
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-brand-900/70">
                  Tap the copy icon beside any detail to paste it into your bank app. Transfer the exact
                  amount, then upload your receipt below. Your reference is generated when the order is created.
                </p>
              </div>

              {/* receipt */}
              <div className="border-t border-[var(--line)] px-4 py-3">
                <label className="nm-label">Upload transfer receipt</label>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-dashed border-[var(--line)] px-3 py-2.5 text-[12.5px] text-ink-500 hover:border-brand-400 hover:bg-brand-50/40">
                  <span className="text-brand-600">📎</span>
                  {receipts[s.shopId] ? receipts[s.shopId]!.name : "Choose an image or PDF of your transfer"}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => setReceipts((r) => ({ ...r, [s.shopId]: e.target.files?.[0] ?? null }))}
                  />
                </label>
              </div>
            </div>
          );
        })}

        <div className="nm-card p-4">
          <label className="nm-label" htmlFor="note">Note for the seller (optional)</label>
          <textarea id="note" rows={2} className="nm-input resize-none" value={note}
            onChange={(e) => setNote(e.target.value)} placeholder="Any delivery instruction…" />
        </div>
      </div>

      {/* summary */}
      <div className="nm-card p-4 lg:sticky lg:top-20">
        <h2 className="text-[15px] font-bold text-ink-900">You&apos;re paying</h2>
        <p className="mt-1 text-[26px] font-extrabold tracking-tight text-ink-900">{naira(grand)}</p>
        <p className="text-[11.5px] text-ink-500">
          across {shops.length} {shops.length === 1 ? "shop" : "shops"} · held in escrow
        </p>

        {outOfRange.length > 0 && (
          <div className="mt-3 space-y-2">
            {outOfRange.map((r) => (
              <Alert key={r.shop.shopId} tone="amber">
                {r.problem}
              </Alert>
            ))}
          </div>
        )}

        {err && <div className="mt-3"><Alert tone="red">{err}</Alert></div>}

        {/* terms acknowledgement — required before the order can be placed */}
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--line)] p-3">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-600)]"
          />
          <span className="text-[11.5px] leading-relaxed text-ink-600">
            I have read and accept the{" "}
            <Link href="/legal" className="font-semibold text-brand-600 underline">
              NaijaMart Marketplace Policy
            </Link>
            , including the Buyer Policy, Payments and Escrow, and Orders, Delivery, Cancellation and
            Returns sections. I confirm the details of this order are correct and that I will keep
            payment and communication inside the platform.
          </span>
        </label>

        <button
          onClick={placeAll}
          disabled={busy || isBanned || outOfRange.length > 0 || !agreed}
          className="nm-btn-primary mt-3 w-full !py-3 disabled:opacity-50"
        >
          {busy ? <><Spinner /> Placing order…</> : "I have paid — submit order"}
        </button>

        <ul className="mt-3 space-y-1.5 text-[11.5px] leading-relaxed text-ink-500">
          <li>• We verify your receipt, usually within a few hours.</li>
          <li>• The seller must accept within 24 hours or you&apos;re refunded.</li>
          <li>• Money is released to the seller 4 days after you confirm delivery.</li>
          <li>• Orders over ₦20,000 can come from any LGA in your state; under that, your own LGA only.</li>
        </ul>
      </div>
    </div>
  );
}
