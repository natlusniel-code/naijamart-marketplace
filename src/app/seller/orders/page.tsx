import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { naira, shortDate, ORDER_STATUS } from "@/lib/utils";
import { Badge, EmptyState, Tabs } from "@/components/ui";
import { AcceptDecline, AdvanceOrder } from "@/components/seller/order-buttons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Seller orders" };

const TABS = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "processing", label: "Processing" },
  { key: "shipped", label: "Shipped" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export default async function SellerOrdersPage({ searchParams }: { searchParams: { tab?: string } }) {
  const session = await getSession();
  if (!session) redirect("/signin");
  if (!session.shop) redirect("/seller/onboarding");

  const tab = searchParams.tab ?? "all";
  const supabase = createClient();

  const { data: all } = await supabase
    .from("orders")
    .select(`*, order_items(title,quantity,line_total)`)
    .eq("shop_id", session.shop.id)
    .order("created_at", { ascending: false });

  const list = (all ?? []) as any[];

  // orders.buyer_id → auth.users (no FK to profiles), so names are joined in memory.
  const buyerIds = Array.from(new Set(list.map((o) => o.buyer_id).filter(Boolean)));
  const { data: buyerRows } = buyerIds.length
    ? await supabase.from("profiles_public").select("id,full_name,avatar_url").in("id", buyerIds)
    : { data: [] as any[] };
  const buyerMap = new Map((buyerRows ?? []).map((b: any) => [b.id, b]));
  for (const o of list) o.profiles_public = buyerMap.get(o.buyer_id) ?? null;

  const counts = {
    all: list.length,
    new: list.filter((o: any) => o.status === "paid").length,
    processing: list.filter((o: any) => ["accepted", "processing", "ready_for_pickup"].includes(o.status)).length,
    shipped: list.filter((o: any) => o.status === "shipped").length,
    completed: list.filter((o: any) => ["delivered", "completed"].includes(o.status)).length,
    cancelled: list.filter((o: any) => ["cancelled", "disputed"].includes(o.status)).length,
  };

  const filtered = list.filter((o: any) => {
    if (tab === "all") return true;
    if (tab === "new") return o.status === "paid";
    if (tab === "processing") return ["accepted", "processing", "ready_for_pickup"].includes(o.status);
    if (tab === "shipped") return o.status === "shipped";
    if (tab === "completed") return ["delivered", "completed"].includes(o.status);
    if (tab === "cancelled") return ["cancelled", "disputed"].includes(o.status);
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[21px] font-extrabold tracking-tight text-ink-900">Orders</h1>
        <p className="text-[12px] text-ink-500">Accept within 24 hours of payment, or the order auto-cancels.</p>
      </div>

      <Tabs items={TABS.map((t) => ({ label: t.label, href: `/seller/orders?tab=${t.key}`, count: counts[t.key as keyof typeof counts] }))} current={`/seller/orders?tab=${tab}`} />

      {filtered.length === 0 ? (
        <EmptyState
          icon="🧾"
          title={tab === "new" ? "No new orders to accept" : "Nothing in this tab"}
          body="Paid orders land here the moment NaijaMart verifies the buyer's transfer. You'll have 24 hours to accept."
          action="View your listings"
          href="/seller/listings"
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((o: any) => {
            const st = ORDER_STATUS[o.status] ?? { label: o.status, tone: "gray" };
            const items = o.order_items ?? [];
            return (
              <div key={o.id} className="nm-card overflow-hidden">
                <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-[11.5px] text-ink-500">{o.reference}</p>
                    <p className="text-[12px] text-ink-400">{o.profiles_public?.full_name ?? "Buyer"} · {shortDate(o.created_at)}</p>
                  </div>
                  <Badge tone={st.tone as any} dot>{st.label}</Badge>
                </div>

                <div className="grid gap-3 px-4 py-3 sm:grid-cols-[1.4fr_1fr]">
                  <div>
                    <ul className="space-y-0.5">
                      {items.map((i: any, idx: number) => (
                        <li key={idx} className="text-[12.5px] text-ink-700">
                          {i.title} <span className="text-ink-400">×{i.quantity}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[11.5px] text-ink-400">
                      {o.fulfilment === "pickup" ? "Pickup" : "Delivery"} · {o.address ?? "—"}
                    </p>
                  </div>

                  {/* payout ledger */}
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="flex justify-between text-[11.5px]">
                      <span className="text-ink-500">Gross</span>
                      <span className="font-semibold text-ink-900">{naira(o.total)}</span>
                    </div>
                    <div className="flex justify-between text-[11.5px]">
                      <span className="text-ink-500">5% commission</span>
                      <span className="font-semibold text-ink-500">−{naira(o.commission_amount)}</span>
                    </div>
                    <div className="mt-1 flex justify-between border-t border-[var(--line)] pt-1 text-[12.5px]">
                      <span className="font-bold text-ink-900">Net payout</span>
                      <span className="font-extrabold text-ink-900">{naira(o.payout_amount)}</span>
                    </div>
                    <div className="mt-1">
                      <Badge tone={o.payout_status === "paid" ? "green" : o.payout_status === "released" ? "blue" : "amber"}>
                        {o.payout_status === "paid" ? "Paid" : o.payout_status === "released" ? "Released" : "Held"}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="border-t border-[var(--line)] bg-slate-50/50 px-4 py-2.5">
                  {o.status === "paid" ? (
                    <AcceptDecline orderId={o.id} />
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <AdvanceOrder orderId={o.id} status={o.status} fulfilment={o.fulfilment} />
                      <Link href={`/orders/${o.id}`} className="nm-btn-ghost w-full !py-2 !text-[12.5px]">Order details</Link>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
