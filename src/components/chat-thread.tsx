"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  read_at?: string | null;
  delivered_at?: string | null;
  /** client-only: rendered before the server confirms, replaced by the real row */
  pending?: boolean;
  failed?: boolean;
};

type Offer = {
  id: string;
  price: number;
  scope: string | null;
  timeline: string | null;
  status: "pending" | "accepted" | "declined";
  seller_id: string;
  image_url?: string | null;
  created_at: string;
};

/** A locally-generated id for an optimistic row. Never sent to the server. */
const tempId = () => `tmp-${crypto.randomUUID()}`;

function Ticks({ read }: { read: boolean }) {
  // Single tick = sent (not seen yet). Double tick = seen.
  return (
    <span
      className="ml-1 inline-flex items-center align-middle"
      aria-label={read ? "Seen" : "Sent, not seen yet"}
      title={read ? "Seen" : "Sent"}
    >
      <svg
        viewBox="0 0 16 11"
        className="h-[9px] w-[13px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m1.5 6 2.6 2.7L9.4 2" />
        {read && <path d="m6.4 6.2 2.6 2.7L14.3 2" />}
      </svg>
    </span>
  );
}

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
  basePath = "/chats",
  initialDraft,
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
  /**
   * Where this thread lives: `/chats` in the storefront, `/seller/chats` in the
   * Seller Hub. The back link and the post-accept redirect use it, so a seller
   * is never sent into the storefront — which now redirects them straight back
   * to the hub.
   */
  basePath?: string;
  /**
   * Text to seed the composer with — the "I want this plan" message built by
   * `composePlanMessage`. It arrives from the URL, lands in the input box, and
   * NOTHING is sent: the buyer reads it, edits it if they like, and presses
   * Send themselves.
   */
  initialDraft?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [offers, setOffers] = useState<Offer[]>(initialOffers);
  const [text, setText] = useState(initialDraft ?? "");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offer, setOffer] = useState({ price: "", scope: "", timeline: "" });
  const [offerImage, setOfferImage] = useState<{ file: File; preview: string } | null>(null);
  /** image chosen but NOT sent yet — confirm before it leaves (item 5) */
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null);
  const [err, setErr] = useState("");
  /**
   * Set when the server refused a message. The text is never sent, so the
   * receiver never sees it — the sender gets this one warning instead.
   */
  const [blocked, setBlocked] = useState("");
  const bottom = useRef<HTMLDivElement | null>(null);

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }, []);

  useEffect(() => {
    scrollDown();
  }, [messages.length, scrollDown]);

  /**
   * Take the draft out of the address bar once it is in the composer.
   *
   * The text has already been read into state, so the parameter has done its
   * job. Leaving it there would resurrect a message the buyer had deleted or
   * already sent on every refresh — and would put their whole plan into any
   * link they copied from the address bar.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("draft")) {
      url.searchParams.delete("draft");
      window.history.replaceState({}, "", url.pathname + (url.search || "") + url.hash);
    }
  }, []);

  /* ------------------------------------------------------------------
   * Realtime.
   *
   * sql/0009 adds messages/offers/chats to the `supabase_realtime`
   * publication. Before that the publication was empty, so none of these
   * handlers ever fired — the root cause of "a sent message only appears
   * after leaving and re-entering the chat".
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`chat-${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) => {
            if (prev.some((x) => x.id === m.id)) return prev;
            // Drop the optimistic twin, matched by sender + payload because
            // the local row has no server id.
            const withoutPending = prev.filter(
              (x) => !(x.pending && x.sender_id === m.sender_id && x.body === m.body && x.image_url === m.image_url),
            );
            return [...withoutPending, m];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          // flips the tick the moment the other side opens the chat
          const m = payload.new as Msg;
          setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offers", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const row = payload.new as Offer;
          if (payload.eventType === "INSERT" && row?.id) {
            setOffers((prev) => (prev.some((o) => o.id === row.id) ? prev : [...prev, row]));
          } else if (payload.eventType === "UPDATE" && row?.id) {
            setOffers((prev) => prev.map((o) => (o.id === row.id ? { ...o, ...row } : o)));
          } else {
            router.refresh();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [chatId, router]);

  /* ------------------------------------------------------------------
   * Read receipts. Opening the chat (or receiving while it is open) marks
   * the other side's messages seen, flipping their tick to a double tick.
   * ------------------------------------------------------------------ */
  const incomingCount = messages.filter((m) => m.sender_id !== meId && !m.pending).length;
  useEffect(() => {
    if (!incomingCount) return;
    const supabase = createClient();
    supabase.rpc("mark_chat_read", { p_chat_id: chatId }).then(({ error }) => {
      if (!error) router.refresh();
    });
  }, [chatId, incomingCount, router]);

  /**
   * Send through `send_chat_message()` (sql/0011).
   *
   * The check runs in Postgres, not here: the direct INSERT policy on
   * `messages` is gone, so this RPC is the only way a message can be
   * written. A refused message is never inserted — the server returns
   * `{ blocked: true, warning }` and we show the warning instead of a
   * bubble. Nothing is masked and nothing partial is sent.
   */
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;

    setErr("");
    setBlocked("");
    setBusy(true);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("send_chat_message", {
      p_chat_id: chatId,
      p_body: body,
      p_image_url: null,
    });

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    const result = (Array.isArray(data) ? data[0] : data) as
      | { blocked?: boolean; warning?: string; message?: Msg }
      | null;

    if (result?.blocked) {
      // Keep the text in the box so the sender can rewrite it.
      setBlocked(result.warning ?? "This message was not sent.");
      return;
    }

    if (result?.message) {
      const saved = result.message;
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
      setText("");
    }
  }

  /** Step 1 of an image send: stage it. Nothing is uploaded or sent yet. */
  function stageImage(file: File) {
    if (!file.type.startsWith("image/")) {
      setErr("That file isn't an image.");
      return;
    }
    setErr("");
    setPendingImage({ file, preview: URL.createObjectURL(file) });
  }

  function cancelImage() {
    if (pendingImage) URL.revokeObjectURL(pendingImage.preview);
    setPendingImage(null);
  }

  /** Step 2: the user pressed Send in the preview. */
  async function confirmImage() {
    if (!pendingImage) return;
    const { file, preview } = pendingImage;
    setUploading(true);
    setErr("");
    try {
      const url = await uploadToBucket(file, `chat/${chatId}`);

      const supabase = createClient();
      const { data, error } = await supabase.rpc("send_chat_message", {
        p_chat_id: chatId,
        p_body: null,
        p_image_url: url,
      });
      if (error) throw new Error(error.message);

      const result = (Array.isArray(data) ? data[0] : data) as
        | { blocked?: boolean; warning?: string; message?: Msg }
        | null;
      if (result?.blocked) {
        setBlocked(result.warning ?? "This message was not sent.");
        setPendingImage(null);
        setUploading(false);
        return;
      }

      setPendingImage(null);
      if (result?.message) {
        const saved = result.message;
        setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
      }
    } catch (e: any) {
      setErr(e.message ?? "Could not send that image.");
    }
    setUploading(false);
  }

  async function sendOffer(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(offer.price);
    if (!price || price <= 0) {
      setErr("Enter a price for the offer.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      let imageUrl: string | null = null;
      if (offerImage) imageUrl = await uploadToBucket(offerImage.file, `offers/${chatId}`);

      const supabase = createClient();
      // The buyer comes from the chat; the RLS insert policy re-checks it.
      const { data: chat, error: chatErr } = await supabase
        .from("chats")
        .select("buyer_id")
        .eq("id", chatId)
        .single();
      if (chatErr) throw new Error(chatErr.message);

      const { data, error } = await supabase
        .from("offers")
        .insert({
          chat_id: chatId,
          seller_id: meId,
          buyer_id: chat.buyer_id,
          price,
          scope: offer.scope || null,
          timeline: offer.timeline || null,
          image_url: imageUrl,
        })
        .select("id,price,scope,timeline,status,seller_id,image_url,created_at")
        .single();
      if (error) throw new Error(error.message);

      if (data) setOffers((prev) => (prev.some((o) => o.id === data.id) ? prev : [...prev, data as Offer]));
      setOfferOpen(false);
      setOffer({ price: "", scope: "", timeline: "" });
      if (offerImage) URL.revokeObjectURL(offerImage.preview);
      setOfferImage(null);
      router.refresh();
    } catch (e: any) {
      setErr(e.message ?? "Could not send the offer.");
    }
    setBusy(false);
  }

  async function acceptOffer(id: string) {
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("accept_offer", { p_offer_id: id });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setOffers((prev) => prev.map((o) => (o.id === id ? { ...o, status: "accepted" } : o)));
    // A seller accepting an offer stays in the hub; a buyer goes to the
    // storefront order page.
    router.push(amSeller ? `/seller/orders` : `/orders/${row.id}`);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8.5rem)] max-w-2xl flex-col md:h-[calc(100vh-7.5rem)]">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-[var(--line)] pb-2.5">
        <Link href={basePath} className="rounded-lg p-1 text-ink-400 hover:text-ink-900" aria-label="Back">←</Link>
        <Avatar name={amSeller ? otherName : (shopName ?? otherName)} src={amSeller ? otherAvatar : shopLogo} size={34} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-bold text-ink-900">{amSeller ? otherName : (shopName ?? otherName)}</p>
          <p className="text-[11px] text-ink-400">{amSeller ? "Buyer" : "Seller"}</p>
        </div>
        {order && (
          <Link
            href={amSeller ? "/seller/orders" : `/orders/${order.id}`}
            className="ml-auto text-[11.5px] font-semibold text-brand-600"
          >
            View order →
          </Link>
        )}
      </div>

      {/* pinned order context */}
      {order && (
        <Link
          href={amSeller ? "/seller/orders" : `/orders/${order.id}`}
          className="mt-2 block rounded-xl border border-brand-500/20 bg-brand-50/70 px-3 py-2"
        >
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
          const seen = !!m.read_at;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[78%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                  mine ? "bg-brand-500 text-white" : "bg-white text-ink-900 shadow-card"
                } ${m.failed ? "opacity-60 ring-1 ring-red-400" : ""}`}
              >
                {m.image_url && (
                  <a href={m.image_url} target="_blank" rel="noreferrer" className="mb-1 block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.image_url} alt="" className="max-h-56 rounded-lg object-cover" />
                  </a>
                )}
                {m.body && <p className="whitespace-pre-line">{m.body}</p>}
                <p className={`mt-1 flex items-center gap-1 text-[10px] ${mine ? "justify-end text-white/60" : "text-ink-400"}`}>
                  {relTime(m.created_at)}
                  {m.pending && <span className="opacity-70">· sending…</span>}
                  {m.failed && <span className="text-red-200">· failed</span>}
                  {mine && !m.pending && !m.failed && <Ticks read={seen} />}
                </p>
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
            {o.image_url && (
              <a href={o.image_url} target="_blank" rel="noreferrer" className="mt-2 block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.image_url} alt="Offer attachment" className="max-h-44 w-full rounded-lg object-cover" />
              </a>
            )}
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

      {blocked && (
        <div
          role="alert"
          className="mb-2 rounded-xl border border-amber-500/30 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900"
        >
          <p className="font-semibold">Message not sent</p>
          <p className="mt-0.5">{blocked}</p>
        </div>
      )}

      {err && <p className="pb-1 text-[11.5px] font-medium text-red-600">{err}</p>}

      {/* image preview — confirm before it is sent (item 5) */}
      {pendingImage && (
        <div className="mb-2 rounded-xl border border-brand-500/30 bg-white p-3 shadow-card">
          <div className="flex items-center justify-between pb-2">
            <p className="text-[12.5px] font-bold text-ink-900">Send this photo?</p>
            <button type="button" onClick={cancelImage} className="text-[11.5px] font-semibold text-ink-400 hover:text-ink-700">
              Remove
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pendingImage.preview} alt="Preview" className="max-h-52 w-full rounded-lg object-cover" />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={confirmImage} disabled={uploading} className="nm-btn-primary flex-1 !py-2">
              {uploading ? <><Spinner /> Sending…</> : "Send photo"}
            </button>
            <button type="button" onClick={cancelImage} disabled={uploading} className="nm-btn-ghost !py-2">
              Cancel
            </button>
          </div>
        </div>
      )}

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

          {/* optional photo on the offer (item 7) */}
          {offerImage ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={offerImage.preview} alt="Offer attachment" className="max-h-36 w-full rounded-lg object-cover" />
              <button type="button" onClick={() => { URL.revokeObjectURL(offerImage.preview); setOfferImage(null); }}
                className="absolute right-2 top-2 rounded-full bg-ink-900/70 px-2 py-0.5 text-[10.5px] font-semibold text-white">
                Remove
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--line)] py-2 text-[11.5px] font-semibold text-ink-500 hover:border-brand-300 hover:text-brand-600">
              🖼️ Add a photo (optional)
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setOfferImage({ file: f, preview: URL.createObjectURL(f) });
                e.currentTarget.value = "";
              }} />
            </label>
          )}

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
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) stageImage(f); e.currentTarget.value = ""; }} />
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
