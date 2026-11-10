"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, uploadToBucket } from "@/lib/supabase/client";
import { naira, relTime } from "@/lib/utils";
import { Avatar, Badge, Spinner, OrderStatusChip } from "@/components/ui";

type Msg = {
  id: string;
  sender_id: string;
  body: string | null;
  image_url: string | null;
  created_at: string;
};

type Offer = {
  id: string;
  price: number;
  scope: string | null;
  timeline: string | null;
  status: "pending" | "accepted" | "declined";
  seller_id: string;
  created_at: string;
};

export function ChatThread({
  chatId,
  meId,
  amSeller,
  otherName,
  otherAvatar,
  shopName,
  shopLogo,
  order,
  initialMessages,
  initialOffers,
}: {
  chatId: string;
  meId: string;
  amSeller: boolean;
  otherName: string;
  otherAvatar: string | null;
  shopName: string | null;
  shopLogo: string | null;
  order: { id: string; reference: string; status: string; total: number; fulfilment: string } | null;
  initialMessages: Msg[];
  initialOffers: Offer[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [offers, setOffers] = useState<Offer[]>(initialOffers);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offer, setOffer] = useState({ price: "", scope: "", timeline: "" });
  const [err, setErr] = useState("");
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // live updates
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`chat-${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offers", filter: `chat_id=eq.${chatId}` },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [chatId, router]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { error } = await supabase.from("messages").insert({ chat_id: chatId, sender_id: meId, body });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setText("");
  }

  async function sendImage(file: File) {
    setUploading(true);
    setErr("");
    try {
      const url = await uploadToBucket(file, `chat/${chatId}`);
      const supabase = createClient();
      const { error } = await supabase.from("messages").insert({ chat_id: chatId, sender_id: meId, image_url: url });
      if (error) throw new Error(error.message);
    } catch (e: any) {
      setErr(e.message);
    }
    setUploading(false);
  }

  async function sendOffer(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(offer.price);
    if (!price || price <= 0) { setErr("Enter a price for the offer."); return; }
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { data: chat } = await supabase.from("chats").select("buyer_id").eq("id", chatId).single();
    const { error } = await supabase.from("offers").insert({
      chat_id: chatId,
      seller_id: meId,
      buyer_id: chat!.buyer_id,
      price,
      scope: offer.scope || null,
      timeline: offer.timeline || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOfferOpen(false);
    setOffer({ price: "", scope: "", timeline: "" });
    router.refresh();
  }

  async function acceptOffer(id: string) {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("accept_offer", { p_offer_id: id });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    router.push(`/orders/${row.id}`);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8.5rem)] max-w-2xl flex-col md:h-[calc(100vh-7.5rem)]">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-[var(--line)] pb-2.5">
        <Link href="/chats" className="rounded-lg p-1 text-ink-400 hover:text-ink-900" aria-label="Back">←</Link>
        <Avatar name={amSeller ? otherName : (shopName ?? otherName)} src={amSeller ? otherAvatar : shopLogo} size={34} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-bold text-ink-900">{amSeller ? otherName : (shopName ?? otherName)}</p>
          <p className="text-[11px] text-ink-400">{amSeller ? "Buyer" : "Seller"}</p>
        </div>
        {order && (
          <Link href={`/orders/${order.id}`} className="ml-auto text-[11.5px] font-semibold text-brand-600">
            View order →
          </Link>
        )}
      </div>

      {/* pinned order context */}
      {order && (
        <Link href={`/orders/${order.id}`} className="mt-2 block rounded-xl border border-brand-500/20 bg-brand-50/70 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] font-semibold text-brand-900">{order.reference}</p>
            <OrderStatusChip status={order.status} />
          </div>
          <p className="mt-0.5 text-[12px] text-brand-900/80">
            {naira(order.total)} · {order.fulfilment === "pickup" ? "Pickup" : "Delivery"}
          </p>
        </Link>
      )}

      {/* messages */}
      <div className="nm-scroll mt-2 flex-1 space-y-2 overflow-y-auto py-2">
        {messages.length === 0 && (
          <div className="mx-auto mt-8 max-w-xs rounded-xl bg-slate-50 px-3 py-3 text-center text-[12px] leading-relaxed text-ink-500">
            No messages yet. {amSeller
              ? "Ask the buyer what they need — then send an offer with your price."
              : "Say hello and describe what you need. The seller will send a price."}
          </div>
        )}

        {messages.map((m) => {
          const mine = m.sender_id === meId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[78%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                  mine ? "bg-brand-500 text-white" : "bg-white text-ink-900 shadow-card"
                }`}
              >
                {m.image_url && (
                  <a href={m.image_url} target="_blank" rel="noreferrer" className="mb-1 block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.image_url} alt="" className="max-h-56 rounded-lg object-cover" />
                  </a>
                )}
                {m.body && <p className="whitespace-pre-line">{m.body}</p>}
                <p className={`mt-1 text-[10px] ${mine ? "text-white/60" : "text-ink-400"}`}>{relTime(m.created_at)}</p>
              </div>
            </div>
          );
        })}

        {/* offers inline */}
        {offers.map((o) => (
          <div key={o.id} className="mx-auto w-full max-w-sm rounded-2xl border border-brand-500/30 bg-white p-3 shadow-card">
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] font-bold uppercase tracking-wide text-brand-700">Quote</p>
              <Badge tone={o.status === "accepted" ? "green" : o.status === "declined" ? "gray" : "amber"}>
                {o.status === "accepted" ? "Accepted" : o.status === "declined" ? "Declined" : "Awaiting buyer"}
              </Badge>
            </div>
            <p className="mt-1 text-[20px] font-extrabold text-ink-900">{naira(o.price)}</p>
            {o.scope && <p className="text-[12.5px] text-ink-600">Scope: {o.scope}</p>}
            {o.timeline && <p className="text-[12.5px] text-ink-600">Timeline: {o.timeline}</p>}
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
              Accepting creates an order. Pay NaijaMart by transfer — we hold it until you confirm the job is done.
            </p>
            {!amSeller && o.status === "pending" && (
              <button onClick={() => acceptOffer(o.id)} disabled={busy} className="nm-btn-primary mt-2 w-full !py-2">
                {busy ? <Spinner /> : `Accept offer · ${naira(o.price)}`}
              </button>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {err && <p className="pb-1 text-[11.5px] font-medium text-red-600">{err}</p>}

      {/* offer composer (seller) */}
      {offerOpen && amSeller && (
        <form onSubmit={sendOffer} className="mb-2 space-y-2 rounded-xl border border-[var(--line)] bg-white p-3 shadow-card">
          <p className="text-[12.5px] font-bold text-ink-900">Send a formal offer</p>
          <input className="nm-input !py-2 !text-[13px]" placeholder="Price (₦)" inputMode="numeric" value={offer.price}
            onChange={(e) => setOffer((o) => ({ ...o, price: e.target.value.replace(/\D/g, "") }))} />
          <input className="nm-input !py-2 !text-[13px]" placeholder="What's included (scope)" value={offer.scope}
            onChange={(e) => setOffer((o) => ({ ...o, scope: e.target.value }))} />
          <input className="nm-input !py-2 !text-[13px]" placeholder="Timeline, e.g. 2 days" value={offer.timeline}
            onChange={(e) => setOffer((o) => ({ ...o, timeline: e.target.value }))} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="nm-btn-primary flex-1 !py-2">{busy ? <Spinner /> : "Send offer"}</button>
            <button type="button" onClick={() => setOfferOpen(false)} className="nm-btn-ghost !py-2">Cancel</button>
          </div>
        </form>
      )}

      {/* composer */}
      <form onSubmit={send} className="flex items-center gap-1.5 border-t border-[var(--line)] bg-white pt-2">
        <label className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-xl text-ink-400 hover:bg-slate-50 hover:text-brand-600">
          {uploading ? <Spinner className="!h-4 !w-4" /> : "📎"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && sendImage(e.target.files[0])} />
        </label>
        {amSeller && (
          <button type="button" onClick={() => setOfferOpen((o) => !o)}
            className="shrink-0 rounded-xl border border-[var(--line)] px-2.5 py-2 text-[11.5px] font-semibold text-ink-700 hover:bg-slate-50">
            Offer
          </button>
        )}
        <input
          className="nm-input !py-2.5"
          placeholder="Message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={busy || !text.trim()} className="nm-btn-primary shrink-0 !px-3.5 !py-2.5">
          Send
        </button>
      </form>
    </div>
  );
}
