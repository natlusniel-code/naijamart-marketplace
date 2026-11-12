import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { EmptyState, Avatar, Badge } from "@/components/ui";
import { relTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chats" };

export default async function SellerChatsPage() {
  const session = await getSession();
  if (!session) redirect("/signin");

  const supabase = createClient();
  const { data: chats } = await supabase
    .from("chats")
    .select("id,order_id,buyer_id,enquiry_id,created_at,orders(reference,status,total)")
    .eq("seller_id", session.user.id)
    .order("created_at", { ascending: false });

  const ids = (chats ?? []).map((c: any) => c.id);
  const { data: msgs } = ids.length
    ? await supabase.from("messages").select("chat_id,body,image_url,created_at,sender_id").in("chat_id", ids).order("created_at", { ascending: false })
    : { data: [] as any[] };

  const buyers = [...new Set((chats ?? []).map((c: any) => c.buyer_id))];
  const { data: profiles } = buyers.length
    ? await supabase.from("profiles_public").select("id,full_name,avatar_url").in("id", buyers)
    : { data: [] as any[] };
  const pmap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  const lastByChat = new Map<string, any>();
  (msgs ?? []).forEach((m: any) => { if (!lastByChat.has(m.chat_id)) lastByChat.set(m.chat_id, m); });

  // One badge per thread, so a seller with several buyers can see which
  // conversation is waiting on them.
  const { data: unreadRows } = await supabase.rpc("chat_unread_counts");
  const unreadByChat = new Map<string, number>(
    ((unreadRows ?? []) as any[]).map((r) => [r.chat_id, Number(r.unread) || 0]),
  );

  // Newest activity first. The query orders by chat creation, which put a
  // thread that was just replied to below one that had been silent for
  // hours — the list has to follow the last message, not the first.
  const ordered = (chats ?? []).slice().sort((a: any, b: any) => {
    const la = lastByChat.get(a.id)?.created_at ?? a.created_at;
    const lb = lastByChat.get(b.id)?.created_at ?? b.created_at;
    return new Date(lb).getTime() - new Date(la).getTime();
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-[21px] font-extrabold tracking-tight text-ink-900">Chats</h1>

      {!chats?.length ? (
        <EmptyState
          icon="💬"
          title="No conversations yet"
          body="Buyers message you from your listings and your public shop page. Replies within an hour lift your response score."
          action="Check your listings"
          href="/seller/listings"
        />
      ) : (
        <div className="nm-card divide-y divide-[var(--line)] overflow-hidden">
          {ordered.map((c: any) => {
            const p = pmap.get(c.buyer_id);
            const last = lastByChat.get(c.id);
            const unread = unreadByChat.get(c.id) ?? 0;
            return (
              <Link key={c.id} href={`/seller/chats/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/70">
                <Avatar name={p?.full_name ?? "Buyer"} src={p?.avatar_url} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-semibold text-ink-900">{p?.full_name ?? "Buyer"}</p>
                    {c.orders?.reference && <span className="font-mono text-[10.5px] text-ink-400">{c.orders.reference}</span>}
                  </div>
                  <p className="truncate text-[12px] text-ink-500">
                    {last ? (last.image_url ? "📷 Photo" : last.body) : "No messages yet"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {last && <p className="text-[10.5px] text-ink-400">{relTime(last.created_at)}</p>}
                  {c.order_id && <Badge tone="blue" className="mt-1">Order</Badge>}
                </div>
                {unread > 0 && (
                  <span
                    className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-500 px-1.5 text-[10.5px] font-bold text-white"
                    aria-label={`${unread} unread`}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
