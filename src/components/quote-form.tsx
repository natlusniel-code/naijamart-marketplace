"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { naira } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";

export function QuoteForm({
  listingId,
  shopId,
  price,
  shopName,
  signedIn,
  canOrderInCity,
}: {
  listingId: string;
  shopId: string;
  price: number;
  shopName: string;
  signedIn: boolean;
  canOrderInCity: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    description: "",
    preferred_date: "",
    address: "",
    budget_min: "",
    budget_max: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!signedIn) {
      router.push(`/signin?next=${encodeURIComponent(`/listing/${listingId}`)}`);
      return;
    }
    if (form.description.trim().length < 10) {
      setErr("Describe the job in a sentence or two so the seller can quote accurately.");
      return;
    }
    setBusy(true);
    setErr("");
    const supabase = createClient();

    const { data: enq, error } = await supabase
      .from("enquiries")
      .insert({
        shop_id: shopId,
        listing_id: listingId,
        buyer_id: (await supabase.auth.getUser()).data.user!.id,
        description: form.description.trim(),
        preferred_date: form.preferred_date || null,
        address: form.address || null,
        budget_min: form.budget_min ? Number(form.budget_min) : null,
        budget_max: form.budget_max ? Number(form.budget_max) : null,
      })
      .select("id")
      .single();

    if (error) {
      setBusy(false);
      setErr(error.message);
      return;
    }

    // open the chat with the enquiry attached
    const { data: chatId, error: chatErr } = await supabase.rpc("start_chat", {
      p_shop_id: shopId,
      p_order_id: null,
    });

    if (!chatErr && chatId) {
      await supabase.from("chats").update({ enquiry_id: enq.id }).eq("id", chatId);
      // Goes through the server-side guard (sql/0011) like every other
      // message — a direct insert into `messages` is no longer allowed.
      await supabase.rpc("send_chat_message", {
        p_chat_id: chatId,
        p_body: `Quote request: ${form.description.trim()}${
          form.budget_max ? `\nBudget: ${naira(form.budget_min || 0)} – ${naira(form.budget_max)}` : ""
        }${form.preferred_date ? `\nPreferred date: ${form.preferred_date}` : ""}`,
        p_image_url: null,
      });
      setBusy(false);
      router.push(`/chats/${chatId}`);
      return;
    }

    setBusy(false);
    setDone(true);
  }

  if (done) {
    return (
      <Alert tone="green" title="Quote request sent">
        {shopName} will reply in your chats with a price and timeline. You only pay when you accept their offer.
      </Alert>
    );
  }

  return (
    <div className="nm-card p-4">
      <h2 className="text-[14.5px] font-bold text-ink-900">Request a quote</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-500">
        Starting at {naira(price)}. {shopName} sends a firm price — you accept or decline.
      </p>

      {!canOrderInCity && (
        <div className="mt-3">
          <Alert tone="amber">
            This provider works in a different city from yours. You can still chat, but orders are limited to your own city.
          </Alert>
        </div>
      )}

      <form onSubmit={submit} className="mt-3 space-y-2.5">
        <div>
          <label className="nm-label" htmlFor="desc">Describe the job</label>
          <textarea
            id="desc"
            rows={3}
            className="nm-input resize-none"
            placeholder="e.g. Kitchen sink is leaking under the cabinet, need it fixed this week."
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="nm-label" htmlFor="date">Preferred date</label>
            <input
              id="date"
              type="date"
              className="nm-input"
              value={form.preferred_date}
              onChange={(e) => setForm((f) => ({ ...f, preferred_date: e.target.value }))}
            />
          </div>
          <div>
            <label className="nm-label" htmlFor="addr">Address / area</label>
            <input
              id="addr"
              className="nm-input"
              placeholder="Kuto, Abeokuta"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="nm-label" htmlFor="bmin">Budget from (₦)</label>
            <input id="bmin" inputMode="numeric" className="nm-input" value={form.budget_min}
              onChange={(e) => setForm((f) => ({ ...f, budget_min: e.target.value.replace(/\D/g, "") }))} placeholder="5000" />
          </div>
          <div>
            <label className="nm-label" htmlFor="bmax">Budget to (₦)</label>
            <input id="bmax" inputMode="numeric" className="nm-input" value={form.budget_max}
              onChange={(e) => setForm((f) => ({ ...f, budget_max: e.target.value.replace(/\D/g, "") }))} placeholder="15000" />
          </div>
        </div>

        {err && <p className="text-[12px] font-medium text-red-600">{err}</p>}

        <button type="submit" disabled={busy} className="nm-btn-primary w-full !py-2.5">
          {busy ? <><Spinner /> Sending…</> : "Send quote request"}
        </button>
        <p className="text-center text-[11px] text-ink-400">
          Free to ask. No payment until you accept an offer.
        </p>
      </form>
    </div>
  );
}
