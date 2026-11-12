import { createClient } from "@/lib/supabase/client";

/**
 * The "I want this plan" message a buyer sends instead of checking out.
 *
 * ── Why a message and not a cart line ──────────────────────────────────
 * A service is not stock: nothing is shipped, nothing is picked up, and the
 * price is only real once the provider has agreed to the work. Putting a gig
 * straight into the cart let a buyer pay for a plan the provider had never
 * accepted. The flow is now a conversation that ends in a seller offer, so
 * the buyer's first move is to say which plan they want — in the form the
 * seller can price against.
 *
 * ── Why the SERVER composes the text ───────────────────────────────────
 * The chat guard refuses a message that contains a blocked word, and a
 * seller is free to name a plan feature "DM design pack", "IG post design"
 * or "WhatsApp sticker pack" — all ordinary service names, all caught by
 * the `dm` / `ig` / `snap` / `whatsapp` app rules. So the app was blocking
 * its own message: the buyer pressed Send on the plan the app had just
 * written and got "Message not sent".
 *
 * The fix is not a client-side "skip the check" flag — anyone could set
 * that and then type a phone number. Instead `nm_plan_draft()` builds the
 * text in Postgres, and `send_chat_message()` exempts a message only when
 * it starts with that exact server-built string. The buyer cannot forge
 * the prefix because they do not choose it, and anything they append after
 * it is still checked.
 *
 * That is why this file no longer formats the message itself: if the client
 * built the text and the server re-derived it, one stray space would break
 * the prefix match and re-block the message — the same bug, one layer down.
 */

/**
 * Ask the server for the canonical plan text.
 *
 * Returns the exact bytes `send_chat_message()` will compare against, so
 * the composer shows the buyer precisely what will be exempt.
 */
export async function fetchPlanDraft(packageIds: string[]): Promise<string> {
  if (!packageIds.length) return "";
  const supabase = createClient();
  const { data, error } = await supabase.rpc("nm_plan_draft", {
    p_package_ids: packageIds,
  });
  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : "";
}

/**
 * Open (or create) the buyer↔seller thread and hand it the draft.
 *
 * The draft travels in the URL as a query param rather than in storage:
 * localStorage would leak the text into the next thread the buyer opens, and
 * a React context cannot cross a route navigation. The thread reads it once,
 * seeds the composer, and the param is dropped from the address bar so a
 * refresh (or a shared link) does not resurrect a message the buyer already
 * sent or deleted.
 *
 * The package ids travel with it. They are what lets the server rebuild the
 * canonical text at send time and decide whether the message is the app's
 * own plan — the ids are not a secret, and they grant nothing: the server
 * still checks that the message starts with the text those ids produce.
 */
export async function openChatWithDraft({
  shopId,
  draft,
  packageIds,
  orderId,
}: {
  shopId: string;
  draft?: string | null;
  /** The gig package(s) the draft was built from. */
  packageIds?: string[] | null;
  orderId?: string | null;
}): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("start_chat", {
    p_shop_id: shopId,
    p_order_id: orderId ?? null,
  });
  if (error) throw new Error(error.message);

  const chatId = Array.isArray(data) ? data[0] : data;
  if (!chatId) throw new Error("Could not open the chat. Please try again.");

  const params = new URLSearchParams();
  if (draft) params.set("draft", draft);
  if (packageIds?.length) params.set("pkgs", packageIds.join(","));

  const q = params.toString() ? `?${params.toString()}` : "";
  return `/chats/${chatId}${q}`;
}
