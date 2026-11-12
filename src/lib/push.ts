import "server-only";
import { createAdminClient } from "./supabase/admin";
import { VAPID_PUBLIC_KEY } from "./push-public";
import { FALLBACK_VAPID_PRIVATE_KEY, VAPID_SUBJECT_FALLBACK } from "./push-private";
import { sendPush, type PushTarget } from "./webpush";

/* Server-side Web Push dispatch.
 *
 * Before this, nothing ever sent a push: the client could only raise an OS
 * notification while the tab was open, `push_subscriptions` stayed empty, and
 * no VAPID key existed — so "notifications are not pushing" was literal.
 *
 * Every notification (order, chat, broadcast) is a row in
 * `public.notifications`. This claims the un-pushed rows and sends each to
 * that user's devices — one path, so any feature that writes a row is pushed
 * automatically, for buyers, sellers and admins alike. */

const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim() || FALLBACK_VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT?.trim() || VAPID_SUBJECT_FALLBACK;

const VAPID_HEADERS = {
  publicKey: VAPID_PUBLIC_KEY,
  privateKey: PRIVATE_KEY,
  subject: SUBJECT,
};

export function pushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && PRIVATE_KEY);
}

type Claimed = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
};

export type DispatchResult = {
  ok: boolean;
  configured: boolean;
  claimed: number;
  sent: number;
  failed: number;
  pruned: number;
  error?: string;
};

/**
 * Claim un-pushed notifications and deliver them.
 *
 * `claim_unpushed_notifications` (sql/0022) stamps `pushed_at` as it returns
 * rows, so two overlapping polls cannot double-send.
 */
export async function dispatchPush(limit = 50): Promise<DispatchResult> {
  const base: DispatchResult = {
    ok: false,
    configured: pushConfigured(),
    claimed: 0,
    sent: 0,
    failed: 0,
    pruned: 0,
  };

  if (!pushConfigured()) {
    return { ...base, error: "Web Push is not configured: no VAPID key pair." };
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("claim_unpushed_notifications", {
    p_limit: limit,
  });
  if (error) return { ...base, error: error.message };

  const rows = (data ?? []) as Claimed[];
  if (!rows.length) return { ...base, ok: true };

  // One query for all devices involved, not one per row.
  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth,user_id")
    .in("user_id", Array.from(new Set(rows.map((r) => r.user_id))));

  if (subErr) return { ...base, claimed: rows.length, error: subErr.message };

  const byUser = new Map<string, PushTarget[]>();
  for (const s of subs ?? []) {
    const list = byUser.get(s.user_id) ?? [];
    list.push({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
    byUser.set(s.user_id, list);
  }

  let sent = 0;
  let failed = 0;
  let pruned = 0;
  let lastError: string | undefined;

  for (const row of rows) {
    const targets = byUser.get(row.user_id) ?? [];
    if (!targets.length) continue; // no device registered — nothing to do

    const payload = {
      title: row.title,
      body: row.body ?? "",
      url: row.href ?? "/notifications",
      tag: row.id,
      kind: row.kind,
    };

    for (const t of targets) {
      const outcome = await sendPush(t, payload, VAPID_HEADERS);
      if (outcome.ok) {
        sent += 1;
      } else {
        failed += 1;
        lastError = outcome.error;
        // The push service discarded this subscription; keeping it would make
        // every future send fail.
        if (outcome.gone) {
          await supabase.rpc("prune_push_subscription", { p_endpoint: t.endpoint });
          pruned += 1;
        }
      }
    }
  }

  return { ok: true, configured: true, claimed: rows.length, sent, failed, pruned, error: lastError };
}
