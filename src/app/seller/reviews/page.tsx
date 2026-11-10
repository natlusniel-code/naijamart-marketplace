import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { shortDate } from "@/lib/utils";
import { Card, EmptyState, Badge, Star } from "@/components/ui";
import { ReviewReply } from "@/components/seller/review-reply";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

export default async function SellerReviewsPage() {
  const session = await getSession();
  if (!session?.shop) redirect("/seller/onboarding");

  const supabase = createClient();
  const { data: reviews } = await supabase
    .from("reviews")
    .select("id,rating,body,seller_reply,created_at,flagged,buyer_id")
    .eq("shop_id", session.shop.id)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  const list: any[] = (reviews ?? []) as any[];
  const buyerIds = Array.from(new Set(list.map((r: any) => r.buyer_id).filter(Boolean)));
  const { data: buyerRows } = buyerIds.length
    ? await supabase.from("profiles_public").select("id,full_name")
    : { data: [] as any[] };
  const buyers = new Map((buyerRows ?? []).map((b: any) => [b.id, b.full_name]));
  for (const r of list) r.profiles_public = { full_name: buyers.get(r.buyer_id) as string | undefined };
  const avg = list.length ? list.reduce((n: number, r: any) => n + r.rating, 0) / list.length : 0;
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: list.filter((r: any) => r.rating === n).length }));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-[21px] font-extrabold tracking-tight text-ink-900">Reviews</h1>

      <Card className="p-4">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-[30px] font-extrabold leading-none tracking-tight text-ink-900">{avg ? avg.toFixed(1) : "—"}</p>
            <Star value={avg} className="mt-1 justify-center" />
            <p className="mt-1 text-[11px] text-ink-400">{list.length} review{list.length === 1 ? "" : "s"}</p>
          </div>
          <div className="flex-1 space-y-1">
            {dist.map((d) => (
              <div key={d.n} className="flex items-center gap-2">
                <span className="w-3 text-[10.5px] text-ink-400">{d.n}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${list.length ? (d.c / list.length) * 100 : 0}%` }} />
                </div>
                <span className="w-4 text-right text-[10.5px] text-ink-400">{d.c}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {list.length === 0 ? (
        <EmptyState
          icon="⭐"
          title="No reviews yet"
          body="Buyers can review you once they confirm delivery. Replying to reviews within a day visibly improves your ranking."
          action="View your orders"
          href="/seller/orders"
        />
      ) : (
        <div className="space-y-3">
          {list.map((r: any) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[12.5px] font-semibold text-ink-900">{r.profiles_public?.full_name ?? "Buyer"}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Star value={r.rating} />
                    <span className="text-[11px] text-ink-400">{shortDate(r.created_at)}</span>
                    {r.flagged && <Badge tone="amber">Flagged</Badge>}
                  </div>
                </div>
              </div>
              {r.body && <p className="mt-2 text-[13px] leading-relaxed text-ink-700">{r.body}</p>}
              {r.seller_reply ? (
                <div className="mt-2 rounded-xl bg-brand-50/70 px-3 py-2">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-brand-700">Your reply</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-brand-900">{r.seller_reply}</p>
                </div>
              ) : (
                <div className="mt-2">
                  <ReviewReply reviewId={r.id} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
