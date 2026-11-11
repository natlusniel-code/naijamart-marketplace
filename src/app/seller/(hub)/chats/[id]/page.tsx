import { notFound, redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { ChatThread } from "@/components/chat-thread";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chat" };

/**
 * A chat thread inside the Seller Hub.
 *
 * The buyer-side thread lives at `/chats/[id]` under the storefront layout, and
 * sellers are now redirected out of the storefront — so the hub needs its own
 * route or every "Chats" link in the seller nav would bounce them to the
 * dashboard. The component is the same `ChatThread`; only the shell differs.
 *
 * The authorisation check is the important part: a chat is readable only by its
 * buyer, its seller, or an admin. Being inside `/seller` is not enough on its
 * own — a seller must not be able to open another seller's conversation by
 * guessing an id.
 */
export default async function SellerChatPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect(`/signin?next=%2Fseller%2Fchats%2F${params.id}`);

  const supabase = createClient();
  const uid = session.user.id;

  const { data: chat } = await supabase
    .from("chats")
    .select(`id,buyer_id,seller_id,shop_id,order_id,
      shops(name,logo_url,slug),
      orders(id,reference,status,total,fulfilment)`)
    .eq("id", params.id)
    .maybeSingle();

  if (!chat) notFound();
  const c: any = chat;

  // Only the two participants (or an admin) may read this thread.
  if (c.buyer_id !== uid && c.seller_id !== uid && !session.isAdmin) notFound();

  const amSeller = c.seller_id === uid;
  const otherId = amSeller ? c.buyer_id : c.seller_id;

  // Opening the thread marks the other side's messages as seen — this is what
  // flips the sender's single tick to a double tick and clears the badge.
  await supabase.rpc("mark_chat_read", { p_chat_id: params.id });

  const [{ data: other }, { data: messages }, { data: offers }] = await Promise.all([
    supabase.from("profiles_public").select("full_name,avatar_url").eq("id", otherId).maybeSingle(),
    supabase
      .from("messages")
      .select("id,sender_id,body,image_url,created_at,read_at,delivered_at")
      .eq("chat_id", params.id)
      .order("created_at"),
    supabase
      .from("offers")
      .select("id,price,scope,timeline,status,seller_id,image_url,created_at")
      .eq("chat_id", params.id)
      .order("created_at"),
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
      order={
        c.orders
          ? {
              id: c.orders.id,
              reference: c.orders.reference,
              status: c.orders.status,
              total: Number(c.orders.total),
              fulfilment: c.orders.fulfilment,
            }
          : null
      }
      initialMessages={messages ?? []}
      initialOffers={(offers ?? []) as any}
      basePath="/seller/chats"
    />
  );
}
