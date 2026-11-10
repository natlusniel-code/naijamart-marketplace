import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { naira, shortDate } from "@/lib/utils";
import { Card, Badge, EmptyState } from "@/components/ui";
import { DisputeDecision } from "@/components/admin/dispute-decision";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disputes" };

export default async function AdminDisputesPage() {
  const supabase = createClient();
  const { data: disputes } = await supabase
    .from("disputes")
    .select("*, orders(reference,status,total,payout_amount,shop_id,shops(name))")
    .order("created_at", { ascending: false });

  const list = disputes ?? [];
  // disputes.raised_by → auth.users, so the display name is resolved from the public view.
  const raiserIds = Array.from(new Set(list.map((d: any) => d.raised_by).filter(Boolean)));
  const { data: raiserRows } = raiserIds.length
    ? await supabase.from("profiles_public").select("id,full_name").in("id", raiserIds)
    : { data: [] as any[] };
  const raisers = new Map((raiserRows ?? []).map((p: any) => [p.id, p.full_name]));
  for (const d of list) d.profiles_public = { full_name: raisers.get(d.raised_by) as string | undefined };
  const open = list.filter((d: any) => d.status === "open");
  const closed = list.filter((d: any) => d.status !== "open");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Disputes</h1>
        <p className="text-[12.5px] text-ink-500">{open.length} open · {closed.length} resolved</p>
      </div>

      {open.length === 0 ? (
        <EmptyState
          icon="⚖️"
          title="No open disputes"
          body="When a buyer or seller raises an issue, it lands here with the order, the amount held in escrow, and both sides. Choose who gets the money."
        />
      ) : (
        <div className="space-y-3">
          {open.map((d: any) => (
            <Card key={d.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-ink-500">{d.orders?.reference}</p>
                  <p className="text-[14px] font-bold text-ink-900">{d.orders?.shops?.name ?? "Order"}</p>
                  <p className="text-[12px] text-ink-500">
                    Raised by {d.profiles_public?.full_name ?? "user"} · {shortDate(d.created_at)} · escrow {naira(d.orders?.total ?? 0)}
                  </p>
                </div>
                <DisputeDecision disputeId={d.id} />
              </div>
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900">
                <span className="font-semibold">Reason:</span> {d.reason}
              </p>
            </Card>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        <p className="border-b border-[var(--line)] px-4 py-2.5 text-[14px] font-bold text-ink-900">Resolved</p>
        {closed.length === 0 ? (
          <p className="px-4 py-3 text-[12.5px] text-ink-500">Nothing resolved yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {closed.map((d: any) => (
              <li key={d.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link href={d.orders ? `/orders/${d.orders_id ?? ""}` : "#"} className="font-mono text-[11px] text-ink-600">
                    {d.orders?.reference}
                  </Link>
                  <Badge tone={d.status === "resolved_buyer" ? "blue" : "green"}>
                    {d.status === "resolved_buyer" ? "Refunded buyer" : "Released to seller"}
                  </Badge>
                </div>
                {d.resolution_note && <p className="mt-0.5 text-[11.5px] text-ink-500">{d.resolution_note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
