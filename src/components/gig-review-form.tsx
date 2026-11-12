"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";

/**
 * Leave a review on a gig.
 *
 * Only rendered when the buyer has a delivered order containing this gig
 * (the page decides that), so the form is never an invitation to review
 * something the buyer never received. The RPC re-checks the same facts —
 * the page is a convenience, the database is the authority.
 */
export function GigReviewForm({
  orderId,
  listingId,
  gigTitle,
}: {
  orderId: string;
  listingId: string;
  gigTitle: string;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      setErr("Pick a star rating first.");
      return;
    }
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("leave_gig_review", {
      p_order_id: orderId,
      p_listing_id: listingId,
      p_rating: rating,
      p_body: body.trim() || null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <Alert tone="green" title="Review posted">
        Thanks — your rating is now on {gigTitle}.
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="nm-card p-4">
      <h2 className="text-[14px] font-bold text-ink-900">Review this gig</h2>
      <p className="mt-0.5 text-[12px] text-ink-500">
        You bought {gigTitle}. How did it go?
      </p>

      <div className="mt-2.5 flex items-center gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            className="p-0.5"
          >
            <svg
              viewBox="0 0 24 24"
              className={cn(
                "h-7 w-7 transition",
                (hover || rating) >= n ? "text-amber-400" : "text-slate-200",
              )}
              fill="currentColor"
            >
              <path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9L12 2.6Z" />
            </svg>
          </button>
        ))}
      </div>

      <textarea
        rows={3}
        className="nm-input mt-2.5 resize-none"
        placeholder="What went well? What could be better?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      {err && <p className="mt-1.5 text-[12px] font-medium text-red-600">{err}</p>}

      <button type="submit" disabled={busy} className="nm-btn-primary mt-2.5 w-full !py-2.5">
        {busy ? <><Spinner /> Posting…</> : "Post review"}
      </button>
    </form>
  );
}
