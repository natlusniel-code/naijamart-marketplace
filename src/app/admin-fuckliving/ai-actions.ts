"use server";

/**
 * Admin actions for the seller plans and the AI surfaces.
 *
 * ── Why these are separate from `actions.ts` ─────────────────────────────
 * `actions.ts` is already ~600 lines of order/payment/payout logic. The
 * plan editor and the AI queue are a different concern with a different
 * failure mode (a bad price, a model that is down), so they live here and
 * are imported by the components that need them.
 *
 * ── Why the service role ─────────────────────────────────────────────────
 * Same reason as `actions.ts`: the `admin_*` RPCs open with
 * `if not public.is_admin()`, and a server action has no `auth.uid()`. The
 * key itself is the authorisation, and it never reaches the browser.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient, hasAdminKey } from "@/lib/supabase/admin";
import { checkListing, checkShop, checkReview } from "@/lib/ai-safety";
import { analyseShopQuality } from "@/lib/ai-quality";
import { generateSellerInsights } from "@/lib/ai-seller-insights";
import { askCopilot } from "@/lib/ai-copilot";

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

/* ────────────────────────────────────────────────────────────────────────
 * Seller plans
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Save a plan's price and tagline.
 *
 * Writes `seller_plans` directly (the service role bypasses the
 * `is_admin()` guard on the RPC) and keeps the legacy flat price in step
 * for Premium, so nothing that still reads `platform_settings` disagrees.
 */
export async function saveSellerPlan(input: {
  id: string;
  price: number;
  tagline: string;
}): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  if (!["basic", "premium"].includes(input.id)) {
    return { ok: false, error: "Unknown plan." };
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    return { ok: false, error: "A plan price cannot be negative." };
  }

  try {
    const supabase = createAdminClient();

    const { error } = await supabase
      .from("seller_plans")
      .update({
        price: input.price,
        tagline: input.tagline.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);

    if (error) return fail(error);

    // Keep the legacy column pointing at Premium.
    if (input.id === "premium") {
      await supabase
        .from("platform_settings")
        .update({ subscription_price: input.price })
        .eq("id", 1);
    }

    revalidatePath("/admin-fuckliving/settings");
    revalidatePath("/seller/subscription");
    revalidatePath("/seller/onboarding");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Activate a seller's subscription after their transfer has been seen.
 *
 * This is the ONLY path that sets `subscription_status = 'active'`. The
 * seller's own `choose_seller_plan` can only reach 'pending' — 0038's guard
 * reverts anything else — so a seller cannot grant themselves Premium.
 */
export async function confirmSubscription(input: {
  shopId: string;
  days?: number;
}): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  const days = input.days ?? 30;
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    return { ok: false, error: "A subscription period must be 1–366 days." };
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.rpc("admin_confirm_subscription", {
      p_shop_id: input.shopId,
      p_days: days,
    });
    if (error) return fail(error);

    revalidatePath("/admin-fuckliving/settings");
    revalidatePath("/admin-fuckliving/sellers");
    revalidatePath("/seller/subscription");
    revalidatePath("/seller/analytics");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Trust & safety
 * ──────────────────────────────────────────────────────────────────────── */

/** Run a safety check on one subject and store the report. */
export async function runSafetyCheck(input: {
  subjectType: "listing" | "shop" | "review";
  subjectId: string;
}): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  try {
    const report =
      input.subjectType === "listing"
        ? await checkListing(input.subjectId)
        : input.subjectType === "shop"
          ? await checkShop(input.subjectId)
          : await checkReview(input.subjectId);

    if (!report) {
      return { ok: false, error: "The AI could not analyse that. Try again in a moment." };
    }

    revalidatePath("/admin-fuckliving/safety");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Move a report through the admin workflow. */
export async function setSafetyReportStatus(input: {
  id: string;
  status: "open" | "reviewed" | "actioned" | "dismissed";
}): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("ai_safety_reports")
      .update({
        status: input.status,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", input.id);

    if (error) return fail(error);
    revalidatePath("/admin-fuckliving/safety");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Quality + insights
 * ──────────────────────────────────────────────────────────────────────── */

/** Re-run the quality analysis for a shop. */
export async function refreshShopQuality(shopId: string): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  try {
    const analysis = await analyseShopQuality(shopId);
    if (!analysis) {
      return { ok: false, error: "That shop has no reviews or orders to analyse yet." };
    }
    revalidatePath("/admin-fuckliving/sellers");
    revalidatePath("/seller/analytics");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Re-generate the AI insights for a shop. */
export async function refreshSellerInsights(shopId: string): Promise<ActionResult> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  try {
    const insights = await generateSellerInsights(shopId);
    if (insights.length === 0) {
      return { ok: false, error: "There is not enough data to generate insights yet." };
    }
    revalidatePath("/seller/analytics");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Copilot
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Ask the copilot a question.
 *
 * Returns the answer and the data it was based on, so the admin can check
 * the working rather than trusting a sentence.
 */
export async function askAdminCopilot(input: {
  question: string;
  history?: { role: "user" | "assistant"; body: string }[];
}): Promise<{ ok: boolean; answer?: string; tools?: unknown; data?: unknown; error?: string }> {
  if (!hasAdminKey) return { ok: false, error: NO_KEY };

  try {
    const result = await askCopilot(input.question, input.history ?? []);
    return {
      ok: true,
      answer: result.answer,
      tools: result.tools,
      data: result.data,
    };
  } catch (error) {
    const f = fail(error);
    return { ok: false, error: f.error };
  }
}
