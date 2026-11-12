import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { naira } from "@/lib/utils";
import { Stat, Card, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * One listing's analytics.
 *
 * Laid out like a video's analytics: the thing itself at the top so the
 * seller knows which listing they are looking at, then the numbers under it.
 * Without the image at the top, a seller with twelve similar gigs cannot
 * tell which page they opened.
 */
export default async function ListingAnalyticsPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/signin");
  if (!session.shop) redirect("/seller/onboarding");

  const supabase = createClient();

  const { data: listing } = await supabase
    .from("listings")
    .select("id,title,type,status,images,price,views,clicks,deliveries,shop_id,created_at")
    .eq("id", params.id)
    .maybeSingle();

  if (!listing || listing.shop_id !== session.shop.id) notFound();

  const { data: analytics } = await supabase.rpc("seller_analytics", { p_shop_id: session.shop.id });
  const row = ((Array.isArray(analytics) ? analytics : []) as any[]).find((r) => r.listing_id === params.id);

  const views = Number(row?.views ?? listing.views ?? 0);
  const clicks = Number(row?.clicks ?? listing.clicks ?? 0);
  const orders = Number(row?.orders ?? 0);
  const delivered = Number(row?.delivered ?? 0);
  const pending = Number(row?.pending ?? 0);
  const revenue = Number(row?.revenue ?? 0);
  const ctr = views > 0 ? Math.round((clicks / views) * 100) : 0;
  const conversion = clicks > 0 ? Math.round((orders / clicks) * 100) : 0;

  const image = (listing.images as string[] | null)?.[0] ?? null;

  return (
    <div className="space-y-4">
      <Link href="/seller/analytics" className="text-[12.5px] font-semibold text-brand-600">
        ← All analytics
      </Link>

      {/* the listing itself */}
      <Card className="overflow-hidden">
        <div className="relative h-40 w-full bg-slate-100">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-3xl">
              {listing.type === "service" ? "🛠️" : "📦"}
            </div>
          )}
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-[17px] font-extrabold tracking-tight text-ink-900">{listing.title}</h1>
              <p className="mt-0.5 text-[12px] text-ink-500">
                {listing.type === "service" ? "Service" : "Product"} · {naira(listing.price)}
              </p>
            </div>
            <Badge tone={listing.status === "live" ? "green" : "gray"}>{listing.status}</Badge>
          </div>
        </div>
      </Card>

      {/* the numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Views" value={String(views)} hint="times this page was opened" />
        <Stat label="Clicks" value={String(clicks)} hint={`${ctr}% of views`} tone="brand" />
        <Stat label="Orders" value={String(orders)} hint={`${conversion}% of clicks`} />
        <Stat label="Delivered" value={String(delivered)} hint={`${pending} pending`} tone="amber" />
      </div>

      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Revenue</p>
        <p className="mt-1 text-[24px] font-extrabold tracking-tight text-ink-900">{naira(revenue)}</p>
        <p className="mt-0.5 text-[11.5px] text-ink-500">From delivered orders on this listing.</p>
      </Card>

      {/* funnel — the same three numbers, read as a drop-off */}
      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Funnel</p>
        <div className="mt-2.5 space-y-2">
          {[
            { label: "Viewed", value: views, pct: 100 },
            { label: "Clicked", value: clicks, pct: views > 0 ? (clicks / views) * 100 : 0 },
            { label: "Ordered", value: orders, pct: views > 0 ? (orders / views) * 100 : 0 },
            { label: "Delivered", value: delivered, pct: views > 0 ? (delivered / views) * 100 : 0 },
          ].map((s) => (
            <div key={s.label}>
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="font-medium text-ink-600">{s.label}</span>
                <span className="font-bold text-ink-900">{s.value}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(2, s.pct)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
