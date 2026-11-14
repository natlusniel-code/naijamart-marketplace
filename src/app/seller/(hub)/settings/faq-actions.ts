"use server";

/**
 * Server actions for the seller's own FAQs.
 *
 * ── Why server actions and not direct client writes ──────────────────────
 * The FAQ rows are read by the AI reply on the server, and the seller's
 * editor must not be able to write against a shop they do not own. A
 * server action runs with the seller's own session, so RLS on
 * `seller_faqs` (sql/0041) is what enforces ownership — the client never
 * gets to name a shop id it does not own and have it stick.
 *
 * ── Why the Premium gate is re-checked here ──────────────────────────────
 * The editor is only RENDERED for a Premium seller, but rendering is not
 * authorisation: a Basic seller could still call the action directly. So
 * every write re-checks `seller_has_feature(shop, 'aiReply')` — the same
 * gate the AI reply itself uses. A Basic seller gets a clear refusal, not
 * a silent no-op.
 */

import { revalidatePath } from "next/cache";
import { getSession, createClient } from "@/lib/supabase/server";
import { shopHasFeature } from "@/lib/plan-gate";

export type FaqRow = {
  id: string;
  question: string;
  answer: string;
  sort_order: number;
};

export type FaqResult = {
  ok: boolean;
  error?: string;
  faqs?: FaqRow[];
};

/** The signed-in seller's shop, or null. */
async function currentShopId(): Promise<string | null> {
  const session = await getSession();
  return session?.shop?.id ?? null;
}

/**
 * The shop's FAQs, for the editor.
 *
 * Readable by the owner through RLS. Returns an empty list rather than an
 * error when there are none — an empty editor is the correct first state.
 */
export async function listFaqs(): Promise<FaqResult> {
  const shopId = await currentShopId();
  if (!shopId) return { ok: false, error: "Sign in as a seller first." };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("seller_faqs")
    .select("id,question,answer,sort_order")
    .eq("shop_id", shopId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return { ok: false, error: error.message };
  return { ok: true, faqs: (data ?? []) as FaqRow[] };
}

/**
 * Add one FAQ.
 *
 * Both fields are required and trimmed. The database has the same check
 * (sql/0041), so a blank row cannot be stored even if this is bypassed.
 */
export async function addFaq(input: {
  question: string;
  answer: string;
}): Promise<FaqResult> {
  const shopId = await currentShopId();
  if (!shopId) return { ok: false, error: "Sign in as a seller first." };

  const question = (input.question ?? "").trim();
  const answer = (input.answer ?? "").trim();
  if (!question) return { ok: false, error: "Write the question." };
  if (!answer) return { ok: false, error: "Write the answer." };

  // Premium-only, re-checked on the server.
  if (!(await shopHasFeature(shopId, "aiReply"))) {
    return { ok: false, error: "Seller FAQs are a Premium feature." };
  }

  const supabase = createClient();

  // Put the new FAQ at the end of the seller's list.
  const { data: last } = await supabase
    .from("seller_faqs")
    .select("sort_order")
    .eq("shop_id", shopId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort_order = (last?.sort_order ?? 0) + 1;

  const { error } = await supabase
    .from("seller_faqs")
    .insert({ shop_id: shopId, question, answer, sort_order });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/seller/settings");
  return listFaqs();
}

/** Edit one FAQ. Only the owning shop's rows are reachable through RLS. */
export async function updateFaq(input: {
  id: string;
  question: string;
  answer: string;
}): Promise<FaqResult> {
  const shopId = await currentShopId();
  if (!shopId) return { ok: false, error: "Sign in as a seller first." };

  const question = (input.question ?? "").trim();
  const answer = (input.answer ?? "").trim();
  if (!question) return { ok: false, error: "Write the question." };
  if (!answer) return { ok: false, error: "Write the answer." };

  if (!(await shopHasFeature(shopId, "aiReply"))) {
    return { ok: false, error: "Seller FAQs are a Premium feature." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("seller_faqs")
    .update({ question, answer })
    .eq("id", input.id)
    .eq("shop_id", shopId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/seller/settings");
  return listFaqs();
}

/** Delete one FAQ. */
export async function deleteFaq(id: string): Promise<FaqResult> {
  const shopId = await currentShopId();
  if (!shopId) return { ok: false, error: "Sign in as a seller first." };

  if (!(await shopHasFeature(shopId, "aiReply"))) {
    return { ok: false, error: "Seller FAQs are a Premium feature." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("seller_faqs")
    .delete()
    .eq("id", id)
    .eq("shop_id", shopId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/seller/settings");
  return listFaqs();
}
