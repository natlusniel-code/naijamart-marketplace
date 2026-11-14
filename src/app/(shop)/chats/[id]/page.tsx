import { notFound, redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { ChatThread } from "@/components/chat-thread";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { draft?: string; pkgs?: string };
}) {
  const session = await getSession();
  if (!session) redirect(`/signin?next=%2Fchats%2F${params.id}`);

  const supabase = createClient();
  const uid = session.user.id;

  const { data: chat } = await supabase
    .from("chats")
    .select(`id,buyer_id,seller_id,shop_id,order_id,
      shops(name,logo_url,slug,kind),
      orders(id,reference,status,total,fulfilment,promised_delivery_at,delivery_days)`)
    .eq("id", params.id)
    .maybeSingle();

  if (!chat) notFound();
  const c: any = chat;
  if (c.buyer_id !== uid && c.seller_id !== uid && !session.isAdmin) notFound();

  const amSeller = c.seller_id === uid;
  const otherId = amSeller ? c.buyer_id : c.seller_id;

  // Opening the thread marks the other side's messages as seen. This is what
  // flips the sender's single tick to a double tick, and it also clears the
  // unread badge before the page is painted.
  await supabase.rpc("mark_chat_read", { p_chat_id: params.id });

  const [{ data: other }, { data: messages }, { data: offers }] = await Promise.all([
    supabase.from("profiles_public").select("full_name,avatar_url").eq("id", otherId).maybeSingle(),
    supabase
      .from("messages")
      .select("id,sender_id,body,image_url,lat,lng,location_label,created_at,read_at,delivered_at")
      .eq("chat_id", params.id)
      // Oldest first: the thread reads top-down to the newest message at the
      // bottom, right above the composer — WhatsApp order.
      .order("created_at", { ascending: true }),
    supabase
      .from("offers")
      .select("id,price,scope,timeline,status,seller_id,image_url,created_at")
      .eq("chat_id", params.id)
      .order("created_at", { ascending: true }),
  ]);

  return (
    <ChatThread
      chatId={params.id}
      meId={uid}
      amSeller={amSeller}
      otherName={other?.full_name ?? "Member"}
      otherAvatar={other?.avatar_url ?? null}
      shopName={c.shops?.name ?? null}
      shopLogo={c.shops?.logo_url ?? null}
      shopKind={c.shops?.kind ?? null}
      order={c.orders ? {
        id: c.orders.id, reference: c.orders.reference, status: c.orders.status,
        total: Number(c.orders.total), fulfilment: c.orders.fulfilment,
        promised_delivery_at: c.orders.promised_delivery_at ?? null,
        delivery_days: c.orders.delivery_days ?? null,
      } : null}
      initialMessages={messages ?? []}
      initialOffers={(offers ?? []) as any}
      initialDraft={searchParams?.draft ?? ""}
      packageIds={
        searchParams?.pkgs
          ? searchParams.pkgs.split(",").map((s) => s.trim()).filter(Boolean)
          : []
      }
    />
  );
}
