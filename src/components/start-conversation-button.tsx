"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";
import { fetchPlanDraft, openChatWithDraft } from "@/lib/offer-draft";
import { createClient } from "@/lib/supabase/client";
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
 *
 * ── Why the package ids are resolved here ──────────────────────────────
 * A cart line stores `listingId` + `packageTier`, not the `gig_packages.id`
 * — the cart is written before the package row is known to the client. But
 * the server needs the ids to rebuild the canonical plan text (sql/0027),
 * so they are looked up from the listing and tier first. Without this the
 * draft would have no ids, the server could not verify the prefix, and the
 * buyer's own plan message would be blocked again.
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
      const packageIds = await resolvePackageIds(shop);
      const draft = await fetchPlanDraft(packageIds);
      const href = await openChatWithDraft({ shopId: shop.shopId, draft, packageIds });
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

/**
 * Map each service line to its `gig_packages.id`.
 *
 * One query for the whole basket: the listing ids are collected, the
 * packages for those listings are fetched, and each line is matched on its
 * tier. A line whose tier is missing falls back to the listing's cheapest
 * package, which is what the gig page shows first.
 */
async function resolvePackageIds(shop: CartShop): Promise<string[]> {
  const serviceLines = shop.lines.filter((l) => l.isService);
  if (!serviceLines.length) return [];

  const listingIds = Array.from(new Set(serviceLines.map((l) => l.listingId)));
  const supabase = createClient();
  const { data, error } = await supabase
    .from("gig_packages")
    .select("id,listing_id,tier,price,sort_order")
    .in("listing_id", listingIds)
    .order("sort_order");
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as {
    id: string;
    listing_id: string;
    tier: string | null;
    price: number;
    sort_order: number | null;
  }[];

  const ids: string[] = [];
  for (const line of serviceLines) {
    const forListing = rows.filter((r) => r.listing_id === line.listingId);
    if (!forListing.length) continue;
    const wanted = (line.packageTier ?? "").toLowerCase();
    const match =
      forListing.find((r) => (r.tier ?? "").toLowerCase() === wanted) ?? forListing[0];
    if (match) ids.push(match.id);
  }
  return ids;
}
