import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { naira } from "@/lib/utils";
import { Stat, Card, Badge, EmptyState } from "@/components/ui";
import { SellerAiInsights } from "@/components/seller/seller-ai-insights";
import { SellerQualityCard } from "@/components/seller/seller-quality-card";
import { shopHasFeature, subscriptionState, upgradePath } from "@/lib/plan-gate";
import { getLatestQuality } from "@/lib/ai-quality";
import { getSellerInsights } from "@/lib/ai-seller-insights";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

/**
 * Per-listing analytics.
 *
 * ── Why one row per listing ───────────────────────────────────────────
 * A shop-level total tells a seller they are doing fine and nothing about
 * what to do next. The question they actually have is "which of my gigs is
 * working, and which is dead weight?" — and that can only be answered per
 * listing. So every gig and every product gets its own row, and the row
 * opens into its own page.
 *
 * ── Why the numbers come from one RPC ─────────────────────────────────
 * Views and clicks live on `listings`; orders, delivered and pending are
 * aggregates over `order_items`. Doing that join in the browser would mean
 * fetching every order line the shop has ever had. `seller_analytics`
 * (sql/0028) does it in one pass and returns a single JSON array.
 */
export default async function AnalyticsPage() {
  const session = await getSession();
  if (!session) redirect("/signin");
  if (!session.shop) redirect("/seller/onboarding");

  const supabase = createClient();
  const { data, error } = await supabase.rpc("seller_analytics", { p_shop_id: session.shop.id });
  const rows = (Array.isArray(data) ? data : []) as any[];

  const totals = rows.reduce(
    (acc, r) => ({
      views: acc.views + Number(r.views ?? 0),
      clicks: acc.clicks + Number(r.clicks ?? 0),
      orders: acc.orders + Number(r.orders ?? 0),
      delivered: acc.delivered + Number(r.delivered ?? 0),
      pending: acc.pending + Number(r.pending ?? 0),
      revenue: acc.revenue + Number(r.revenue ?? 0),
    }),
    { views: 0, clicks: 0, orders: 0, delivered: 0, pending: 0, revenue: 0 },
  );

  // Click-through is the one ratio that says whether a thumbnail is doing
  // its job: views without clicks means the card is not convincing.
  const ctr = totals.views > 0 ? Math.round((totals.clicks / totals.views) * 100) : 0;

  /*
    ── The AI half ──────────────────────────────────────────────────
    The existing per-listing table stays exactly as it is: it answers
    "what happened". The two blocks below answer "what should I do".

    Both are Premium features, so both are gated on
    `seller_has_feature` — a Basic seller sees an upgrade prompt instead
    of the content, and the data is not even fetched for them.
  */
  const isPremium = await shopHasFeature(session.shop.id, "aiInsights");
  const sub = subscriptionState(session.shop);

  const [insights, quality] = isPremium
    ? await Promise.all([getSellerInsights(session.shop.id), getLatestQuality(session.shop.id)])
    : [[], null];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[21px] font-extrabold tracking-tight text-ink-900">Analytics</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          How each gig and product is performing. Tap one to see its own numbers.
        </p>
      </div>

      {/* ── AI insights + quality (Premium) ─────────────────────────── */}
      {isPremium ? (
        <>
          <SellerAiInsights shopId={session.shop.id} insights={insights} />
          <SellerQualityCard shopId={session.shop.id} quality={quality} />
        </>
      ) : (
        <Card className="p-4">
          <div className="flex items-start gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-[15px]">
              ✨
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold text-ink-900">AI insights are a Premium feature</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
                Premium tells you which listing is losing you sales, what your trend means and what
                to fix this week — on top of the numbers below.
              </p>
              <Link
                href={upgradePath(sub)}
                className="nm-btn-primary mt-2.5 inline-flex !px-3.5 !py-2 !text-[12px]"
              >
                See Premium
              </Link>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <Card className="p-4">
          <p className="text-[12.5px] text-red-600">{error.message}</p>
        </Card>
      )}

      {/* profile performance */}
      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Profile performance</p>
        <div className="mt-2.5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total views" value={String(totals.views)} hint="across all listings" />
          <Stat label="Total clicks" value={String(totals.clicks)} hint={`${ctr}% click-through`} tone="brand" />
          <Stat label="Orders" value={String(totals.orders)} hint={`${totals.delivered} delivered`} />
          <Stat label="Revenue" value={naira(totals.revenue)} hint="from delivered orders" tone="amber" />
        </div>
      </Card>

      {/* per-listing list */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
          <p className="text-[14px] font-bold text-ink-900">Your listings</p>
          <span className="text-[11.5px] text-ink-400">{rows.length} total</span>
        </div>

        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="📊"
              title="No listings yet"
              body="Publish a gig or a product and its views, clicks and orders will show up here."
              action="Create a listing"
              href="/seller/listings/new"
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {rows.map((r) => {
              const rowCtr = Number(r.views) > 0 ? Math.round((Number(r.clicks) / Number(r.views)) * 100) : 0;
              return (
                <li key={r.listing_id}>
                  <Link
                    href={`/seller/analytics/${r.listing_id}`}
                    className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
                  >
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                      {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.image} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center text-lg">
                          {r.type === "service" ? "🛠️" : "📦"}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink-900">{r.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-500">
                        <span>{r.views} views</span>
                        <span>·</span>
                        <span>{r.clicks} clicks</span>
                        <span>·</span>
                        <span>{rowCtr}% CTR</span>
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-[13px] font-bold text-ink-900">{r.orders} orders</p>
                      <p className="text-[11px] text-ink-400">
                        {r.delivered} delivered{r.pending > 0 ? ` · ${r.pending} pending` : ""}
                      </p>
                    </div>

                    <Badge tone={r.status === "live" ? "green" : "gray"}>{r.status}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
