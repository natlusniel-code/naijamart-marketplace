"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * A listing card link that records the click.
 *
 * `track_listing_click()` has existed since 0028 and was never called, so
 * `listings.clicks` stayed at 0 for every seller — the analytics page showed
 * "0 clicks" on gigs buyers were opening every day.
 *
 * The click is fired and forgotten: navigation must not wait on a statistic,
 * and a failed counter must never stop the buyer reaching the listing. The
 * RPC is `security definer` and granted to anon, so a signed-out visitor
 * counts too.
 */
export function TrackedListingLink({
  listingId,
  href,
  className,
  children,
}: {
  listingId: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  function track() {
    try {
      void createClient()
        .rpc("track_listing_click", { p_listing_id: listingId })
        .then(() => {}, () => {});
    } catch {
      // Never let analytics break navigation.
    }
  }

  return (
    <Link href={href} className={className} onClick={track}>
      {children}
    </Link>
  );
}
