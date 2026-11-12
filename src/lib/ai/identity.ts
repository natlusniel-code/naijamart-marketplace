import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { askAI, logDecision } from "./client";

/**
 * Seller identity verification — Part 4.
 *
 * ── What the AI is asked, and what it is NOT asked ──────────────────────────
 * The AI answers ONE question: "is this image genuinely a government identity
 * document, and can its key fields be read?" It is never asked whether the
 * person is trustworthy, whether the name matches the shop, or whether the
 * seller should be approved. Those are code and human decisions.
 *
 * ── The three outcomes ──────────────────────────────────────────────────────
 *   genuine + confident   → document accepted, subscription page unlocks
 *   not an identity doc   → clear message, subscription page stays locked
 *   unclear / low conf.   → admin review queue, neither approved nor rejected
 *
 * ── The gate that matters ───────────────────────────────────────────────────
 * `shops.verified` is set only by `ai_apply_identity_verdict()` on a genuine
 * document. `shops.subscription_status` is a SEPARATE flag set by payment.
 * A seller can pay and still fail identity — that is the point of keeping them
 * apart, and it is why the subscription page checks `verified` before it
 * renders the plan.
 */

const IDENTITY_SYSTEM = `You are an identity-document checker for a Nigerian marketplace.

You are shown ONE uploaded image. Decide whether it is genuinely a government
identity document, and whether its key fields are readable.

Return ONLY this JSON:

{
  "is_identity_doc": boolean,     // true only if this really is an ID document
  "detected_type": "nin_slip" | "national_id" | "drivers_licence" | "passport" | "voters_card" | "cac" | "unknown",
  "name_readable": boolean,       // is a person's name legible on it
  "number_readable": boolean,     // is the document number legible
  "photo_present": boolean,       // is there a photo where one is expected
  "tamper_signals": string[],     // e.g. "screenshot of a template", "text pasted over photo"
  "confidence": number,           // 0.0 to 1.0 in YOUR OWN verdict
  "reason": string                // one short sentence, shown to the seller
}

Rules:
- A photo of a person, a product, a receipt, a screenshot of a website, a blank
  page or a template with no personal details is NOT an identity document.
  Set is_identity_doc false and say so plainly in "reason".
- A heavily cropped, blurred or glare-covered document is NOT a confident
  approval. Set confidence low; the caller sends it to a human.
- Do not judge whether the person is trustworthy, whether the name matches a
  shop, or whether the seller should be approved. You only read the document.
- Return JSON only. No prose, no markdown.`;

const IDENTITY_SCHEMA = `{ is_identity_doc, detected_type, name_readable, number_readable,
photo_present, tamper_signals[], confidence, reason }`;

export type IdentityVerdict = {
  status: "ai_approved" | "needs_review" | "rejected_image";
  message: string;
  verificationId: string | null;
  aiAvailable: boolean;
  /** True only when the document was accepted. Gates the subscription page. */
  documentAccepted: boolean;
};

type AIIdentity = {
  is_identity_doc?: boolean;
  detected_type?: string;
  name_readable?: boolean;
  number_readable?: boolean;
  photo_present?: boolean;
  tamper_signals?: string[];
  confidence?: number;
  reason?: string;
};

const VALID_TYPES = new Set([
  "nin_slip",
  "national_id",
  "drivers_licence",
  "passport",
  "voters_card",
  "cac",
  "unknown",
]);

/**
 * Check one uploaded identity document.
 *
 * Never throws. When the AI is unavailable the document goes to the human
 * queue — the seller is told it is being checked, not that it failed.
 */
export async function checkIdentityDocument(opts: {
  shopId: string;
  ownerId: string;
  imageUrl: string;
  declaredType?: string;
  actorRole?: string;
}): Promise<IdentityVerdict> {
  const supabase = createAdminClient();

  const ai = await askAI<AIIdentity>({
    feature: "identity_check",
    actorId: opts.ownerId,
    actorRole: opts.actorRole ?? "seller",
    system: IDENTITY_SYSTEM,
    input: {
      image_url: opts.imageUrl,
      // The seller's own declaration travels with the request so the model can
      // say "you said NIN slip, this is a passport" — but the verdict is still
      // about the image, not the claim.
      declared_type: opts.declaredType ?? "unknown",
    },
    inputSummary: `identity document for shop ${opts.shopId}`,
    inputRef: opts.shopId,
    schemaHint: IDENTITY_SCHEMA,
    // Never cache: a re-upload of the same file must be re-read.
    bypassCache: true,
  });

  // ── AI unavailable → human queue ──────────────────────────────────────
  if (!ai.ok) {
    const id = await persist({
      shopId: opts.shopId,
      ownerId: opts.ownerId,
      imageUrl: opts.imageUrl,
      declaredType: opts.declaredType,
      status: "needs_review",
      aiReason: `Automatic check unavailable (${ai.reason}).`,
      aiAvailable: false,
    });

    await logDecision({
      feature: "identity_check",
      actorId: opts.ownerId,
      actorRole: opts.actorRole ?? "seller",
      inputRef: opts.shopId,
      codeDecision: "needs_review",
      codeReason: `AI unavailable: ${ai.reason}`,
    });

    return {
      status: "needs_review",
      message:
        "We've received your document and a person will check it shortly. You'll be notified when it's done.",
      verificationId: id,
      aiAvailable: false,
      documentAccepted: false,
    };
  }

  const d = ai.data;
  const confidence = typeof d.confidence === "number" ? d.confidence : 0;
  const isDoc = d.is_identity_doc === true;
  const readable = d.name_readable === true && d.number_readable === true;
  const tamper = Array.isArray(d.tamper_signals) ? d.tamper_signals : [];
  const detected = VALID_TYPES.has(String(d.detected_type)) ? String(d.detected_type) : "unknown";

  // ── Code decides, not the model ───────────────────────────────────────
  // 1. Not a document at all → tell the seller plainly, do not queue it.
  // 2. A document but unreadable / low confidence / tampered → human queue.
  // 3. A document, readable, confident, clean → accept.
  let status: IdentityVerdict["status"];
  let message: string;

  if (!isDoc) {
    status = "rejected_image";
    message =
      "That image is not an identity confirmation image. Please upload a valid ID, NIN slip, or driver's licence.";
  } else if (!readable || confidence < 0.7 || tamper.length > 0) {
    status = "needs_review";
    message =
      "We've received your document and a person will check it shortly. You'll be notified when it's done.";
  } else {
    status = "ai_approved";
    message = "Your identity document was accepted.";
  }

  const id = await persist({
    shopId: opts.shopId,
    ownerId: opts.ownerId,
    imageUrl: opts.imageUrl,
    declaredType: opts.declaredType,
    status,
    detectedType: detected,
    isDoc,
    nameReadable: d.name_readable === true,
    numberReadable: d.number_readable === true,
    photoPresent: d.photo_present === true,
    tamperSignals: tamper,
    confidence,
    aiReason: d.reason ?? null,
    aiAvailable: true,
    aiModel: ai.model,
  });

  // ── Apply the verdict through the RPC ─────────────────────────────────
  if (id && status === "ai_approved") {
    await supabase.rpc("ai_apply_identity_verdict", {
      p_verification_id: id,
      p_approve: true,
      p_reason: d.reason ?? "Identity document accepted.",
    });
  } else if (id) {
    await supabase.rpc("ai_apply_identity_verdict", {
      p_verification_id: id,
      p_approve: false,
      p_reason: d.reason ?? message,
    });
  }

  await logDecision({
    feature: "identity_check",
    actorId: opts.ownerId,
    actorRole: opts.actorRole ?? "seller",
    inputRef: opts.shopId,
    codeDecision: status,
    codeReason: d.reason ?? undefined,
  });

  return {
    status,
    message,
    verificationId: id,
    aiAvailable: true,
    documentAccepted: status === "ai_approved",
  };
}

async function persist(opts: {
  shopId: string;
  ownerId: string;
  imageUrl: string;
  declaredType?: string;
  status: string;
  detectedType?: string;
  isDoc?: boolean;
  nameReadable?: boolean;
  numberReadable?: boolean;
  photoPresent?: boolean;
  tamperSignals?: string[];
  confidence?: number;
  aiReason: string | null;
  aiAvailable: boolean;
  aiModel?: string;
}): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("seller_verification")
      .insert({
        shop_id: opts.shopId,
        owner_id: opts.ownerId,
        document_type: VALID_TYPES.has(String(opts.declaredType))
          ? String(opts.declaredType)
          : "unknown",
        image_url: opts.imageUrl,
        is_identity_doc: opts.isDoc ?? null,
        detected_type: opts.detectedType ?? null,
        name_readable: opts.nameReadable ?? null,
        number_readable: opts.numberReadable ?? null,
        photo_present: opts.photoPresent ?? null,
        tamper_signals: opts.tamperSignals ?? [],
        confidence: opts.confidence ?? null,
        ai_reason: opts.aiReason,
        status: opts.status,
        ai_model: opts.aiModel ?? null,
        ai_available: opts.aiAvailable,
      })
      .select("id")
      .single();

    if (error) {
      console.error("seller_verification insert failed:", error.message);
      return null;
    }
    return data.id as string;
  } catch (e) {
    console.error("seller_verification insert threw:", e);
    return null;
  }
}
