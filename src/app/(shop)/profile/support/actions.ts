"use server";

/**
 * Server action for the buyer support assistant.
 *
 * ── Why a server action and not a route ───────────────────────────────
 * The AI key must never reach the browser, and the buyer's orders must be
 * read with their own session. A server action gives both: it runs on the
 * server, and `createClient()` inside `askSupport` reads the request
 * cookies, so RLS sees the signed-in buyer.
 *
 * ── Why it does not check the admin key ───────────────────────────────
 * Unlike `ai-actions.ts`, this is for buyers, not admins. It needs no
 * service role — the session client is the correct scope, and the AI key
 * is read server-side by `@/lib/ai`.
 */

import { askSupport, type SupportTurn } from "@/lib/ai-support";

export type SupportResult = {
  ok: boolean;
  answer?: string;
  usedOrders?: boolean;
  error?: string;
};

export async function askBuyerSupport(input: {
  question: string;
  history?: SupportTurn[];
}): Promise<SupportResult> {
  const question = (input.question ?? "").trim();
  if (!question) return { ok: false, error: "Type a question first." };

  try {
    const result = await askSupport(question, input.history ?? []);
    return { ok: true, answer: result.answer, usedOrders: result.usedOrders };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "The support assistant could not answer.";
    return { ok: false, error: message };
  }
}
