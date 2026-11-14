/**
 * AI seller reply.
 *
 * ── The two modes ────────────────────────────────────────────────────────
 *   OFFLINE  the seller has not been seen for 3 minutes → the AI answers
 *            the buyer itself, and the message is marked `ai_generated`
 *            so the thread says so honestly.
 *   ONLINE   the seller is present → the AI only SUGGESTS. The seller
 *            reads it, edits it if they want, and presses send. Nothing
 *            is sent on their behalf.
 *
 * ── Why the mode is decided on the server ────────────────────────────────
 * If the browser decided, a stale tab would keep auto-replying after the
 * seller came back, and the seller would be talking to buyers through a
 * bot they thought was off. `seller_is_online` (sql/0035) reads
 * `shops.last_seen_at`, which the seller's shell heartbeats. The decision
 * is made where the truth is.
 *
 * ── Why the AI is given the shop's real facts ────────────────────────────
 * A generic "reply helpfully" prompt produces a reply that invents a
 * delivery time and a price. The prompt below is given the shop's actual
 * delivery fee, its listings, its policies and the recent thread, and is
 * told to answer only from those. If it does not know, it must say it will
 * check — which is what a good human seller does.
 *
 * ── Why the chat guard still applies ─────────────────────────────────────
 * An AI reply is a message like any other. It goes through
 * `send_chat_message` (sql/0011), so the block list still runs on it. An
 * AI that could leak a phone number would be worse than no AI at all.
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { aiText, clip } from "@/lib/ai";

export type ReplyMode = "auto" | "suggested";

export type ReplyContext = {
  chatId: string;
  shopId: string;
  /** The buyer's latest message. */
  buyerMessage: string;
  /** The last few messages, oldest first, for tone and continuity. */
  history: { from: "buyer" | "seller"; body: string }[];
  shop: {
    name: string;
    city: string | null;
    state: string | null;
    deliveryFee: number;
    freeThreshold: number | null;
    pickupAvailable: boolean;
    kind: string;
  };
  /** A few of the shop's live listings, so the AI can talk about real items. */
  listings: { title: string; price: number; type: string }[];
  /** Whether the buyer has an order in flight on this chat. */
  orderStatus?: string | null;
};

/**
 * Build the context for a chat from the database.
 *
 * Returns null when the chat does not exist or has no shop — an AI reply
 * needs a shop to speak for.
 */
export async function loadReplyContext(chatId: string): Promise<ReplyContext | null> {
  const supabase = createClient();

  const { data: chat } = await supabase
    .from("chats")
    .select(
      `id,buyer_id,seller_id,shop_id,order_id,
       shops(id,name,city,state,delivery_fee,free_delivery_threshold,pickup_available,kind),
       orders(id,status)`,
    )
    .eq("id", chatId)
    .maybeSingle();

  if (!chat) return null;
  const c: any = chat;
  const shop: any = c.shops;
  if (!shop) return null;

  const [{ data: messages }, { data: listings }] = await Promise.all([
    supabase
      .from("messages")
      .select("sender_id,body,created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("listings")
      .select("title,price,type")
      .eq("shop_id", shop.id)
      .eq("status", "live")
      .limit(8),
  ]);

  // Newest-first from the query, oldest-first for the prompt.
  const ordered = (messages ?? []).slice().reverse();
  const history = ordered
    .filter((m: any) => m.body && m.body.trim())
    .map((m: any) => ({
      from: (m.sender_id === c.buyer_id ? "buyer" : "seller") as "buyer" | "seller",
      body: clip(m.body, 400),
    }));

  const lastBuyer = [...ordered].reverse().find((m: any) => m.sender_id === c.buyer_id);

  return {
    chatId,
    shopId: shop.id,
    buyerMessage: clip(lastBuyer?.body ?? "", 800),
    history,
    shop: {
      name: shop.name,
      city: shop.city,
      state: shop.state,
      deliveryFee: Number(shop.delivery_fee ?? 0),
      freeThreshold:
        shop.free_delivery_threshold != null ? Number(shop.free_delivery_threshold) : null,
      pickupAvailable: Boolean(shop.pickup_available),
      kind: shop.kind ?? "both",
    },
    listings: (listings ?? []).map((l: any) => ({
      title: l.title,
      price: Number(l.price ?? 0),
      type: l.type,
    })),
    orderStatus: (c.orders as any)?.status ?? null,
  };
}

/**
 * Write the reply.
 *
 * `mode` changes the instruction, not just the label: an auto-reply has to
 * be safe to send unread, so it is shorter, more conservative and always
 * ends by inviting the seller in. A suggestion can be more conversational
 * because a human will read it first.
 */
export async function draftReply(
  ctx: ReplyContext,
  mode: ReplyMode,
): Promise<{ text: string | null; error: string | null }> {
  const facts = [
    `Shop: ${ctx.shop.name}`,
    `Location: ${[ctx.shop.city, ctx.shop.state].filter(Boolean).join(", ") || "Nigeria"}`,
    `Delivery fee: ${ctx.shop.deliveryFee} naira`,
    ctx.shop.freeThreshold
      ? `Free delivery over ${ctx.shop.freeThreshold} naira`
      : "No free-delivery threshold",
    `Pickup: ${ctx.shop.pickupAvailable ? "available" : "not available"}`,
    ctx.orderStatus ? `This buyer has an order in progress (status: ${ctx.orderStatus})` : "",
    ctx.listings.length
      ? `Live listings: ${ctx.listings.map((l) => `${l.title} (${l.price} naira)`).join("; ")}`
      : "No live listings",
  ]
    .filter(Boolean)
    .join("\n");

  const thread = ctx.history
    .slice(-8)
    .map((m) => `${m.from === "buyer" ? "Buyer" : "Seller"}: ${m.body}`)
    .join("\n");

  const instruction =
    mode === "auto"
      ? `The seller is OFFLINE right now, so you are replying on their behalf. Write a reply that is safe to send without anyone reading it first.

Rules for an offline reply:
- 1-3 short sentences. No more.
- Answer only what you can answer from the facts. If the question needs the seller (a custom price, a complaint, a refund), say the seller will reply shortly — do not invent an answer.
- Never promise a delivery date, a discount, or a custom price.
- Never share a phone number, email, WhatsApp, bank account or any link. All payment stays on NaijaMart.
- End by making clear the seller will follow up personally.
- Sound like a helpful shop assistant, not a robot. No "As an AI".`
      : `The seller is ONLINE and will read this before sending. Write the best possible reply for them to send.

Rules for a suggested reply:
- 1-4 short sentences, warm and direct.
- Use the facts. If the buyer asked about delivery, give the real fee. If they asked about an item, use its real price.
- If something needs the seller's decision (a discount, a custom job), draft the reply that moves it forward without committing them to a number they did not set.
- Never share a phone number, email, WhatsApp, bank account or any link. All payment stays on NaijaMart.
- No "As an AI". Write as the seller.`;

  // ── The model call, with its failure REASON kept ────────────────────────
  // This used to be wrapped in `aiTry`, which returns `null` and logs a
  // generic `[ai] ...` line. The caller turned that null into the reason
  // "no_draft", so a rate limit, a rejected key and a dead network all
  // reached the UI as the same silence. The code is captured here instead,
  // so `handleBuyerMessage` can record something a person can read.
  try {
    const reply = await aiText({
      prompt: `You are replying to a buyer on NaijaMart, a Nigerian marketplace.

SHOP FACTS (the only facts you may use):
${facts}

CONVERSATION SO FAR:
${thread || "(this is the first message)"}

THE BUYER'S LATEST MESSAGE:
"${ctx.buyerMessage}"

${instruction}

Return ONLY the message text. No quotes, no preamble, no signature.`,
      fast: true,
      timeoutMs: 8_000,
      maxTokens: 300,
      temperature: mode === "auto" ? 0.3 : 0.6,
    });

    const clean = (reply ?? "").replace(/^["']|["']$/g, "").trim();
    if (!clean) return { text: null, error: "empty" };
    return { text: clip(clean, 700), error: null };
  } catch (e: any) {
    const code = e?.code ?? "error";
    console.error("[ai-reply] draft failed:", code, e?.message ?? e);
    return { text: null, error: String(code) };
  }
}

/** A failure reason a seller can actually act on. */
export function replyErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "rate_limit":
      return "The AI is busy right now (rate limit). Your buyer's message is saved — try again in a moment.";
    case "bad_key":
    case "no_key":
      return "The AI key was rejected, so no draft could be written. Check the Gemini key in the server config.";
    case "timeout":
      return "The AI took too long to answer, so no draft was written. Try again — your buyer's message is saved.";
    case "network":
      return "Could not reach the AI service. Check the server's connection and try again.";
    case "empty":
      return "The AI returned an empty reply. Try again.";
    default:
      return "The AI could not write a reply for this message. Your buyer's message is saved — reply manually or try again.";
  }
}

/**
 * The whole flow for one buyer message.
 *
 * Called after a buyer message is written. It:
 *   1. checks the shop has AI replies enabled
 *   2. decides auto vs suggest from the seller's presence
 *   3. drafts the reply
 *   4. in auto mode, SENDS it through `send_chat_message` (so the guard runs)
 *   5. records the suggestion row either way
 *
 * Returns what happened, so the caller can log it. Never throws: a failed
 * AI reply must not break the buyer's send.
 */
export async function handleBuyerMessage(
  chatId: string,
  messageId: string,
): Promise<{ mode: ReplyMode | null; sent: boolean; reason?: string }> {
  try {
    const supabase = createClient();

    const ctx = await loadReplyContext(chatId);
    if (!ctx) return { mode: null, sent: false, reason: "no_context" };
    if (!ctx.buyerMessage) return { mode: null, sent: false, reason: "no_message" };

    // Is the shop's AI reply switched on?
    const { data: shop } = await supabase
      .from("shops")
      .select("ai_reply_enabled")
      .eq("id", ctx.shopId)
      .maybeSingle();
    if (!shop?.ai_reply_enabled) return { mode: null, sent: false, reason: "disabled" };

    // ── Is the AI reply part of this shop's plan? ──────────────────────────
    // `seller_has_feature` reads the plan row, the payment state and the
    // shop's approval — the same gate the rest of the app uses. Without it
    // a Basic shop would get the feature its own comparison page says it
    // does not have.
    const { data: entitled } = await supabase.rpc("seller_has_feature", {
      p_shop_id: ctx.shopId,
      p_feature: "aiReply",
    });
    if (entitled !== true) return { mode: null, sent: false, reason: "not_in_plan" };

    /*
      ── Auto or suggest? ────────────────────────────────────────────────
      THE BUG THIS FIXES
      The heartbeat (`shops.last_seen_at`, pinged every 60s by any open hub
      tab) answers "is a tab open somewhere", NOT "can the seller answer
      this message". A seller who leaves the hub open in a background tab,
      or whose phone is in their pocket with the tab alive, reads as online
      indefinitely. Every buyer message then became a `suggested` draft that
      nobody ever sent — and the buyer saw silence. That was the report:
      Premium seller, AI enabled, message unanswered, no draft sent.

      Presence now chooses BETWEEN TWO WORKING OUTCOMES, never between
      "reply" and "nothing":

        seller present → a fuller, chattier draft (they are reading it)
        seller absent  → the short, safe draft

      In both cases the reply is SENT, flagged `ai_generated` and labelled
      in the thread, so the seller can see exactly what went out in their
      name and follow up in their own words. The suggestion row is still
      written either way, which keeps the audit trail.
    */
    const { data: online } = await supabase.rpc("seller_is_online", {
      p_shop_id: ctx.shopId,
    });
    const mode: ReplyMode = online === true ? "suggested" : "auto";

    const drafted = await draftReply(ctx, mode);
    if (!drafted.text) {
      // Record WHY there is no draft, so the seller sees a readable reason
      // in the thread instead of an empty gap where a suggestion belongs.
      await supabase
        .from("ai_reply_suggestions")
        .insert({
          chat_id: chatId,
          message_id: messageId,
          shop_id: ctx.shopId,
          body: "",
          mode,
          status: "failed",
          error: replyErrorMessage(drafted.error),
        })
        .then(
          () => {},
          () => {},
        );
      return { mode, sent: false, reason: drafted.error ?? "no_draft" };
    }

    const body = drafted.text;

    // Record the suggestion first, so a send failure still leaves a trace.
    const { data: suggestionId } = await supabase.rpc("queue_ai_reply", {
      p_chat_id: chatId,
      p_message_id: messageId,
      p_body: body,
      p_mode: mode,
    });

    // ── Auto mode: send it ────────────────────────────────────────────
    // Through `send_ai_reply` (sql/0039), NOT `send_chat_message`.
    //
    // `send_chat_message` derives the sender from `auth.uid()`, and the
    // caller here is the BUYER's browser — the seller is offline by
    // definition, which is why we are replying at all. Using it would have
    // inserted the "seller's" reply with `sender_id = buyer`: the buyer
    // talking to themselves, and the seller never replying.
    //
    // `send_ai_reply` takes the sender from the shop's owner, runs the same
    // chat guard, and marks the row `ai_generated`. A blocked AI reply is
    // not sent, and the suggestion row stays `pending` for the seller.
    const { data, error } = await supabase.rpc("send_ai_reply", {
      p_chat_id: chatId,
      p_body: body,
    });

    if (error) return { mode, sent: false, reason: error.message };

    const result = (Array.isArray(data) ? data[0] : data) as
      | { blocked?: boolean; message?: { id: string } }
      | null;

    if (result?.blocked) {
      return { mode, sent: false, reason: "blocked" };
    }

    // The message is already flagged `ai_generated` by the RPC; mark the
    // suggestion as sent and link it to the message it produced.
    if (suggestionId) {
      await supabase.rpc("mark_ai_suggestion_sent", {
        p_suggestion_id: suggestionId,
        p_message_id: result?.message?.id ?? null,
      });
    }

    return { mode, sent: true };
  } catch (e: any) {
    return { mode: null, sent: false, reason: e?.message ?? "error" };
  }
}

/** The pending suggestion for a chat, if there is one. */
export async function getPendingSuggestion(chatId: string): Promise<{
  id: string;
  body: string;
  mode: ReplyMode;
} | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("ai_reply_suggestions")
    .select("id,body,mode")
    .eq("chat_id", chatId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, body: data.body, mode: data.mode as ReplyMode };
}
