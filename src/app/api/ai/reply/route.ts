import { NextResponse } from "next/server";
import { getSession, createClient } from "@/lib/supabase/server";
import { handleBuyerMessage } from "@/lib/ai-reply";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/ai/reply
 *
 * Called by the chat thread right after a BUYER message is saved.
 *
 * ── Why the buyer triggers it and not the seller ─────────────────────────
 * The seller may be asleep. The whole point is that the reply happens when
 * the seller is not there, so the trigger has to be the buyer's message.
 *
 * ── Why it does not block the buyer's send ───────────────────────────────
 * The message is already written to the database before this is called, so
 * the buyer sees their bubble immediately whatever happens here. This
 * endpoint returns quickly (auto mode sends; suggest mode just stores a
 * draft) and its failure is invisible to the buyer, which is correct — a
 * broken AI must not look like a broken chat.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
    }

    const body = await request.json();
    const chatId = String(body?.chatId ?? "");
    const messageId = String(body?.messageId ?? "");

    if (!chatId || !messageId) {
      return NextResponse.json(
        { ok: false, error: "chatId and messageId are required." },
        { status: 400 },
      );
    }

    /*
      ── Authorisation ────────────────────────────────────────────────
      This endpoint makes the AI speak AS THE SELLER, so it must not be
      callable by anyone who happens to know a chat id. Two checks:

        1. the caller is a party to the chat, and
        2. the message they claim to be replying to is really in that chat
           and really came from the buyer.

      Without (2), a seller could pass their own message id and have the AI
      answer themselves; without (1), any signed-in user could inject an AI
      reply into a stranger's conversation.
    */
    const supabase = createClient();
    const { data: chat } = await supabase
      .from("chats")
      .select("id,buyer_id,seller_id")
      .eq("id", chatId)
      .maybeSingle();

    if (!chat) {
      return NextResponse.json({ ok: false, error: "Chat not found." }, { status: 404 });
    }
    if (chat.buyer_id !== session.user.id && chat.seller_id !== session.user.id) {
      return NextResponse.json({ ok: false, error: "This chat is not yours." }, { status: 403 });
    }

    const { data: msg } = await supabase
      .from("messages")
      .select("id,chat_id,sender_id")
      .eq("id", messageId)
      .maybeSingle();

    if (!msg || msg.chat_id !== chatId) {
      return NextResponse.json({ ok: false, error: "Message not found." }, { status: 404 });
    }
    if (msg.sender_id !== chat.buyer_id) {
      // Only a buyer message should wake the AI. A seller's own message
      // must never trigger a reply to itself.
      return NextResponse.json({ ok: true, mode: null, sent: false, reason: "not_buyer" });
    }

    // One AI reply per buyer message, and a ceiling per chat per minute, so
    // a rapid-fire buyer cannot run up the model bill.
    const rl = rateLimit(`reply:${chatId}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json({ ok: true, mode: null, sent: false, reason: "rate_limited" });
    }

    const result = await handleBuyerMessage(chatId, messageId);
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      sent: result.sent,
      reason: result.reason ?? null,
    });
  } catch (e: any) {
    // Never surface an AI failure as a chat failure.
    return NextResponse.json({ ok: true, mode: null, sent: false });
  }
}
