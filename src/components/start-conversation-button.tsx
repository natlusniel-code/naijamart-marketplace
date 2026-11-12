"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";
import { composePlanMessage, openChatWithDraft } from "@/lib/offer-draft";
import type { CartShop } from "@/lib/cart";

/**
 * "Start Conversation" — the cart's action for a basket of services.
 *
 * A gig in the cart cannot be checked out: nothing is shipped, and the price
 * is only agreed once the provider has answered. So the cart's job for a
 * service is to open the conversation with the plan already written out, the
 * same message the gig page's Continue produces. The buyer presses Send.
 *
 * A shop can hold more than one service line (Basic and Premium are separate
 * lines), so the draft lists each one under its own price rather than
 * pretending they are one plan.
 */
export function StartConversationButton({
  shop,
  signedIn,
  className = "nm-btn-primary w-full !py-2.5",
}: {
  shop: CartShop;
  signedIn: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    if (!signedIn) {
      router.push(`/signin?next=${encodeURIComponent("/cart")}`);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      // One line: the plan message for that line. Several lines: a short
      // list, so the provider sees every plan the buyer is asking about.
      const draft =
        shop.lines.length === 1
          ? composePlanMessage({
              title: shop.lines[0].title,
              packageName: tierLabel(shop.lines[0].title, shop.lines[0].packageTier),
              price: shop.lines[0].price,
            })
          : [
              "I want these plans",
              ...shop.lines.map(
                (l) =>
                  `• ${tierLabel(l.title, l.packageTier) ?? l.title} — ${nairaText(l.price)}`,
              ),
            ].join("\n");

      const href = await openChatWithDraft({ shopId: shop.shopId, draft });
      router.push(href);
    } catch (e: any) {
      setBusy(false);
      setErr(e?.message ?? "Could not open the chat.");
    }
  }

  return (
    <>
      <button type="button" onClick={go} disabled={busy} className={className}>
        {busy ? <Spinner /> : "Start Conversation"}
      </button>
      {err && <p className="mt-1.5 text-center text-[11.5px] font-medium text-red-600">{err}</p>}
    </>
  );
}

/** "Logo creation — Basic" → "Basic". Falls back to the whole title. */
function tierLabel(title: string, tier?: string | null): string | null {
  if (tier) return tier.charAt(0).toUpperCase() + tier.slice(1);
  const parts = title.split("—");
  return parts.length > 1 ? parts[parts.length - 1].trim() : title;
}

function nairaText(n: number) {
  return `₦${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(n)}`;
}
