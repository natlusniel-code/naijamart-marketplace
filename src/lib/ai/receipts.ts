import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { askAI, logDecision } from "./client";
import {
  evaluateReceipt,
  fallbackOutcome,
  type ExtractedReceipt,
  type PaymentContext,
  type RuleConfig,
  type RulesOutcome,
} from "./rules";

/**
 * Receipt verification — Part 3 of the spec.
 *
 * ── The division of labour ──────────────────────────────────────────────────
 *   AI    → reads the image, returns fields + per-field confidence
 *   CODE  → applies the eight rules against the database
 *   HUMAN → decides anything the rules did not auto-approve
 *
 * The AI never approves a payment. `ai_auto_approve_payment()` is the only
 * function that can mark a payment paid from this path, and it re-checks the
 * amount, the cap and the reference uniqueness itself — so even a compromised
 * or hallucinating model cannot push a payment through.
 *
 * ── Failure is a supported state ────────────────────────────────────────────
 * If the AI is down, slow, rate-limited or over quota, `verifyReceipt()` still
 * returns a result: the payment goes to the human queue with a clear reason.
 * The buyer sees "we're confirming your payment", never an error.
 */

const EXTRACTION_SYSTEM = `You are a payment-receipt reader for a Nigerian marketplace.

Read the receipt image and return ONLY a JSON object with these keys:

{
  "amount": number | null,              // the amount paid, digits only, no currency symbol
  "txn_at": string | null,              // ISO 8601 timestamp of the transaction
  "sender_name": string | null,         // who sent the money
  "bank_name": string | null,           // the bank the money was sent TO
  "account_name": string | null,        // the account name the money was sent TO
  "account_number": string | null,      // the account number the money was sent TO
  "txn_reference": string | null,       // the transaction reference / session ID
  "success_wording": string | null,     // the exact success phrase printed on the receipt
  "field_confidence": {                 // 0.0 to 1.0 for EACH field above
    "amount": number, "txn_at": number, "sender_name": number,
    "bank_name": number, "account_name": number, "account_number": number,
    "txn_reference": number, "success_wording": number
  },
  "tamper_signals": string[],           // e.g. "mismatched fonts around the amount"
  "tamper_score": number                // 0.0 clean .. 1.0 clearly edited
}

Rules:
- If a field is not visible or not legible, return null for it and a LOW confidence.
- Never guess an amount, a reference or an account name. A wrong guess is worse
  than a null, because a null sends the payment to a human.
- "tamper_signals" describes visual evidence only: mismatched fonts, misaligned
  text, inconsistent background, seams or boxes around the amount, a screenshot
  of a screenshot. A plain phone screenshot of a real receipt is NOT tampering.
- Return JSON only. No prose, no markdown.`;

const EXTRACTION_SCHEMA = `{ amount, txn_at, sender_name, bank_name, account_name,
account_number, txn_reference, success_wording, field_confidence{}, tamper_signals[], tamper_score }`;

export type VerifyResult = {
  receiptId: string | null;
  outcome: RulesOutcome;
  autoApproved: boolean;
  aiAvailable: boolean;
  aiReason?: string;
};

/** Load the rule config from platform_settings, with safe defaults. */
async function loadConfig(): Promise<RuleConfig> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("platform_settings")
      .select("ai_auto_approve_max,receipt_window_minutes,ai_min_confidence")
      .eq("id", 1)
      .maybeSingle();

    return {
      autoApproveMax: Number(data?.ai_auto_approve_max ?? 100000),
      windowMinutes: Number(data?.receipt_window_minutes ?? 30),
      minConfidence: Number(data?.ai_min_confidence ?? 0.75),
    };
  } catch {
    return { autoApproveMax: 100000, windowMinutes: 30, minConfidence: 0.75 };
  }
}

/** The active admin accounts a receipt may legitimately have been paid into. */
async function loadAdminAccounts() {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("payment_accounts")
      .select("bank_name,account_name,account_number")
      .eq("active", true);
    return (data ?? []) as PaymentContext["adminAccounts"];
  } catch {
    return [];
  }
}

/** Has this reference been claimed before? */
async function referenceUsed(reference: string | null): Promise<boolean> {
  if (!reference) return false;
  try {
    const supabase = createAdminClient();
    const norm = reference.replace(/\s+/g, "").toUpperCase();
    const { data } = await supabase
      .from("used_transaction_references")
      .select("reference")
      .eq("reference", norm)
      .maybeSingle();
    return !!data;
  } catch {
    // If we cannot check, treat it as used — the safe direction. A false
    // "used" sends the payment to a human; a false "new" could double-credit.
    return true;
  }
}

/**
 * Verify one receipt.
 *
 * `paymentId` must already exist (created by `submit_receipt`). The receipt
 * image URL is what the buyer uploaded.
 */
export async function verifyReceipt(opts: {
  paymentId: string;
  imageUrl: string;
  actorId: string;
  actorRole?: string;
}): Promise<VerifyResult> {
  const supabase = createAdminClient();

  // ── Load the payment. If it is gone, there is nothing to verify. ──────
  const { data: pay } = await supabase
    .from("payments")
    .select("id,type,amount,order_id,shop_id,status")
    .eq("id", opts.paymentId)
    .maybeSingle();

  if (!pay) {
    return {
      receiptId: null,
      outcome: fallbackOutcome("payment not found"),
      autoApproved: false,
      aiAvailable: false,
      aiReason: "payment not found",
    };
  }

  // Already settled — do not re-read, do not re-approve.
  if (pay.status === "verified") {
    return {
      receiptId: null,
      outcome: {
        passed: true,
        results: [],
        failedRule: null,
        outcome: "auto_approved",
        buyerMessage: "This payment is already confirmed.",
      },
      autoApproved: false,
      aiAvailable: true,
    };
  }

  const [config, adminAccounts] = await Promise.all([loadConfig(), loadAdminAccounts()]);

  // ── Ask the AI to read the image ──────────────────────────────────────
  const ai = await askAI<ExtractedReceipt>({
    feature: "receipt_extract",
    actorId: opts.actorId,
    actorRole: opts.actorRole,
    system: EXTRACTION_SYSTEM,
    input: {
      image_url: opts.imageUrl,
      // The site's own data travels with the request. Teamily never queries
      // our database; it only sees what we hand it.
      expected_amount: Number(pay.amount),
      payment_kind: pay.type,
    },
    inputSummary: `receipt for payment ${opts.paymentId}`,
    inputRef: opts.paymentId,
    schemaHint: EXTRACTION_SCHEMA,
    // Never cache a receipt read: the same image must be re-read for a new
    // payment, and a cached verdict would let a replay reuse an approval.
    bypassCache: true,
  });

  // ── AI unavailable: human queue, no error shown to the buyer ──────────
  if (!ai.ok) {
    const outcome = fallbackOutcome(ai.reason);
    const receiptId = await persistReceipt({
      paymentId: opts.paymentId,
      orderId: pay.order_id,
      shopId: pay.shop_id,
      kind: pay.type,
      imageUrl: opts.imageUrl,
      extracted: null,
      outcome,
      aiAvailable: false,
      aiModel: null,
      latencyMs: ai.latencyMs,
    });

    await logDecision({
      feature: "receipt_extract",
      actorId: opts.actorId,
      actorRole: opts.actorRole,
      inputRef: opts.paymentId,
      codeDecision: "awaiting_confirmation",
      codeReason: `AI unavailable: ${ai.reason}`,
    });

    return {
      receiptId,
      outcome,
      autoApproved: false,
      aiAvailable: false,
      aiReason: ai.reason,
    };
  }

  // ── Normalise the extraction ──────────────────────────────────────────
  const extracted: ExtractedReceipt = {
    amount: numOrNull(ai.data.amount),
    txn_at: ai.data.txn_at ?? null,
    sender_name: ai.data.sender_name ?? null,
    bank_name: ai.data.bank_name ?? null,
    account_name: ai.data.account_name ?? null,
    account_number: ai.data.account_number ?? null,
    txn_reference: ai.data.txn_reference ?? null,
    success_wording: ai.data.success_wording ?? null,
    field_confidence: ai.data.field_confidence ?? {},
    tamper_signals: Array.isArray(ai.data.tamper_signals) ? ai.data.tamper_signals : [],
    tamper_score: numOrNull(ai.data.tamper_score),
  };

  // ── Apply the eight rules in code ─────────────────────────────────────
  const alreadyUsed = await referenceUsed(extracted.txn_reference);
  const outcome = evaluateReceipt(
    extracted,
    {
      paymentId: opts.paymentId,
      amount: Number(pay.amount),
      kind: pay.type,
      adminAccounts,
      referenceAlreadyUsed: alreadyUsed,
    },
    config,
    new Date(),
  );

  const receiptId = await persistReceipt({
    paymentId: opts.paymentId,
    orderId: pay.order_id,
    shopId: pay.shop_id,
    kind: pay.type,
    imageUrl: opts.imageUrl,
    extracted,
    outcome,
    aiAvailable: true,
    aiModel: ai.model,
    latencyMs: ai.latencyMs,
  });

  // ── Auto-approve only through the RPC, which re-checks everything ─────
  let autoApproved = false;
  if (outcome.passed && receiptId) {
    const { data, error } = await supabase.rpc("ai_auto_approve_payment", {
      p_payment_id: opts.paymentId,
      p_receipt_id: receiptId,
    });
    const row = Array.isArray(data) ? data[0] : data;
    autoApproved = !error && !!row?.approved;

    if (!autoApproved) {
      // The RPC refused (e.g. the reference was claimed between our check and
      // the call). Downgrade to the human queue rather than claim success.
      await supabase
        .from("payment_receipts")
        .update({
          outcome: "awaiting_confirmation",
          outcome_reason: row?.reason ?? error?.message ?? "auto-approval refused",
        })
        .eq("id", receiptId);
    }
  }

  await logDecision({
    feature: "receipt_extract",
    actorId: opts.actorId,
    actorRole: opts.actorRole,
    inputRef: opts.paymentId,
    codeDecision: autoApproved ? "auto_approved" : "awaiting_confirmation",
    codeReason: outcome.failedRule ?? "all rules passed",
    output: { results: outcome.results },
  });

  return {
    receiptId,
    outcome,
    autoApproved,
    aiAvailable: true,
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

/** Write the receipt row. Returns its id, or null if the insert failed. */
async function persistReceipt(opts: {
  paymentId: string;
  orderId: string | null;
  shopId: string | null;
  kind: "order" | "subscription";
  imageUrl: string;
  extracted: ExtractedReceipt | null;
  outcome: RulesOutcome;
  aiAvailable: boolean;
  aiModel: string | null;
  latencyMs: number;
}): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("payment_receipts")
      .insert({
        payment_id: opts.paymentId,
        order_id: opts.orderId,
        shop_id: opts.shopId,
        kind: opts.kind,
        image_url: opts.imageUrl,
        amount: opts.extracted?.amount ?? null,
        txn_at: opts.extracted?.txn_at ?? null,
        sender_name: opts.extracted?.sender_name ?? null,
        bank_name: opts.extracted?.bank_name ?? null,
        account_name: opts.extracted?.account_name ?? null,
        account_number: opts.extracted?.account_number ?? null,
        txn_reference: opts.extracted?.txn_reference ?? null,
        success_wording: opts.extracted?.success_wording ?? null,
        field_confidence: opts.extracted?.field_confidence ?? {},
        tamper_signals: opts.extracted?.tamper_signals ?? [],
        tamper_score: opts.extracted?.tamper_score ?? null,
        rule_results: opts.outcome.results,
        rules_passed: opts.outcome.passed,
        failed_rule: opts.outcome.failedRule,
        outcome: opts.outcome.outcome,
        outcome_reason: opts.outcome.failedRule ?? null,
        ai_model: opts.aiModel,
        ai_latency_ms: opts.latencyMs,
        ai_available: opts.aiAvailable,
      })
      .select("id")
      .single();

    if (error) {
      console.error("payment_receipts insert failed:", error.message);
      return null;
    }
    return data.id as string;
  } catch (e) {
    console.error("payment_receipts insert threw:", e);
    return null;
  }
}
