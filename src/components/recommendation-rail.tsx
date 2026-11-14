import Link from "next/link";
import { ListingCard } from "@/components/cards";
import { getRecommendations } from "@/lib/ai-recommendations";
import { getWishlistIds } from "@/lib/queries";

/**
 * "Picked for you" — the AI recommendation rail.
 *
 * ── Why it renders nothing when there is nothing ─────────────────────────
 * A rail that says "no recommendations yet" is worse than no rail: it
 * tells the buyer the site does not know them. So an empty result renders
 * nothing at all, and the storefront looks exactly as it did before.
 *
 * ── Why the reason is shown ──────────────────────────────────────────────
 * "Because you viewed a generator" is what makes a recommendation feel
 * like a recommendation rather than a random grid. The reason comes from
 * the model (or the deterministic fallback) and is always a real signal.
 */
export async function RecommendationRail({
  buyerId,
  cartIds = [],
  limit = 6,
}: {
  buyerId: string;
  cartIds?: string[];
  limit?: number;
}) {
  const [recs, savedIds] = await Promise.all([
    getRecommendations(buyerId, limit, cartIds),
    getWishlistIds(buyerId),
  ]);

  if (recs.length === 0) return null;
  const saved = new Set(savedIds);

  return (
    <section className="space-y-2.5">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-[15px] font-extrabold tracking-tight text-ink-900">
            <span aria-hidden>✨</span> Picked for you
          </h2>
          <p className="mt-0.5 text-[11.5px] text-ink-500">
            Based on what you have viewed, searched for and bought.
          </p>
        </div>
        <Link
          href="/search"
          className="shrink-0 text-[11.5px] font-semibold text-brand-600 hover:underline"
        >
          Browse all
        </Link>
      </div>

      <div className="nm-scroll -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
        {recs.map((r) => (
          <div key={r.listing.id} className="w-[168px] shrink-0">
            <ListingCard l={r.listing} saved={saved.has(r.listing.id)} signedIn />
            <p className="mt-1 line-clamp-2 px-0.5 text-[10.5px] leading-snug text-ink-500">
              {r.reason}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
