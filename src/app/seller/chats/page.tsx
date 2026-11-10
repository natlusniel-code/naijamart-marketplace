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
          {chats.map((c: any) => {
            const p = pmap.get(c.buyer_id);
            const last = lastByChat.get(c.id);
            return (
              <Link key={c.id} href={`/chats/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/70">
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
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
