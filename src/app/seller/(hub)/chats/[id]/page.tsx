import { notFound, redirect } from "next/navigation";
import { getSession, createClient } from "@/lib/supabase/server";
import { ChatThread } from "@/components/chat-thread";
import { shopHasFeature } from "@/lib/plan-gate";

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
      shops(name,logo_url,slug,kind,ai_reply_enabled),
      orders(id,reference,status,total,fulfilment,promised_delivery_at,delivery_days)`)
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
      .select("id,sender_id,body,image_url,lat,lng,location_label,created_at,read_at,delivered_at")
      .eq("chat_id", params.id)
      // Oldest first: newest message at the bottom, above the composer.
      .order("created_at", { ascending: true }),
    supabase
      .from("offers")
      .select("id,price,scope,timeline,status,seller_id,image_url,created_at")
      .eq("chat_id", params.id)
      .order("created_at", { ascending: true }),
  ]);

  // The seller's presence, read on the server so the headline is correct on
  // the first paint instead of flashing "Offline" until the client polls.
  const { data: sellerOnline } = c.shop_id
    ? await supabase.rpc("seller_is_online", { p_shop_id: c.shop_id })
    : { data: false };

  /*
    ── The AI reply is Premium-only ──────────────────────────────────────
    `shops.ai_reply_enabled` is the seller's own switch; it says nothing
    about what they pay for. A Basic shop that once had the feature on
    would otherwise still see the suggestion panel and the AI would still
    be asked for a draft. The plan gate is the authority, and it is the
    same `seller_has_feature` check the server-side reply path uses — so
    the panel and the endpoint can never disagree.
  */
  const aiReplyEntitled = c.shop_id
    ? await shopHasFeature(c.shop_id, "aiReply")
    : false;

  return (
    <ChatThread
      chatId={params.id}
      meId={uid}
      amSeller={amSeller}
      otherUserId={otherId}
      shopId={c.shop_id ?? null}
      sellerOnlineSeed={sellerOnline === true}
      otherName={other?.full_name ?? "Member"}
      otherAvatar={other?.avatar_url ?? null}
      shopName={c.shops?.name ?? null}
      shopLogo={c.shops?.logo_url ?? null}
      shopKind={c.shops?.kind ?? null}
      order={
        c.orders
          ? {
              id: c.orders.id,
              reference: c.orders.reference,
              status: c.orders.status,
              total: Number(c.orders.total),
              fulfilment: c.orders.fulfilment,
              promised_delivery_at: c.orders.promised_delivery_at ?? null,
              delivery_days: c.orders.delivery_days ?? null,
            }
          : null
      }
      initialMessages={messages ?? []}
      initialOffers={(offers ?? []) as any}
      basePath="/seller/chats"
      aiReplyEnabled={aiReplyEntitled && c.shops?.ai_reply_enabled !== false}
    />
  );
}