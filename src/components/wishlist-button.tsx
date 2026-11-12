"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Heart toggle for a single listing.
 *
 * Three variants because the places it appears have different constraints:
 *
 *   `overlay` — sits on top of a card image. It must not be a link (the whole
 *   card is already an <a>), so it is a <button> with stopPropagation.
 *
 *   `inline` — a full-width button on the listing page, next to "Add to cart".
 *
 *   `plain` — a small bordered circle for list rows on the wishlist page.
 *
 * The write is optimistic: the heart fills immediately and rolls back if the
 * request fails. A wishlist is a low-stakes action, and waiting 300ms for a
 * round trip to fill a heart feels broken.
 */
export function WishlistButton({
  listingId,
  saved: initialSaved,
  signedIn,
  variant = "overlay",
  className,
}: {
  listingId: string;
  saved: boolean;
  signedIn: boolean;
  variant?: "overlay" | "inline" | "plain";
  className?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!signedIn) {
      router.push(`/signin?next=${encodeURIComponent(`/listing/${listingId}`)}`);
      return;
    }
    if (busy) return;

    const next = !saved;
    setSaved(next);
    setBusy(true);

    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;

    if (!uid) {
      setSaved(!next);
      setBusy(false);
      router.push(`/signin?next=${encodeURIComponent(`/listing/${listingId}`)}`);
      return;
    }

    const { error } = next
      ? await supabase.from("wishlists").insert({ user_id: uid, listing_id: listingId })
      : await supabase.from("wishlists").delete().eq("user_id", uid).eq("listing_id", listingId);

    setBusy(false);

    if (error) {
      // 23505 = already saved (a double tap raced us). The end state is what
      // the user wanted, so keep the filled heart rather than flipping back.
      if (error.code !== "23505") {
        setSaved(!next);
        return;
      }
    }
    startTransition(() => router.refresh());
  }

  const heart = (
    <svg
      viewBox="0 0 24 24"
      className={cn(variant === "overlay" ? "h-4 w-4" : "h-[18px] w-[18px]")}
      fill={saved ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20.5s-7.5-4.6-7.5-9.6a4.4 4.4 0 0 1 7.5-3.1 4.4 4.4 0 0 1 7.5 3.1c0 5-7.5 9.6-7.5 9.6Z" />
    </svg>
  );

  if (variant === "plain") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-white transition hover:bg-slate-50",
          saved ? "text-red-500" : "text-ink-400 hover:text-red-500",
          className,
        )}
      >
        {heart}
      </button>
    );
  }

  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
        className={cn(
          "nm-btn-ghost w-full !py-2.5",
          saved && "!border-red-200 !bg-red-50 !text-red-600",
          className,
        )}
      >
        {heart}
        {saved ? "Saved" : "Save"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
      className={cn(
        "absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/95 shadow-sm transition hover:scale-105",
        saved ? "text-red-500" : "text-ink-500 hover:text-red-500",
        className,
      )}
    >
      {heart}
    </button>
  );
}
