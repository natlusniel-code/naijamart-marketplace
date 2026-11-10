import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { relTime, naira } from "@/lib/utils";
import { Avatar, EmptyState, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chats" };

export default async function ChatsPage() {
  const session = await getSession();
  if (!session) redirect("/signin?next=%2Fchats");

  const supabase = createClient();
  const uid = session.user.id;

  const { data: chats } = await supabase
    .from("chats")
    .select(`
      id, order_id, created_at, buyer_id, seller_id, shop_id,
      shops(name,logo_url,slug),
      orders(reference,status,total),
      messages(body,created_at,sender_id)
    `)
    .or(`buyer_id.eq.${uid},seller_id.eq.${uid}`)
    .order("created_at", { ascending: false });

  // counterpart names
  const otherIds = Array.from(
    new Set((chats ?? []).map((c: any) => (c.buyer_id === uid ? c.seller_id : c.buyer_id))),
  );
  let people: Record<string, { full_name: string; avatar_url: string | null }> = {};
  if (otherIds.length) {
    const { data } = await supabase
      .from("profiles_public")
      .select("id,full_name,avatar_url")
      .in("id", otherIds);
    people = Object.fromEntries((data ?? []).map((p: any) => [p.id, p]));
  }

  const sorted = (chats ?? []).slice().sort((a: any, b: any) => {
    const la = a.messages?.slice(-1)[0]?.created_at ?? a.created_at;
    const lb = b.messages?.slice(-1)[0]?.created_at ?? b.created_at;
    return new Date(lb).getTime() - new Date(la).getTime();
  });

  if (sorted.length === 0) {
    return (
      <div>
        <h1 className="mb-4 text-[22px] font-extrabold tracking-tight text-ink-900">Chats</h1>
        <EmptyState
          icon="💬"
          title="No conversations yet"
          body="Message a seller about an item, or request a quote for a service — the thread will appear here."
          action="Browse the marketplace"
          href="/"
        />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-[22px] font-extrabold tracking-tight text-ink-900">Chats</h1>
      <div className="nm-card divide-y divide-[var(--line)] overflow-hidden">
        {sorted.map((c: any) => {
          const otherId = c.buyer_id === uid ? c.seller_id : c.buyer_id;
          const person = people[otherId];
          const last = c.messages?.slice(-1)[0];
          const amSeller = c.seller_id === uid;
          return (
            <Link key={c.id} href={`/chats/${c.id}`} className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50/70">
              <Avatar name={person?.full_name ?? c.shops?.name} src={person?.avatar_url} size={42} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[13.5px] font-bold text-ink-900">
                    {amSeller ? (person?.full_name ?? "Buyer") : (c.shops?.name ?? person?.full_name ?? "Seller")}
                  </p>
                  <span className="shrink-0 text-[11px] text-ink-400">{relTime(last?.created_at ?? c.created_at)}</span>
                </div>
                {c.orders?.reference && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
                    <span className="font-mono">{c.orders.reference}</span>
                    <span>·</span>
                    <span>{naira(c.orders.total)}</span>
                    {c.orders.status === "pending_payment" && <Badge tone="amber" className="!px-1.5 !py-0 !text-[10px]">unpaid</Badge>}
                  </p>
                )}
                <p className="mt-0.5 truncate text-[12.5px] text-ink-500">
                  {last?.sender_id === uid ? "You: " : ""}{last?.body ?? "No messages yet — say hello 👋"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
