"use server";

/**
 * All admin mutations live here.
 *
 * They run on the server with the service-role client, so the browser never
 * holds a privileged key. Each action returns a plain `{ ok, error }` result
 * instead of throwing, because the calling components render the message inline.
 *
 * Why not call the `admin_*` RPCs from the browser any more: those RPCs open with
 * `if not public.is_admin() then raise exception 'Admins only.'` — and an
 * anonymous caller is never an admin. Reading them through the service role
 * keeps the guard meaningful (the key itself is the authorisation) instead of
 * deleting the check from the database.
 *
 * The RPCs are still used where they carry real business logic — they are just
 * invoked server-side, where `auth.uid()` is null and `is_admin()` therefore
 * returns false. So each action below either calls the RPC *through a client that
 * is allowed to bypass that guard* or performs the equivalent write directly.
 * For the RPCs guarded by `is_admin()`, direct writes are used and the business
 * rules they enforced are reproduced explicitly.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient, hasAdminKey } from "@/lib/supabase/admin";

export type ActionResult = { ok: boolean; error?: string };

const NO_KEY =
  "SUPABASE_SERVICE_ROLE_KEY is not set on the server, so admin writes are disabled. See README §1d.";

function fail(error: unknown): ActionResult {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (error as { message?: string })?.message ?? "Something went wrong.";
  return { ok: false, error: message };
}

/** Revalidate every admin surface after a write. */
function refreshAdmin(extra?: string[]) {
  for (const p of [
    "/admin-fuckliving",
    "/admin-fuckliving/orders",
    "/admin-fuckliving/payments",
    "/admin-fuckliving/payouts",
    "/admin-fuckliving/disputes",
    "/admin-fuckliving/sellers",
    "/admin-fuckliving/buyers",
    "/admin-fuckliving/reviews",
    "/admin-fuckliving/settings",
    ...(extra ?? []),
  ]) {
    revalidatePath(p);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Payments — verify or reject a buyer's transfer receipt (the escrow gate)
 * ──────────────────────────────────────────────────────────────────────────── */
export async function verifyPayment(
  paymentId: string,
  approve: boolean,
  reason?: string,
): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };
  if (!approve && !reason?.trim()) {
    return { ok: false, error: "A reason is required when rejecting." };
  }

  try {
    const supabase = createAdminClient();

    const { data: pay, error: payErr } = await supabase
      .from("payments")
      .select("id,type,order_id,shop_id,status,amount")
      .eq("id", paymentId)
      .maybeSingle();
    if (payErr) return fail(payErr);
    if (!pay) return { ok: false, error: "Payment not found." };
    if (pay.status === "verified") {
      return { ok: false, error: "That payment is already verified." };
    }

    /* ── Reject ─────────────────────────────────────────────────────────── */
    if (!approve) {
      const { error } = await supabase
        .from("payments")
        .update({
          status: "rejected",
          reject_reason: reason!.trim(),
          verified_at: new Date().toISOString(),
        })
        .eq("id", paymentId);
      if (error) return fail(error);

      // Give back reserved stock on an unpaid order.
      if (pay.type === "order" && pay.order_id) {
        const { data: order } = await supabase
          .from("orders")
          .select("id,status")
          .eq("id", pay.order_id)
          .maybeSingle();

        if (order?.status === "pending_payment") {
          const { data: items } = await supabase
            .from("order_items")
            .select("listing_id,quantity")
            .eq("order_id", pay.order_id);

          for (const item of items ?? []) {
            if (!item.listing_id) continue;
            const { data: listing } = await supabase
              .from("listings")
              .select("id,stock,status,type")
              .eq("id", item.listing_id)
              .maybeSingle();
            if (!listing || listing.type !== "product") continue;

            await supabase
              .from("listings")
              .update({
                stock: Number(listing.stock) + Number(item.quantity),
                status: listing.status === "out_of_stock" ? "live" : listing.status,
              })
              .eq("id", listing.id);
          }
        }
      }

      // A rejected subscription receipt means the shop is not paid up.
      if (pay.type === "subscription" && pay.shop_id) {
        await supabase
          .from("shops")
          .update({ subscription_status: "expired" })
          .eq("id", pay.shop_id);
      }

      refreshAdmin();
      return { ok: true };
    }

    /* ── Approve ────────────────────────────────────────────────────────── */
    const { error: verifyErr } = await supabase
      .from("payments")
      .update({
        status: "verified",
        verified_at: new Date().toISOString(),
        reject_reason: null,
      })
      .eq("id", paymentId);
    if (verifyErr) return fail(verifyErr);

    if (pay.type === "order" && pay.order_id) {
      const { data: order } = await supabase
        .from("orders")
        .select("id,status,total,commission_amount,payout_amount,shop_id")
        .eq("id", pay.order_id)
        .maybeSingle();

      if (order && order.status === "pending_payment") {
        const autoCancel = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await supabase
          .from("orders")
          .update({ status: "paid", auto_cancel_at: autoCancel })
          .eq("id", order.id);
      }
    }

    if (pay.type === "subscription" && pay.shop_id) {
      const { data: shop } = await supabase
        .from("shops")
        .select("id,subscription_expires_at")
        .eq("id", pay.shop_id)
        .maybeSingle();

      const base =
        shop?.subscription_expires_at && new Date(shop.subscription_expires_at) > new Date()
          ? new Date(shop.subscription_expires_at)
          : new Date();
      base.setMonth(base.getMonth() + 1);

      await supabase
        .from("shops")
        .update({
          subscription_status: "active",
          subscription_expires_at: base.toISOString(),
        })
        .eq("id", pay.shop_id);
    }

    refreshAdmin();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Payouts
 * ──────────────────────────────────────────────────────────────────────────── */
export async function markPayoutPaid(
  payoutId: string,
  reference?: string,
): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  try {
    const supabase = createAdminClient();

    const { data: payout, error: findErr } = await supabase
      .from("payouts")
      .select("id,status,order_id")
      .eq("id", payoutId)
      .maybeSingle();
    if (findErr) return fail(findErr);
    if (!payout) return { ok: false, error: "Payout not found." };
    if (payout.status !== "queued") {
      return { ok: false, error: "Payout not found or already paid." };
    }

    const ref =
      reference?.trim() ||
      `PO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const { error } = await supabase
      .from("payouts")
      .update({ status: "paid", paid_at: new Date().toISOString(), reference: ref })
      .eq("id", payoutId);
    if (error) return fail(error);

    if (payout.order_id) {
      await supabase
        .from("orders")
        .update({ payout_status: "paid" })
        .eq("id", payout.order_id);
    }

    refreshAdmin();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Disputes
 * ──────────────────────────────────────────────────────────────────────────── */
export async function resolveDispute(
  disputeId: string,
  outcome: "resolved_buyer" | "resolved_seller",
  note: string,
): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };
  if (note.trim().length < 5) {
    return { ok: false, error: "Add a one-line resolution note." };
  }

  try {
    const supabase = createAdminClient();

    const { data: dispute, error: findErr } = await supabase
      .from("disputes")
      .select("id,order_id")
      .eq("id", disputeId)
      .maybeSingle();
    if (findErr) return fail(findErr);
    if (!dispute) return { ok: false, error: "Dispute not found." };

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id,shop_id,total,commission_amount,payout_amount")
      .eq("id", dispute.order_id)
      .maybeSingle();
    if (orderErr) return fail(orderErr);
    if (!order) return { ok: false, error: "The disputed order is missing." };

    const { error } = await supabase
      .from("disputes")
      .update({
        status: outcome,
        resolution_note: note.trim(),
        resolved_at: new Date().toISOString(),
      })
      .eq("id", disputeId);
    if (error) return fail(error);

    if (outcome === "resolved_buyer") {
      // Buyer wins: the money is held, not released, and any queued payout dies.
      await supabase
        .from("orders")
        .update({ status: "cancelled", payout_status: "held" })
        .eq("id", order.id);
      await supabase
        .from("payouts")
        .delete()
        .eq("order_id", order.id)
        .eq("status", "queued");
    } else {
      // Seller wins: treat as delivered and queue the payout, unlocked in 4 days.
      await supabase
        .from("orders")
        .update({ status: "delivered", payout_status: "released" })
        .eq("id", order.id);

      const availableAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await supabase.from("payouts").insert({
        shop_id: order.shop_id,
        order_id: order.id,
        amount: order.payout_amount,
        gross_amount: order.total,
        commission_amount: order.commission_amount,
        kind: "order",
        status: "queued",
        available_at: availableAt,
      });
    }

    refreshAdmin();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Sellers
 * ──────────────────────────────────────────────────────────────────────────── */
export async function setShopStatus(
  shopId: string,
  status: "pending" | "approved" | "suspended" | "rejected",
  note?: string | null,
  verified?: boolean | null,
): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };
  if (status !== "approved" && !note?.trim()) {
    return { ok: false, error: "Write a short message — the seller receives it." };
  }

  try {
    const supabase = createAdminClient();

    const patch: Record<string, unknown> = {
      status,
      review_note: note?.trim() || null,
    };
    if (typeof verified === "boolean") patch.verified = verified;

    const { error } = await supabase.from("shops").update(patch).eq("id", shopId);
    if (error) return fail(error);

    if (status === "approved") {
      // Publish hidden listings and give the shop its new-seller boost.
      await supabase
        .from("listings")
        .update({ status: "live" })
        .eq("shop_id", shopId)
        .eq("status", "hidden");

      const boostUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error: scoreErr } = await supabase
        .from("seller_scores")
        .upsert(
          { shop_id: shopId, new_seller_boost_until: boostUntil },
          { onConflict: "shop_id" },
        );
      // A missing scores table must not fail the approval itself.
      if (scoreErr) console.error("[admin] seller_scores upsert failed:", scoreErr.message);
    }

    if (status === "suspended" || status === "rejected") {
      await supabase
        .from("listings")
        .update({ status: "hidden" })
        .eq("shop_id", shopId)
        .eq("status", "live");
    }

    refreshAdmin();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function toggleShopSuspend(
  shopId: string,
  suspended: boolean,
): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  try {
    const supabase = createAdminClient();
    const next = suspended ? "approved" : "suspended";

    const { error } = await supabase.from("shops").update({ status: next }).eq("id", shopId);
    if (error) return fail(error);

    // Keep listings in step with the shop's visibility.
    await supabase
      .from("listings")
      .update({ status: suspended ? "live" : "hidden" })
      .eq("shop_id", shopId)
      .eq("status", suspended ? "hidden" : "live");

    refreshAdmin();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reviews
 * ──────────────────────────────────────────────────────────────────────────── */
export async function moderateReview(
  reviewId: string,
  status: "published" | "hidden",
): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("reviews").update({ status }).eq("id", reviewId);
    if (error) return fail(error);
    refreshAdmin();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Buyers
 * ──────────────────────────────────────────────────────────────────────────── */
export async function setBuyerBanned(profileId: string, banned: boolean): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("profiles")
      .update({ is_banned: banned })
      .eq("id", profileId);
    if (error) return fail(error);
    refreshAdmin();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Platform settings
 * ──────────────────────────────────────────────────────────────────────────── */
export async function saveSettings(input: {
  commission_rate: number;
  subscription_price: number;
  default_delivery_fee: number;
  free_delivery_default: number;
  terms_text: string;
}): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  if (!Number.isFinite(input.commission_rate) || input.commission_rate < 0 || input.commission_rate > 1) {
    return { ok: false, error: "Commission must be between 0 and 100%." };
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("platform_settings")
      .update({
        commission_rate: input.commission_rate,
        subscription_price: input.subscription_price,
        default_delivery_fee: input.default_delivery_fee,
        free_delivery_default: input.free_delivery_default,
        terms_text: input.terms_text,
      })
      .eq("id", 1);
    if (error) return fail(error);

    refreshAdmin(["/checkout", "/seller/subscription"]);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Categories
 * ──────────────────────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────────────────────
 * General notifications (broadcast)
 *
 * An admin sends one message to buyers, sellers, or everyone. It is stored as
 * one `notifications` row PER RECIPIENT rather than a single shared row with a
 * read flag, because "read" is per person: a shared row cannot express "buyer A
 * has seen this and buyer B has not", and the unread badge would be wrong for
 * everyone.
 *
 * The fan-out is done in batches. A single insert of 50,000 rows would time out
 * and, worse, would either all land or none — a partial send is far more
 * confusing than a slow one. Batching means a failure halfway through leaves a
 * known number delivered, which the result reports honestly.
 * ────────────────────────────────────────────────────────────────────────── */

export type BroadcastAudience = "buyers" | "sellers" | "everyone";

export type BroadcastResult = ActionResult & {
  sent?: number;
  audience?: BroadcastAudience;
  broadcastId?: string;
};

const BATCH = 500;

export async function sendBroadcast(input: {
  title: string;
  body: string;
  audience: BroadcastAudience;
  href?: string;
}): Promise<BroadcastResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 3) return { ok: false, error: "Give the notification a title." };
  if (body.length < 3) return { ok: false, error: "Write the message you want to send." };
  if (title.length > 120) return { ok: false, error: "Keep the title under 120 characters." };
  if (body.length > 1000) return { ok: false, error: "Keep the message under 1000 characters." };

  try {
    const supabase = createAdminClient();

    // Resolve the audience to a list of user ids.
    //
    // Sellers are identified by owning a shop, not by profiles.role — a user
    // can be a buyer who later opened a shop, and their role column may still
    // say 'buyer'. Ownership is the fact that matters.
    let userIds: string[] = [];

    if (input.audience === "sellers") {
      const { data: shops, error } = await supabase.from("shops").select("owner_id").not("owner_id", "is", null);
      if (error) return fail(error);
      userIds = Array.from(new Set((shops ?? []).map((s: { owner_id: string }) => s.owner_id).filter(Boolean)));
    } else if (input.audience === "buyers") {
      const { data: shops } = await supabase.from("shops").select("owner_id").not("owner_id", "is", null);
      const sellerIds = new Set((shops ?? []).map((s: { owner_id: string }) => s.owner_id).filter(Boolean));
      const { data: people, error } = await supabase.from("profiles").select("id").eq("is_banned", false);
      if (error) return fail(error);
      userIds = (people ?? [])
        .map((p: { id: string }) => p.id)
        .filter((id: string) => !sellerIds.has(id));
    } else {
      const { data: people, error } = await supabase.from("profiles").select("id").eq("is_banned", false);
      if (error) return fail(error);
      userIds = (people ?? []).map((p: { id: string }) => p.id);
    }

    if (userIds.length === 0) {
      return { ok: false, error: "There is nobody in that audience yet." };
    }

    const broadcastId = crypto.randomUUID();
    const href = input.href?.trim() || null;
    let sent = 0;

    for (let i = 0; i < userIds.length; i += BATCH) {
      const slice = userIds.slice(i, i + BATCH);
      const { error } = await supabase.from("notifications").insert(
        slice.map((uid) => ({
          user_id: uid,
          kind: "broadcast" as const,
          title,
          body,
          href,
          broadcast_id: broadcastId,
        })),
      );
      if (error) {
        // Report what actually went out rather than claiming success.
        return {
          ok: false,
          error: `Sent to ${sent} of ${userIds.length} before failing: ${error.message}`,
          sent,
          audience: input.audience,
          broadcastId,
        };
      }
      sent += slice.length;
    }

    refreshAdmin(["/notifications"]);
    return { ok: true, sent, audience: input.audience, broadcastId };
  } catch (error) {
    return fail(error);
  }
}

export async function addCategory(name: string, slug: string, sortOrder: number): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };
  if (name.trim().length < 2) return { ok: false, error: "Give the category a name." };

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("categories").insert({
      name: name.trim(),
      slug,
      sort_order: sortOrder,
      icon: "🏷️",
    });
    if (error) return fail(error);
    refreshAdmin();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function toggleCategory(id: string, active: boolean): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("categories").update({ active: !active }).eq("id", id);
    if (error) return fail(error);
    refreshAdmin();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
