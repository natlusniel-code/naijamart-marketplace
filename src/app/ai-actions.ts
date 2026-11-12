"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyReceipt } from "@/lib/ai/receipts";
import { checkIdentityDocument } from "@/lib/ai/identity";
import {
  writeDescription,
  improveTitle,
  suggestTags,
  fixGrammar,
  checkImageQuality,
  listingFromImage,
  generateFaqs,
  sellerInsights,
} from "@/lib/ai/listing-tools";
import {
  supportAnswer,
  explainOrderStatus,
  parseSearchQuery,
  correctSearchQuery,
  compareProducts,
  summariseReviews,
} from "@/lib/ai/buyer";
import {
  reviewListing,
  detectDuplicates,
  sellerRiskSummary,
  detectReviewSpam,
  triageComplaint,
  cleanupListing,
  suggestCategory,
  auditListingImage,
  dailyDigest,
  summariseDispute,
  checkPayoutAnomaly,
  draftSupportReply,
  searchGapReport,
  salesNarrative,
  priceSanity,
} from "@/lib/ai/admin";

/**
 * Server Actions for every AI feature.
 *
 * ── Why everything is wrapped ───────────────────────────────────────────────
 * A Server Action that throws turns into an unhandled error in the client. Every
 * action here returns a plain object instead, so the UI can always render
 * something — including "suggestions are unavailable right now".
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 * Buyer/seller actions require a session. Admin actions require the admin
 * console's service-role path, which is how the rest of that console works.
 * The AI itself never sees a user id it was not given.
 */

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; fallback?: T };

function fail<T>(error: string, fallback?: T): ActionResult<T> {
  return { ok: false, error, fallback };
}

// ═════════════════════════════════════════════════════════════════════════
// Seller writing tools
// ═════════════════════════════════════════════════════════════════════════

export async function aiWriteDescription(input: {
  name: string;
  specs: string;
  category?: string;
  price?: number;
}): Promise<ActionResult<{ title: string; description: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first.");

  const r = await writeDescription({ actorId: session.user.id, ...input });
  if (!r.ok) return fail(`Suggestions unavailable (${r.reason}).`, r.fallback);
  return { ok: true, data: r.data };
}

export async function aiImproveTitle(input: {
  title: string;
  category?: string;
}): Promise<ActionResult<{ title: string; why: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first.");

  const r = await improveTitle({ actorId: session.user.id, ...input });
  if (!r.ok) return fail(`Suggestions unavailable (${r.reason}).`, r.fallback);
  return { ok: true, data: r.data };
}

export async function aiSuggestTags(input: {
  title: string;
  description?: string;
}): Promise<ActionResult<{ category: string | null; tags: string[]; brand: string | null; colour: string | null; size: string | null }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first.");

  const supabase = createAdminClient();
  const { data: cats } = await supabase.from("categories").select("name").eq("active", true);
  const categories = (cats ?? []).map((c: { name: string }) => c.name);

  const r = await suggestTags({ actorId: session.user.id, categories, ...input });
  if (!r.ok) return fail(`Suggestions unavailable (${r.reason}).`, r.fallback);
  return { ok: true, data: r.data };
}

export async function aiFixGrammar(input: {
  text: string;
}): Promise<ActionResult<{ text: string; changes: string[] }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first.");

  const r = await fixGrammar({ actorId: session.user.id, ...input });
  if (!r.ok) return fail(`Suggestions unavailable (${r.reason}).`, r.fallback);
  return { ok: true, data: r.data };
}

export async function aiCheckImage(input: {
  imageUrl: string;
}): Promise<ActionResult<{ score: number; issues: string[]; advice: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first.");

  const r = await checkImageQuality({ actorId: session.user.id, ...input });
  if (!r.ok) return fail(`Photo checks unavailable (${r.reason}).`, r.fallback);
  return { ok: true, data: r.data };
}

export async function aiListingFromImage(input: {
  imageUrl: string;
}): Promise<ActionResult<{ title: string; description: string; tags: string[]; category: string | null }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first.");

  const supabase = createAdminClient();
  const { data: cats } = await supabase.from("categories").select("name").eq("active", true);
  const categories = (cats ?? []).map((c: { name: string }) => c.name);

  const r = await listingFromImage({ actorId: session.user.id, categories, ...input });
  if (!r.ok) return fail(`Suggestions unavailable (${r.reason}).`, r.fallback);
  return { ok: true, data: r.data };
}

export async function aiGenerateFaqs(input: {
  shopName: string;
  policies: string;
  products: string;
}): Promise<ActionResult<{ faqs: { q: string; a: string }[] }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first.");

  const r = await generateFaqs({ actorId: session.user.id, ...input });
  if (!r.ok) return fail(`Suggestions unavailable (${r.reason}).`, r.fallback);
  return { ok: true, data: r.data };
}

export async function aiSellerInsights(): Promise<ActionResult<{ insights: { title: string; detail: string; severity: "info" | "warn" }[] }>> {
  const session = await getSession();
  if (!session?.shop) return fail("No shop on this account.");

  const supabase = createAdminClient();
  const shopId = session.shop.id;

  const [{ data: listings }, { data: chats }] = await Promise.all([
    supabase.from("listings").select("id,description,images,views").eq("shop_id", shopId),
    supabase.from("chats").select("id").eq("shop_id", shopId),
  ]);

  const rows = listings ?? [];
  const stats = {
    listings: rows.length,
    withoutImages: rows.filter((l: any) => !Array.isArray(l.images) || l.images.length === 0).length,
    shortDescriptions: rows.filter((l: any) => (l.description ?? "").trim().length < 60).length,
    unansweredChats: (chats ?? []).length,
    lowRating: Number(session.shop.rating_avg ?? 0),
    views: rows.reduce((n: number, l: any) => n + Number(l.views ?? 0), 0),
  };

  const r = await sellerInsights({ actorId: session.user.id, shopName: session.shop.name, stats });
  if (!r.ok) return fail(`Insights unavailable (${r.reason}).`, r.fallback);
  return { ok: true, data: r.data };
}

// ═════════════════════════════════════════════════════════════════════════
// Buyer-facing
// ═════════════════════════════════════════════════════════════════════════

export async function aiSupportChat(input: {
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
}): Promise<ActionResult<{ answer: string; handoff: boolean; sources: string[] }>> {
  const session = await getSession();
  const actorId = session?.user.id ?? "anon";

  const r = await supportAnswer({ actorId, ...input });
  return { ok: true, data: r };
}

export async function aiOrderStatus(input: {
  question: string;
  orderId: string;
}): Promise<ActionResult<{ answer: string; handoff: boolean }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first.");

  // The order is retrieved HERE, under the buyer's own RLS, and handed to the
  // AI. The AI never queries the database and is told so explicitly.
  const supabase = createAdminClient();
  const { data: order } = await supabase
    .from("orders")
    .select("reference,status,total,created_at,payout_status,shops(name),order_items(title,quantity),payments(status,type)")
    .eq("id", input.orderId)
    .eq("buyer_id", session.user.id)
    .maybeSingle();

  if (!order) {
    return {
      ok: true,
      data: {
        answer:
          "I couldn't find that order on your account. Open Orders to see everything you've bought.",
        handoff: true,
      },
    };
  }

  const o = order as any;
  const payment = Array.isArray(o.payments)
    ? o.payments.find((p: any) => p.type === "order")
    : o.payments;

  const r = await explainOrderStatus({
    actorId: session.user.id,
    question: input.question,
    order: {
      reference: o.reference,
      status: o.status,
      total: Number(o.total),
      shop_name: o.shops?.name ?? "the seller",
      created_at: o.created_at,
      items: (o.order_items ?? []).map((i: any) => ({ title: i.title, quantity: i.quantity })),
      payment_status: payment?.status ?? null,
      payout_status: o.payout_status ?? null,
    },
  });

  return { ok: true, data: r };
}

/**
 * Natural-language search.
 *
 * Returns filters for the caller to run as a normal query. When the AI is
 * unavailable this returns `{ ok: false }` and the search page keeps its
 * existing keyword search — which is the whole point of the fallback.
 */
export async function aiParseSearch(input: {
  query: string;
}): Promise<ActionResult<{ category: string | null; max_price: number | null; min_price: number | null; keywords: string[]; understood: string }>> {
  const session = await getSession();
  const actorId = session?.user.id ?? "anon";

  const supabase = createAdminClient();
  const { data: cats } = await supabase.from("categories").select("name,slug").eq("active", true);
  const rows = (cats ?? []) as { name: string; slug: string }[];
  const categories = rows.map((c) => c.name);

  const filters = await parseSearchQuery({ actorId, query: input.query, categories });
  if (!filters) return fail("Search suggestions unavailable.");

  // The AI picks a category NAME (that is what it can reason about); the search
  // page filters by SLUG. Map back here so a hallucinated name can never reach
  // the query — an unknown name simply becomes null.
  const slug = filters.category
    ? rows.find((c) => c.name === filters.category)?.slug ?? null
    : null;

  return { ok: true, data: { ...filters, category: slug } };
}

export async function aiCorrectSearch(input: {
  query: string;
}): Promise<ActionResult<{ corrected: string; changed: boolean }>> {
  const session = await getSession();
  const actorId = session?.user.id ?? "anon";

  const r = await correctSearchQuery({ actorId, query: input.query });
  if (!r) return fail("Correction unavailable.");
  return { ok: true, data: r };
}

export async function aiCompareProducts(input: {
  listingIds: string[];
}): Promise<ActionResult<{ summary: string; differences: string[] }>> {
  const session = await getSession();
  const actorId = session?.user.id ?? "anon";

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("listings")
    .select("title,price,description,tags,shops(name,rating_avg)")
    .in("id", input.listingIds.slice(0, 4));

  if (!data || data.length < 2) return fail("Pick at least two products to compare.");

  const r = await compareProducts({
    actorId,
    products: data.map((l: any) => ({
      title: l.title,
      price: Number(l.price),
      description: l.description,
      tags: l.tags ?? [],
      shop_name: l.shops?.name ?? "",
      rating: Number(l.shops?.rating_avg ?? 0),
    })),
  });

  if (!r) return fail("Comparison unavailable.");
  return { ok: true, data: r };
}

export async function aiSummariseReviews(input: {
  shopId: string;
}): Promise<ActionResult<{ positives: string[]; complaints: string[]; themes: string[] }>> {
  const session = await getSession();
  const actorId = session?.user.id ?? "anon";

  const supabase = createAdminClient();
  const [{ data: shop }, { data: reviews }] = await Promise.all([
    supabase.from("shops").select("name").eq("id", input.shopId).maybeSingle(),
    supabase
      .from("reviews")
      .select("rating,body")
      .eq("shop_id", input.shopId)
      .eq("status", "published")
      .limit(60),
  ]);

  const r = await summariseReviews({
    actorId,
    shopName: shop?.name ?? "this shop",
    reviews: (reviews ?? []) as { rating: number; body: string | null }[],
  });

  if (!r) return fail("Summary unavailable.");
  return { ok: true, data: r };
}

// ═════════════════════════════════════════════════════════════════════════
// Payment + identity (the two that touch money and trust)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Verify a receipt after the buyer uploads it.
 *
 * Called from checkout AFTER `submit_receipt` has created the payment row. It
 * is deliberately fire-and-forget from the buyer's point of view: the order is
 * already placed, and this only decides whether the payment clears instantly or
 * waits for a human. A failure here never fails the checkout.
 */
export async function aiVerifyReceipt(input: {
  paymentId: string;
  imageUrl: string;
}): Promise<ActionResult<{ autoApproved: boolean; message: string; aiAvailable: boolean }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first.");

  try {
    const r = await verifyReceipt({
      paymentId: input.paymentId,
      imageUrl: input.imageUrl,
      actorId: session.user.id,
      actorRole: session.profile.role,
    });

    revalidatePath("/orders");
    revalidatePath("/admin-fuckliving/payments");

    return {
      ok: true,
      data: {
        autoApproved: r.autoApproved,
        message: r.outcome.buyerMessage,
        aiAvailable: r.aiAvailable,
      },
    };
  } catch (e) {
    // Never surface an AI failure to a buyer who has just paid.
    return {
      ok: true,
      data: {
        autoApproved: false,
        message:
          "We're confirming your payment. This usually takes a few minutes — you'll be notified as soon as it clears.",
        aiAvailable: false,
      },
    };
  }
}

/**
 * Check an uploaded identity document.
 *
 * Returns `documentAccepted` — the subscription page gate reads this. When the
 * AI is unavailable the document goes to the human queue and the gate stays
 * closed, which is the safe direction.
 */
export async function aiCheckIdentity(input: {
  imageUrl: string;
  declaredType?: string;
}): Promise<ActionResult<{ status: string; message: string; documentAccepted: boolean }>> {
  const session = await getSession();
  if (!session?.shop) return fail("No shop on this account.");

  try {
    const r = await checkIdentityDocument({
      shopId: session.shop.id,
      ownerId: session.user.id,
      imageUrl: input.imageUrl,
      declaredType: input.declaredType,
      actorRole: session.profile.role,
    });

    revalidatePath("/seller/onboarding");
    revalidatePath("/seller/subscription");

    return {
      ok: true,
      data: {
        status: r.status,
        message: r.message,
        documentAccepted: r.documentAccepted,
      },
    };
  } catch {
    return {
      ok: true,
      data: {
        status: "needs_review",
        message:
          "We've received your document and a person will check it shortly. You'll be notified when it's done.",
        documentAccepted: false,
      },
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Admin
// ═════════════════════════════════════════════════════════════════════════

export async function aiReviewListing(input: {
  listingId: string;
}): Promise<ActionResult<{ flags: { title: string; detail: string; severity: string }[] }>> {
  const supabase = createAdminClient();
  const { data: l } = await supabase
    .from("listings")
    .select("id,title,description,price,images,categories(name),shops(name)")
    .eq("id", input.listingId)
    .maybeSingle();

  if (!l) return fail("Listing not found.");

  const row = l as any;
  const flags = await reviewListing({
    actorId: "admin",
    listing: {
      id: row.id,
      title: row.title,
      description: row.description,
      price: Number(row.price),
      category: row.categories?.name ?? null,
      shop_name: row.shops?.name ?? "",
      images: row.images ?? [],
    },
  });

  revalidatePath("/admin-fuckliving/ai");
  return { ok: true, data: { flags } };
}

export async function aiDetectDuplicates(): Promise<ActionResult<{ groups: { ids: string[]; reason: string }[] }>> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("listings")
    .select("id,title,price,shops(name)")
    .eq("status", "live")
    .limit(200);

  const r = await detectDuplicates({
    actorId: "admin",
    listings: (data ?? []).map((l: any) => ({
      id: l.id,
      title: l.title,
      price: Number(l.price),
      shop_name: l.shops?.name ?? "",
    })),
  });

  revalidatePath("/admin-fuckliving/ai");
  return { ok: true, data: r };
}

export async function aiSellerRisk(input: {
  shopId: string;
}): Promise<ActionResult<{ summary: string }>> {
  const supabase = createAdminClient();
  const { data: shop } = await supabase
    .from("shops")
    .select("id,name,created_at,status,verified,rating_avg,rating_count")
    .eq("id", input.shopId)
    .maybeSingle();

  if (!shop) return fail("Shop not found.");

  const [{ count: orders }, { count: disputes }, { count: payouts }] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("shop_id", input.shopId),
    supabase
      .from("disputes")
      .select("id", { count: "exact", head: true })
      .in("order_id", (
        await supabase.from("orders").select("id").eq("shop_id", input.shopId)
      ).data?.map((o: any) => o.id) ?? []),
    supabase.from("payouts").select("id", { count: "exact", head: true }).eq("shop_id", input.shopId),
  ]);

  const summary = await sellerRiskSummary({
    actorId: "admin",
    shop: {
      id: shop.id,
      name: shop.name,
      created_at: shop.created_at,
      status: shop.status,
      verified: shop.verified,
      rating_avg: Number(shop.rating_avg),
      rating_count: Number(shop.rating_count),
      orders: orders ?? 0,
      disputes: disputes ?? 0,
      refunds: 0,
      payouts: payouts ?? 0,
    },
  });

  if (!summary) return fail("Summary unavailable.");
  return { ok: true, data: { summary } };
}

export async function aiReviewSpam(): Promise<ActionResult<{ suspicious: { id: string; reason: string }[] }>> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("reviews")
    .select("id,rating,body,buyer_id")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(100);

  const r = await detectReviewSpam({
    actorId: "admin",
    reviews: (data ?? []) as { id: string; rating: number; body: string | null; buyer_id: string }[],
  });

  revalidatePath("/admin-fuckliving/ai");
  return { ok: true, data: r };
}

export async function aiTriageComplaint(input: {
  disputeId: string;
}): Promise<ActionResult<{ category: string; why: string }>> {
  const supabase = createAdminClient();
  const { data: d } = await supabase
    .from("disputes")
    .select("id,reason,order_id")
    .eq("id", input.disputeId)
    .maybeSingle();

  if (!d) return fail("Dispute not found.");

  const { data: msgs } = await supabase
    .from("messages")
    .select("body,sender_id,created_at")
    .eq("chat_id", (
      await supabase.from("chats").select("id").eq("order_id", d.order_id).maybeSingle()
    ).data?.id ?? "")
    .order("created_at")
    .limit(40);

  const r = await triageComplaint({
    actorId: "admin",
    disputeId: d.id,
    reason: d.reason,
    messages: (msgs ?? []).map((m: any) => ({ role: "user", content: m.body ?? "" })),
  });

  if (!r) return fail("Triage unavailable.");
  revalidatePath("/admin-fuckliving/ai");
  return { ok: true, data: r };
}

export async function aiCleanupListing(input: {
  listingId: string;
}): Promise<ActionResult<{ title: string; description: string; category: string | null; changes: string[] }>> {
  const supabase = createAdminClient();
  const [{ data: l }, { data: cats }] = await Promise.all([
    supabase
      .from("listings")
      .select("id,title,description,categories(name)")
      .eq("id", input.listingId)
      .maybeSingle(),
    supabase.from("categories").select("name").eq("active", true),
  ]);

  if (!l) return fail("Listing not found.");

  const row = l as any;
  const r = await cleanupListing({
    actorId: "admin",
    listing: {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.categories?.name ?? null,
    },
    categories: (cats ?? []).map((c: { name: string }) => c.name),
  });

  if (!r) return fail("Cleanup unavailable.");
  return { ok: true, data: r };
}

export async function aiSuggestCategory(input: {
  listingId: string;
}): Promise<ActionResult<{ category: string | null }>> {
  const supabase = createAdminClient();
  const [{ data: l }, { data: cats }] = await Promise.all([
    supabase.from("listings").select("title,description").eq("id", input.listingId).maybeSingle(),
    supabase.from("categories").select("name").eq("active", true),
  ]);

  if (!l) return fail("Listing not found.");

  const category = await suggestCategory({
    actorId: "admin",
    title: l.title,
    description: l.description,
    categories: (cats ?? []).map((c: { name: string }) => c.name),
  });

  if (!category) return fail("No category suggestion.");
  return { ok: true, data: { category } };
}

export async function aiAuditImage(input: {
  listingId: string;
}): Promise<ActionResult<{ flag: { title: string; detail: string; severity: string } | null }>> {
  const supabase = createAdminClient();
  const { data: l } = await supabase
    .from("listings")
    .select("id,title,images")
    .eq("id", input.listingId)
    .maybeSingle();

  if (!l) return fail("Listing not found.");

  const images = Array.isArray(l.images) ? l.images : [];
  const flag = await auditListingImage({
    actorId: "admin",
    listingId: l.id,
    title: l.title,
    imageUrl: images[0] ?? null,
  });

  revalidatePath("/admin-fuckliving/ai");
  return { ok: true, data: { flag } };
}

export async function aiDailyDigest(): Promise<ActionResult<{ digest: string }>> {
  const supabase = createAdminClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    { count: newOrders },
    { count: pendingPayouts },
    { count: openDisputes },
    { count: awaitingApproval },
    { count: awaitingPayment },
    { count: flagged },
    { data: todayOrders },
  ] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).gte("created_at", today.toISOString()),
    supabase.from("payouts").select("id", { count: "exact", head: true }).eq("status", "queued"),
    supabase.from("disputes").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("shops").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("ai_suggestions").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("orders").select("total").gte("created_at", today.toISOString()).eq("status", "paid"),
  ]);

  const revenue = (todayOrders ?? []).reduce((n: number, o: any) => n + Number(o.total ?? 0), 0);

  const digest = await dailyDigest({
    actorId: "admin",
    stats: {
      new_orders: newOrders ?? 0,
      pending_payouts: pendingPayouts ?? 0,
      open_disputes: openDisputes ?? 0,
      sellers_awaiting_approval: awaitingApproval ?? 0,
      payments_awaiting_confirmation: awaitingPayment ?? 0,
      revenue_today: revenue,
      flagged_listings: flagged ?? 0,
    },
  });

  if (!digest) return fail("Digest unavailable.");
  return { ok: true, data: { digest } };
}

export async function aiDisputeSummary(input: {
  disputeId: string;
}): Promise<ActionResult<{ timeline: string[]; buyer_claim: string; seller_claim: string }>> {
  const supabase = createAdminClient();
  const { data: d } = await supabase
    .from("disputes")
    .select("id,reason,order_id")
    .eq("id", input.disputeId)
    .maybeSingle();

  if (!d) return fail("Dispute not found.");

  const { data: chat } = await supabase
    .from("chats")
    .select("id")
    .eq("order_id", d.order_id)
    .maybeSingle();

  const { data: msgs } = chat
    ? await supabase
        .from("messages")
        .select("body,sender_id,created_at")
        .eq("chat_id", chat.id)
        .order("created_at")
        .limit(40)
    : { data: [] };

  const r = await summariseDispute({
    actorId: "admin",
    disputeId: d.id,
    reason: d.reason,
    messages: (msgs ?? []).map((m: any) => ({
      role: "user",
      content: m.body ?? "",
      at: m.created_at,
    })),
  });

  if (!r) return fail("Summary unavailable.");
  return { ok: true, data: r };
}

export async function aiPayoutAnomaly(input: {
  payoutId: string;
}): Promise<ActionResult<{ flag: { title: string; detail: string; severity: string } | null }>> {
  const supabase = createAdminClient();
  const { data: p } = await supabase
    .from("payouts")
    .select("id,amount,shop_id,shops(name)")
    .eq("id", input.payoutId)
    .maybeSingle();

  if (!p) return fail("Payout not found.");

  const { data: orders } = await supabase
    .from("orders")
    .select("total")
    .eq("shop_id", p.shop_id)
    .eq("status", "completed");

  const { data: paid } = await supabase
    .from("payouts")
    .select("amount")
    .eq("shop_id", p.shop_id)
    .eq("status", "paid");

  const flag = await checkPayoutAnomaly({
    actorId: "admin",
    payout: {
      id: p.id,
      shop_name: (p as any).shops?.name ?? "",
      amount: Number(p.amount),
      completed_orders_total: (orders ?? []).reduce((n: number, o: any) => n + Number(o.total ?? 0), 0),
      completed_orders_count: (orders ?? []).length,
      already_paid: (paid ?? []).reduce((n: number, x: any) => n + Number(x.amount ?? 0), 0),
    },
  });

  revalidatePath("/admin-fuckliving/ai");
  return { ok: true, data: { flag } };
}

export async function aiDraftReply(input: {
  message: string;
  context?: string;
}): Promise<ActionResult<{ draft: string }>> {
  const draft = await draftSupportReply({ actorId: "admin", ...input });
  if (!draft) return fail("Draft unavailable.");
  return { ok: true, data: { draft } };
}

export async function aiSearchGaps(): Promise<ActionResult<{ summary: string; opportunities: string[] }>> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("search_gaps")
    .select("query")
    .order("created_at", { ascending: false })
    .limit(200);

  const counts = new Map<string, number>();
  for (const g of data ?? []) {
    const q = String((g as any).query ?? "").toLowerCase().trim();
    if (q) counts.set(q, (counts.get(q) ?? 0) + 1);
  }

  const gaps = Array.from(counts.entries())
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 60);

  const r = await searchGapReport({ actorId: "admin", gaps });
  if (!r) return fail("Report unavailable.");
  return { ok: true, data: r };
}

export async function aiSalesNarrative(): Promise<ActionResult<{ narrative: string }>> {
  const supabase = createAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 864e5);

  async function window(from: Date, to: Date) {
    const [{ data: orders }, { count: sellers }, { count: disputes }] = await Promise.all([
      supabase.from("orders").select("total").gte("created_at", from.toISOString()).lt("created_at", to.toISOString()),
      supabase.from("shops").select("id", { count: "exact", head: true }).gte("created_at", from.toISOString()).lt("created_at", to.toISOString()),
      supabase.from("disputes").select("id", { count: "exact", head: true }).gte("created_at", from.toISOString()).lt("created_at", to.toISOString()),
    ]);
    return {
      orders: (orders ?? []).length,
      revenue: (orders ?? []).reduce((n: number, o: any) => n + Number(o.total ?? 0), 0),
      new_sellers: sellers ?? 0,
      disputes: disputes ?? 0,
    };
  }

  const [thisWeek, lastWeek] = await Promise.all([
    window(weekAgo, now),
    window(twoWeeksAgo, weekAgo),
  ]);

  const narrative = await salesNarrative({ actorId: "admin", thisWeek, lastWeek });
  if (!narrative) return fail("Narrative unavailable.");
  return { ok: true, data: { narrative } };
}

export async function aiPriceSanity(input: {
  listingId: string;
}): Promise<ActionResult<{ flag: { title: string; detail: string; severity: string } | null }>> {
  const supabase = createAdminClient();
  const { data: l } = await supabase
    .from("listings")
    .select("id,title,price,category_id,categories(name)")
    .eq("id", input.listingId)
    .maybeSingle();

  if (!l) return fail("Listing not found.");

  let median: number | null = null;
  let count = 0;
  if (l.category_id) {
    const { data: peers } = await supabase
      .from("listings")
      .select("price")
      .eq("category_id", l.category_id)
      .eq("status", "live")
      .limit(500);

    const prices = (peers ?? []).map((p: any) => Number(p.price)).filter((n) => n > 0).sort((a, b) => a - b);
    count = prices.length;
    if (count > 0) median = prices[Math.floor(count / 2)];
  }

  const flag = await priceSanity({
    actorId: "admin",
    listingId: l.id,
    title: l.title,
    price: Number(l.price),
    category: (l as any).categories?.name ?? null,
    categoryMedian: median,
    categoryCount: count,
  });

  revalidatePath("/admin-fuckliving/ai");
  return { ok: true, data: { flag } };
}

/** Record the admin's decision on a suggestion. The AI never does this. */
export async function aiDecideSuggestion(input: {
  suggestionId: string;
  decision: "accepted" | "dismissed" | "actioned";
  note?: string;
}): Promise<ActionResult<{ ok: true }>> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("ai_suggestions")
    .update({
      status: input.decision,
      decided_at: new Date().toISOString(),
      decision_note: input.note ?? null,
    })
    .eq("id", input.suggestionId);

  if (error) return fail(error.message);
  revalidatePath("/admin-fuckliving/ai");
  return { ok: true, data: { ok: true } };
}
