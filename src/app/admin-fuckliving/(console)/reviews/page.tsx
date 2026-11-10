import { createAdminClient } from "@/lib/supabase/admin";
import { shortDate } from "@/lib/utils";
import { Card, Badge, EmptyState, Star } from "@/components/ui";
import { ReviewModeration } from "@/components/admin/review-moderation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

export default async function AdminReviewsPage() {
  const supabase = createAdminClient();
  // No FK to profiles exists for buyer_id (it points at auth.users), so the buyer
  // name is joined in memory from the public profile view.
  const { data: reviews } = await supabase
    .from("reviews")
    .select("id,rating,body,status,flagged,seller_reply,created_at,buyer_id,shops(name)")
    .order("created_at", { ascending: false });

  const list: any[] = (reviews ?? []) as any[];
  const buyerIds = Array.from(new Set(list.map((r: any) => r.buyer_id).filter(Boolean)));
  const { data: buyerRows } = buyerIds.length
    ? await supabase.from("profiles_public").select("id,full_name,avatar_url").in("id", buyerIds)
    : { data: [] as any[] };
  const buyers = new Map((buyerRows ?? []).map((b: any) => [b.id, b.full_name]));
  for (const r of list) r.profiles_public = { full_name: buyers.get(r.buyer_id) as string | undefined };
  const flagged = list.filter((r: any) => r.flagged || r.status === "hidden");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Reviews</h1>
        <p className="text-[12.5px] text-ink-500">{list.length} total · {flagged.length} flagged or hidden</p>
      </div>

      {flagged.length > 0 && (
        <Card className="border-amber-500/25 bg-amber-50/50 p-3">
          <p className="text-[13px] font-bold text-amber-900">Needs a look</p>
          <p className="mt-0.5 text-[12px] text-amber-900/80">
            Flagged reviews stay visible until you hide them. Hide abusive or fake reviews; leave honest bad ones up.
          </p>
        </Card>
      )}

      {list.length === 0 ? (
        <EmptyState icon="⭐" title="No reviews yet" body="Buyers review sellers after confirming delivery. Anything flagged lands here for a decision." />
      ) : (
        <div className="space-y-2.5">
          {list.map((r: any) => (
            <Card key={r.id} className="p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Star value={r.rating} />
                    <span className="text-[12px] font-semibold text-ink-900">{r.shops?.name}</span>
                    <Badge tone={r.status === "hidden" ? "red" : r.status === "published" ? "green" : "gray"}>{r.status}</Badge>
                    {r.flagged && <Badge tone="amber">flagged</Badge>}
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-400">
                    {r.profiles_public?.full_name ?? "Buyer"} · {shortDate(r.created_at)}
                  </p>
                </div>
                <ReviewModeration reviewId={r.id} status={r.status} flagged={!!r.flagged} />
              </div>
              {r.body && <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-700">{r.body}</p>}
              {r.seller_reply && (
                <p className="mt-1.5 rounded-lg bg-brand-50/70 px-2.5 py-1.5 text-[11.5px] text-brand-900">
                  <span className="font-semibold">Seller reply:</span> {r.seller_reply}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
