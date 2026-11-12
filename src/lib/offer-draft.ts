import { createClient } from "@/lib/supabase/client";

/**
 * The "I want this plan" message a buyer sends instead of checking out.
 *
 * ── Why a message and not a cart line ─────────────────────────────
 * A service is not stock: nothing is shipped, nothing is picked up, and the
 * price is only real once the provider has agreed to the work. Putting a gig
 * straight into the cart let a buyer pay for a plan the provider had never
 * accepted. The flow is now a conversation that ends in a seller offer, so
 * the buyer's first move is to say which plan they want — in the form the
 * seller can price against.
 *
 * The body is composed here, not in the component, because the gig page and
 * the cart must produce the SAME message: a buyer who reached the plan from
 * the cart and a buyer who reached it from the listing should look identical
 * to the seller.
 *
 * ── Why it is only PRE-FILLED ─────────────────────────────────────
 * `openChatWithDraft` navigates to the thread with the text already in the
 * composer. Nothing is sent. The buyer can edit it, add a photo of their
 * brief, or delete it and type their own — and they press Send themselves.
 * An auto-sent message would be a stranger speaking in the buyer's name.
 */
export function composePlanMessage({
  title,
  packageName,
  price,
  features,
  deliveryDays,
}: {
  /** The gig's title, used as the headline when there is no plan name. */
  title?: string | null;
  /** "Basic" / "Standard" / "Premium". */
  packageName?: string | null;
  /** What the buyer pays — the discounted figure, not the list price. */
  price: number;
  features?: string[] | null;
  deliveryDays?: number | null;
}): string {
  const money = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  })
    .format(price)
    // Intl emits the naira glyph, but a fallback sans on an Android device
    // can render it as a box. "₦" is the same character, spelled directly.
    .replace(/^NGN\s?/, "₦");

  const lines: string[] = ["I want this plan", money];

  for (const f of features ?? []) {
    const clean = String(f ?? "").trim();
    if (clean) lines.push(`✓ ${clean}`);
  }

  if (deliveryDays != null) lines.push(`✓ ${deliveryDays}-day delivery`);

  const label = (packageName ?? "").trim() || (title ?? "").trim();
  if (label) lines.push(label);

  return lines.join("\n");
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
 */
export async function openChatWithDraft({
  shopId,
  draft,
  orderId,
}: {
  shopId: string;
  draft?: string | null;
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

  const q = draft ? `?draft=${encodeURIComponent(draft)}` : "";
  return `/chats/${chatId}${q}`;
}
