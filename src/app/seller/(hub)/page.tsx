import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { naira, ORDER_STATUS, shortDate, cn } from "@/lib/utils";
import { Stat, Badge, Card, EmptyState } from "@/components/ui";
import { SalesChart } from "@/components/seller/sales-chart";

export const dynamic = "force-dynamic";
export const metadata = { title: "Seller dashboard" };

export default async function SellerDashboard() {
  const session = await getSession();
  if (!session) redirect("/signin");
  if (!session.shop) redirect("/seller/onboarding");

  const shop = session.shop;
  const supabase = createClient();

  const [{ data: orders }, { data: payouts }, { data: messages }] = await Promise.all([
    supabase
      .from("orders")
      .select(`id,reference,status,total,commission_amount,payout_amount,payout_status,created_at,fulfilment,buyer_id`)
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase.from("payouts").select("amount,status,created_at,available_at,requested_at").eq("shop_id", shop.id),
    supabase.from("chats").select("id").eq("seller_id", session.user.id),
  ]);

  const list = orders ?? [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const revenueMonth = list
    .filter((o: any) => new Date(o.created_at) >= monthStart && !["cancelled", "pending_payment"].includes(o.status))
    .reduce((n: number, o: any) => n + Number(o.payout_amount), 0);

  const newOrders = list.filter((o: any) => o.status === "paid").length;
  const inProgress = list.filter((o: any) => ["accepted", "processing", "shipped", "ready_for_pickup"].includes(o.status)).length;
  const pendingPayout = (payouts ?? [])
    .filter((p: any) => p.status === "queued")
    .reduce((n: number, p: any) => n + Number(p.amount), 0);

  const needsAction = list.filter((o: any) => o.status === "paid");
  const awaitingShip = list.filter((o: any) => ["accepted", "processing"].includes(o.status));
  const awaitingConfirm = list.filter((o: any) => ["shipped", "ready_for_pickup"].includes(o.status));

  // 30-day sales series
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return { date: d, label: `${d.getDate()}/${d.getMonth() + 1}`, value: 0 };
  });
  list.forEach((o: any) => {
    if (["cancelled", "pending_payment"].includes(o.status)) return;
    const od = new Date(o.created_at);
    const slot = days.find((d) => d.date.toDateString() === od.toDateString());
    if (slot) slot.value += Number(o.payout_amount);
  });

  const subActive = shop.subscription_status === "active" && shop.subscription_expires_at;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[21px] font-extrabold tracking-tight text-ink-900">{shop.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-500">
            <span>{shop.city}, {shop.state}</span>
            <span>·</span>
            <Badge tone={shop.status === "approved" ? "green" : shop.status === "pending" ? "amber" : "red"}>
              {shop.status === "approved" ? "Live" : shop.status}
            </Badge>
            {shop.verified && <Badge tone="green">Verified</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={subActive ? "green" : "red"} dot>
            {subActive ? `Active · renews ${shortDate(shop.subscription_expires_at)}` : "Subscription inactive"}
          </Badge>
          {/* The switch back to the storefront. Sellers land here after signing
              in, so this is the way out to the public marketplace and to their
              own public shop page. */}
          <Link href="/" className="nm-btn-ghost !px-3 !py-1.5 !text-[12.5px]">
            ← Storefront
          </Link>
          <Link href={`/shop/${shop.slug}`} className="nm-btn-primary !px-3 !py-1.5 !text-[12.5px]">
            View my shop ↗
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue this month" value={naira(revenueMonth)} hint="after 5% commission" tone="brand" />
        <Stat label="Orders" value={String(newOrders + inProgress)} hint={`${newOrders} new · ${inProgress} in progress`} />
        <Stat label="Pending payout" value={naira(pendingPayout)} hint="releases 4 days after delivery" tone="amber" />
        <Stat label="Shop rating" value={shop.verified ? "—" : "—"} hint="from buyer reviews" />
      </div>

      {/* action needed */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-bold text-ink-900">Action needed</p>
          <Link href="/seller/orders" className="text-[12.5px] font-semibold text-brand-600">All orders →</Link>
        </div>
        {needsAction.length + awaitingShip.length + awaitingConfirm.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-ink-500">
            Nothing waiting on you. New paid orders will appear here immediately — you have 24 hours to accept.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {needsAction.slice(0, 3).map((o: any) => (
              <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-[11.5px] text-ink-500">{o.reference}</p>
                  <p className="text-[12.5px] text-ink-700">Accept or decline — clock is running</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[12.5px] font-bold">{naira(o.total)}</span>
                  <Link href="/seller/orders?tab=new" className="nm-btn-primary !px-2.5 !py-1.5 !text-[11.5px]">Open</Link>
                </div>
              </li>
            ))}
            {awaitingShip.slice(0, 2).map((o: any) => (
              <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-[11.5px] text-ink-500">{o.reference}</p>
                  <p className="text-[12.5px] text-ink-700">Mark as shipped once it leaves you</p>
                </div>
                <Link href="/seller/orders?tab=processing" className="nm-btn-ghost !px-2.5 !py-1.5 !text-[11.5px]">Open</Link>
              </li>
            ))}
            {awaitingConfirm.slice(0, 2).map((o: any) => (
              <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-[11.5px] text-ink-500">{o.reference}</p>
                  <p className="text-[12.5px] text-ink-700">Waiting for buyer to confirm receipt</p>
                </div>
                <Badge tone="violet">In transit</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        {/* chart */}
        <Card className="p-4">
          <p className="text-[14px] font-bold text-ink-900">Sales · last 30 days</p>
          <SalesChart data={days.map((d) => ({ label: d.label, value: d.value }))} />
        </Card>

        {/* payout ledger */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-bold text-ink-900">Payout ledger</p>
            <Link href="/seller/payouts" className="text-[12.5px] font-semibold text-brand-600">Open →</Link>
          </div>
          {list.filter((o: any) => o.payout_status !== "held").length === 0 ? (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
              No releases yet. Each order shows gross, the 5% commission and your net once the buyer confirms.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--line)]">
              {list.filter((o: any) => o.payout_status !== "held").slice(0, 5).map((o: any) => (
                <li key={o.id} className="py-1.5">
                  <div className="flex justify-between text-[12px]">
                    <span className="font-mono text-ink-400">{o.reference}</span>
                    <span className="font-bold text-ink-900">{naira(o.payout_amount)}</span>
                  </div>
                  <p className="text-[11px] text-ink-400">
                    gross {naira(o.total)} − {naira(o.commission_amount)} commission ·{" "}
                    <span className={o.payout_status === "paid" ? "text-brand-600" : "text-amber-600"}>{o.payout_status}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* subscription banner */}
      {!subActive && (
        <Card className="border-brand-500/25 bg-brand-50/50 p-4">
          <p className="text-[13.5px] font-bold text-brand-900">
            {shop.subscription_status === "pending" ? "Payment received — being verified" : "Your subscription needs attention"}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-brand-900/80">
            {shop.subscription_status === "pending"
              ? "We're checking your transfer. Your shop goes live as soon as it's approved."
              : "Listings hide automatically when the subscription lapses. Renew to bring them back instantly."}
          </p>
          <Link href="/seller/subscription" className="nm-btn-primary mt-2.5 !py-2">Manage subscription</Link>
        </Card>
      )}

      {/* recent orders */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
          <p className="text-[14px] font-bold text-ink-900">Recent orders</p>
          <Link href="/seller/orders" className="text-[12.5px] font-semibold text-brand-600">See all →</Link>
        </div>
        {list.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="🧾"
              title="No orders yet"
              body="Once a buyer pays and we verify their receipt, the order lands here with a 24-hour accept window."
              action="Add your first listing"
              href="/seller/listings/new"
            />
          </div>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {list.slice(0, 6).map((o: any) => {
              const st = ORDER_STATUS[o.status] ?? { label: o.status, tone: "gray" };
              return (
                <Link key={o.id} href={`/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50/70">
                  <div className="min-w-0">
                    <p className="font-mono text-[11.5px] text-ink-500">{o.reference}</p>
                    <p className="text-[12px] text-ink-400">{shortDate(o.created_at)} · {o.fulfilment}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[12.5px] font-bold text-ink-900">{naira(o.total)}</span>
                    <Badge tone={st.tone as any}>{st.label}</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
