/**
 * The buyer support assistant ("Ask Support").
 *
 * ── What it is ────────────────────────────────────────────────────────
 * A buyer with a question — "where is my order?", "how does escrow work?",
 * "can I get a refund?" — should not have to find a WhatsApp number and
 * wait. This answers from two things only: the platform's own rules (the
 * same FAQ the Help page shows) and the buyer's OWN orders.
 *
 * ── Why it is scoped to one buyer ─────────────────────────────────────
 * This is the opposite of the admin copilot. The copilot reads the whole
 * platform with the service role; this reads through the normal session
 * client, so RLS applies and `auth.uid()` is the buyer. A buyer therefore
 * cannot see another buyer's order even if the model asks for it — the
 * database refuses, not the prompt. That is the property worth keeping:
 * the prompt is a convenience, the policy is the guarantee.
 *
 * ── Why it cannot change anything ─────────────────────────────────────
 * Same rule as the copilot. It explains and points at the right page; it
 * never cancels an order, raises a dispute or moves money. Those stay
 * buttons a human presses.
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { aiText, aiTry, clip } from "@/lib/ai";

/** One turn of the conversation, as the client sends it back. */
export type SupportTurn = { role: "user" | "assistant"; body: string };

export type SupportAnswer = {
  answer: string;
  /** True when the answer was built from the buyer's live orders. */
  usedOrders: boolean;
};

/**
 * The platform rules the assistant is allowed to state as fact.
 *
 * These mirror `src/app/(shop)/help/page.tsx`. They are duplicated rather
 * than imported because the Help page renders them as JSX copy and this
 * needs plain strings; keeping them adjacent in one file makes a drift
 * obvious in review.
 */
const RULES = [
  "Payment: NaijaMart holds the buyer's money in escrow. The seller is only paid after the buyer confirms the item arrived as described.",
  "Delivery: it depends on the seller and the city. Most sellers in the same city deliver within 1-3 days. The delivery fee and estimate are shown at checkout.",
  "Pickup: if a seller offers pickup, the buyer can collect from the shop and pays no delivery fee. The shop address and a map link appear on the listing, in the cart, at checkout and on the order page.",
  "Cross-city: a buyer can buy from a seller in another city. The home page defaults to the buyer's city but the location filter has an 'All cities' option.",
  "Becoming a seller: create an account, choose 'Sell on NaijaMart', and complete the four-step onboarding with a valid NIN or CAC number and bank details.",
  "Missing order: open the order and tap 'Raise an issue'. The money stays in escrow while support reviews it.",
  "Refunds: if an order is not delivered as described, the buyer raises an issue on the order and support decides. Money in escrow is returned to the buyer when the dispute is resolved in their favour.",
  "Contacting a human: the Help page has a WhatsApp link to NaijaMart support.",
];

/**
 * The buyer's own recent orders, read through RLS.
 *
 * Deliberately small: reference, status, total, shop and date. That is
 * enough to answer "where is my order" without pulling addresses or
 * payment details into a prompt.
 */
async function loadBuyerOrders(): Promise<
  { reference: string; status: string; total: number; shop: string | null; placed: string }[]
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("orders")
    .select("reference,status,total,created_at,shops(name)")
    .eq("buyer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  return (data ?? []).map((o: any) => ({
    reference: o.reference,
    status: o.status,
    total: Number(o.total ?? 0),
    shop: o.shops?.name ?? null,
    placed: o.created_at,
  }));
}

/**
 * Answer one question.
 *
 * Returns a plain sentence. If the model is unavailable the caller gets a
 * readable fallback rather than an exception — a support box that throws
 * is worse than one that says "try the Help page".
 */
export async function askSupport(
  question: string,
  history: SupportTurn[] = [],
): Promise<SupportAnswer> {
  const q = clip(question, 800);
  if (!q) {
    return { answer: "Ask me anything about your orders, delivery or payments.", usedOrders: false };
  }

  const orders = await loadBuyerOrders();
  const usedOrders = orders.length > 0;

  const orderBlock = usedOrders
    ? orders
        .map(
          (o) =>
            `- ${o.reference}: ${o.status}, ₦${o.total.toLocaleString("en-NG")}, from ${o.shop ?? "a seller"}, placed ${o.placed.slice(0, 10)}`,
        )
        .join("\n")
    : "This buyer has no orders yet.";

  const historyBlock = history.length
    ? `\nRecent conversation:\n${history
        .slice(-4)
        .map((h) => `${h.role}: ${h.body}`)
        .join("\n")}\n`
    : "";

  const answer = await aiTry(() =>
    aiText({
      fast: true,
      maxTokens: 400,
      prompt: `You are NaijaMart's buyer support assistant. You help a shopper in Nigeria understand their orders, delivery, pickup and payments.

Rules you may state as fact:
${RULES.map((r) => `- ${r}`).join("\n")}

This buyer's own recent orders (the ONLY orders you may discuss):
${orderBlock}
${historyBlock}
The buyer asks: "${q}"

Answer in 1-3 short sentences, warm and plain. Use naira amounts when you mention money. If the question is about a specific order, use the real status above — never invent one. If you do not know, say so and point them to the Help page or the order page. Never claim you have taken an action: you cannot cancel, refund, dispute or change anything. Do not use markdown headings or bullet lists.`,
    }),
  );

  if (!answer) {
    return {
      answer:
        "I could not reach the support assistant just now. Please try again in a moment, or open the Help page to message a human on WhatsApp.",
      usedOrders,
    };
  }

  return { answer: answer.trim(), usedOrders };
}
