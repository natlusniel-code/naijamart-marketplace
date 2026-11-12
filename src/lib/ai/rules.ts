/**
 * The payment rules engine.
 *
 * ── Why this file is pure ───────────────────────────────────────────────────
 * Every decision here is a function of its arguments. No database, no network,
 * no clock read except the `now` you pass in. That is what makes the eight
 * checks testable, auditable and explainable: given a receipt and a payment,
 * the outcome is reproducible, and the admin screen can show exactly which rule
 * failed and why.
 *
 * ── The eight checks (Part 3, Step 2) ───────────────────────────────────────
 *   1. Amount      — receipt amount exactly equals the payment amount
 *   2. Time        — receipt timestamp within N minutes before now, same date
 *   3. Account     — bank + account name match an ACTIVE admin account
 *   4. Wording     — receipt contains a success phrase
 *   5. Reference   — never used before
 *   6. Integrity   — editing signals lower confidence (risk, not pass/fail)
 *   7. Confidence  — every extracted field meets the minimum
 *   8. Cap         — auto-approval only at or below the cap
 *
 * ── The outcome is never "reject" ───────────────────────────────────────────
 * A failed rule produces `awaiting_confirmation`, never a rejection. A human
 * decides. The only two outcomes this engine can produce are "auto-approve"
 * and "send to a human".
 */

export type ExtractedReceipt = {
  amount: number | null;
  txn_at: string | null; // ISO timestamp
  sender_name: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  txn_reference: string | null;
  success_wording: string | null;
  field_confidence: Record<string, number>;
  tamper_signals: string[];
  tamper_score: number | null;
};

export type PaymentContext = {
  paymentId: string;
  amount: number;
  kind: "order" | "subscription";
  /** Active admin accounts the money could legitimately have been sent to. */
  adminAccounts: { bank_name: string; account_name: string; account_number: string }[];
  /** True when the reference has already been claimed in the database. */
  referenceAlreadyUsed: boolean;
};

export type RuleConfig = {
  /** Payments at or below this may auto-approve. */
  autoApproveMax: number;
  /** How far back a receipt may be. */
  windowMinutes: number;
  /** Minimum confidence for every extracted field. */
  minConfidence: number;
};

export type RuleResult = {
  rule: string;
  label: string;
  passed: boolean;
  detail: string;
  /** True when this rule alone blocks auto-approval. */
  blocking: boolean;
};

export type RulesOutcome = {
  passed: boolean;
  results: RuleResult[];
  failedRule: string | null;
  /** 'auto_approved' | 'awaiting_confirmation' */
  outcome: "auto_approved" | "awaiting_confirmation";
  /** Human-readable summary for the buyer. */
  buyerMessage: string;
};

const SUCCESS_PHRASES = [
  "transaction successful",
  "payment successful",
  "successful",
  "transfer successful",
  "completed successfully",
];

/** Normalise a name for comparison: case, punctuation and spacing. */
function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalise a bank name: "Opay" / "OPay" / "OPay Digital" all match. */
function normBank(s: string | null | undefined): string {
  return normName(s).replace(/\b(bank|plc|ltd|limited|digital|services|mfbank|microfinance)\b/g, "").replace(/\s+/g, " ").trim();
}

/** Digits only, so "0410 679 023" matches "0410679023". */
function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "");
}

/**
 * Do two account names refer to the same account holder?
 *
 * Exact match after normalisation, OR one is a token-subset of the other with
 * at least two shared tokens. The subset rule exists because receipts often
 * print "ANIFOWOSE MUTIU" where the admin list says "Anifowose Mutiu Ayinde" —
 * same person, truncated by the receipt layout. Requiring two shared tokens
 * stops "John" matching "John Doe" on a single common first name.
 */
function namesMatch(a: string | null, b: string | null): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const smaller = Math.min(ta.size, tb.size);
  return shared >= 2 && shared >= smaller;
}

/**
 * Run the eight checks.
 *
 * `now` is injected so tests can pin the clock. In production the caller passes
 * `new Date()`.
 */
export function evaluateReceipt(
  receipt: ExtractedReceipt,
  payment: PaymentContext,
  config: RuleConfig,
  now: Date = new Date(),
): RulesOutcome {
  const results: RuleResult[] = [];

  // ── 1. Amount ─────────────────────────────────────────────────────────
  const amountOk =
    receipt.amount != null &&
    Math.abs(Number(receipt.amount) - Number(payment.amount)) < 0.01;
  results.push({
    rule: "amount",
    label: "Amount matches",
    passed: amountOk,
    detail: amountOk
      ? `Receipt shows ${receipt.amount}, payment is ${payment.amount}.`
      : receipt.amount == null
        ? "The amount could not be read from the receipt."
        : `Receipt shows ${receipt.amount} but the payment is ${payment.amount}.`,
    blocking: true,
  });

  // ── 2. Time ───────────────────────────────────────────────────────────
  let timeOk = false;
  let timeDetail = "The transaction time could not be read from the receipt.";
  if (receipt.txn_at) {
    const txn = new Date(receipt.txn_at);
    if (!isNaN(txn.getTime())) {
      const diffMs = now.getTime() - txn.getTime();
      const diffMin = diffMs / 60000;
      const sameDate =
        txn.getFullYear() === now.getFullYear() &&
        txn.getMonth() === now.getMonth() &&
        txn.getDate() === now.getDate();

      // Within the window BEFORE now. A receipt dated in the future is not
      // accepted: that is either a clock problem or a fabricated receipt.
      const withinWindow = diffMin >= -1 && diffMin <= config.windowMinutes;

      timeOk = sameDate && withinWindow;
      timeDetail = timeOk
        ? `Paid ${Math.round(diffMin)} minute(s) ago, today.`
        : !sameDate
          ? `The receipt is dated ${txn.toDateString()}, not today.`
          : diffMin < -1
            ? "The receipt is dated in the future."
            : `The receipt is ${Math.round(diffMin)} minutes old; the limit is ${config.windowMinutes}.`;
    }
  }
  results.push({
    rule: "time",
    label: "Paid within the time window",
    passed: timeOk,
    detail: timeDetail,
    blocking: true,
  });

  // ── 3. Account match (HARD RULE) ──────────────────────────────────────
  // The receipt's bank AND account name must match one of the admin's active
  // accounts. This is the rule that actually protects the platform: a
  // fraudster cannot fake a transfer into an account the platform does not own.
  const matchedAccount = payment.adminAccounts.find((a) => {
    const bankOk = normBank(a.bank_name) === normBank(receipt.bank_name);
    const nameOk = namesMatch(a.account_name, receipt.account_name);
    // If the receipt printed an account number, it must also agree.
    const numOk =
      !receipt.account_number ||
      !a.account_number ||
      digits(a.account_number) === digits(receipt.account_number);
    return bankOk && nameOk && numOk;
  });

  results.push({
    rule: "account",
    label: "Paid into a NaijaMart account",
    passed: !!matchedAccount,
    detail: matchedAccount
      ? `Matched ${matchedAccount.bank_name} — ${matchedAccount.account_name}.`
      : payment.adminAccounts.length === 0
        ? "No active payment accounts are configured, so this cannot be checked."
        : `The receipt's account (${receipt.bank_name ?? "unknown bank"} / ${receipt.account_name ?? "unknown name"}) does not match any active NaijaMart account.`,
    blocking: true,
  });

  // ── 4. Success wording ────────────────────────────────────────────────
  const wording = (receipt.success_wording ?? "").toLowerCase();
  const wordingOk = SUCCESS_PHRASES.some((p) => wording.includes(p));
  results.push({
    rule: "wording",
    label: "Receipt says the transfer succeeded",
    passed: wordingOk,
    detail: wordingOk
      ? `Found "${receipt.success_wording}".`
      : "No success wording was found on the receipt.",
    blocking: true,
  });

  // ── 5. Reference uniqueness ───────────────────────────────────────────
  const refOk = !!receipt.txn_reference && !payment.referenceAlreadyUsed;
  results.push({
    rule: "reference",
    label: "Transaction reference is new",
    passed: refOk,
    detail: !receipt.txn_reference
      ? "No transaction reference could be read from the receipt."
      : payment.referenceAlreadyUsed
        ? `Reference ${receipt.txn_reference} has already been used on another payment.`
        : `Reference ${receipt.txn_reference} has not been seen before.`,
    blocking: true,
  });

  // ── 6. Image integrity (RISK SIGNAL, not pass/fail) ───────────────────
  // Deliberately non-blocking. A phone screenshot of a genuine receipt often
  // trips these signals, so treating them as a hard fail would reject real
  // payments. They lower confidence instead, and the confidence rule below is
  // what actually blocks.
  const tamper = receipt.tamper_score ?? 0;
  const tamperHigh = tamper >= 0.6;
  results.push({
    rule: "integrity",
    label: "No strong signs of editing",
    passed: !tamperHigh,
    detail:
      receipt.tamper_signals.length === 0
        ? "No editing signals were reported."
        : `${receipt.tamper_signals.length} signal(s): ${receipt.tamper_signals.join("; ")}.`,
    // Non-blocking: this rule informs the human, it does not decide.
    blocking: false,
  });

  // ── 7. Confidence ─────────────────────────────────────────────────────
  const required = [
    "amount",
    "txn_at",
    "bank_name",
    "account_name",
    "txn_reference",
  ];
  const lowFields = required.filter((f) => {
    const c = receipt.field_confidence?.[f];
    return typeof c !== "number" || c < config.minConfidence;
  });
  // A high tamper score also drags the effective confidence down.
  const confidenceOk = lowFields.length === 0 && !tamperHigh;
  results.push({
    rule: "confidence",
    label: "Every field was read confidently",
    passed: confidenceOk,
    detail: confidenceOk
      ? "All required fields met the confidence threshold."
      : tamperHigh
        ? `The image shows strong editing signals (score ${tamper.toFixed(2)}), so it cannot be auto-approved.`
        : `Low confidence on: ${lowFields.join(", ")}.`,
    blocking: true,
  });

  // ── 8. Amount cap ─────────────────────────────────────────────────────
  const capOk = Number(payment.amount) <= config.autoApproveMax;
  results.push({
    rule: "cap",
    label: "Within the auto-approval limit",
    passed: capOk,
    detail: capOk
      ? `${payment.amount} is at or below the ${config.autoApproveMax} limit.`
      : `${payment.amount} is above the ${config.autoApproveMax} limit, so a human must approve it.`,
    blocking: true,
  });

  const failed = results.find((r) => r.blocking && !r.passed);
  const passed = !failed;

  return {
    passed,
    results,
    failedRule: failed ? failed.rule : null,
    outcome: passed ? "auto_approved" : "awaiting_confirmation",
    buyerMessage: passed
      ? "Payment confirmed. Your order is now with the seller."
      : "We're confirming your payment. This usually takes a few minutes — you'll be notified as soon as it clears.",
  };
}

/**
 * The non-AI fallback.
 *
 * When the AI is unavailable we cannot read the receipt, so we cannot
 * auto-approve. The payment goes to the human queue exactly as it did before
 * this feature existed. This function exists so the fallback is explicit and
 * testable rather than an accident of a null check.
 */
export function fallbackOutcome(reason: string): RulesOutcome {
  return {
    passed: false,
    results: [
      {
        rule: "ai_unavailable",
        label: "Receipt could not be read automatically",
        passed: false,
        detail: `Automatic reading was unavailable (${reason}). A human will check this receipt.`,
        blocking: true,
      },
    ],
    failedRule: "ai_unavailable",
    outcome: "awaiting_confirmation",
    buyerMessage:
      "We're confirming your payment. This usually takes a few minutes — you'll be notified as soon as it clears.",
  };
}
