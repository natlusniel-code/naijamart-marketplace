import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { JOBS_SECRET } from "@/lib/jobs-secret";
import { dispatchPush } from "@/lib/push";

/**
 * POST/GET /api/jobs/run
 *
 * Drives `public.run_order_timers()` and the Web Push dispatcher. Vercel Cron
 * calls this on a schedule (see vercel.json), and nothing else needs to.
 *
 * Auth: send the shared secret in either header:
 *   x-jobs-secret: <JOBS_SECRET>
 *   Authorization: Bearer <JOBS_SECRET>
 *
 * Vercel Cron cannot send a custom header, so it is also accepted when the
 * request carries Vercel's own cron marker (`x-vercel-cron`). That header is
 * set by the platform, not by a browser, so it cannot be used to reach this
 * route from the outside.
 *
 * The order-timer call uses the anon key (RLS on). The push dispatcher needs
 * the service role to read every user's subscriptions — that stays
 * server-side, in `src/lib/push.ts`.
 */
async function run(request: Request) {
  const headerSecret =
    request.headers.get("x-jobs-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  const fromVercelCron = Boolean(request.headers.get("x-vercel-cron"));

  if (!fromVercelCron && headerSecret !== JOBS_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  // Resolved through the shared config module, which carries a literal
  // fallback so this route cannot break on a host without the env vars set.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Order timers ──────────────────────────────────────────────────────
  // A failure here must NOT stop the push dispatch below. The two jobs are
  // independent: the timers move orders along, the dispatcher delivers
  // notifications. Before this, a broken timer RPC (it raises
  // `column "payout_hold_days" does not exist` when migration 0011 is not
  // applied) returned 500 and push never ran at all — so a schema problem in
  // one job silently killed the other.
  let timers: unknown = null;
  let timersError: string | null = null;
  try {
    const { data, error } = await supabase.rpc("run_order_timers");
    if (error) timersError = error.message;
    else timers = data;
  } catch (e) {
    timersError = e instanceof Error ? e.message : "run_order_timers failed";
  }

  // ── Web Push ──────────────────────────────────────────────────────────
  // Deliver every notification row that has not been pushed yet. This is
  // what makes order updates, chat messages and admin broadcasts reach a
  // phone with the app closed — for buyers, sellers and admins alike,
  // because they all write to `public.notifications`.
  let push: Awaited<ReturnType<typeof dispatchPush>> | { ok: false; error: string };
  try {
    push = await dispatchPush(100);
  } catch (e) {
    push = { ok: false, error: e instanceof Error ? e.message : "push dispatch failed" };
  }

  // 200 as long as the push job ran: a timer error is reported, not fatal.
  return NextResponse.json({
    ok: !timersError,
    result: timers,
    timersError,
    push,
  });
}

export async function POST(request: Request) {
  return run(request);
}

/** Vercel Cron issues a GET — same work. */
export async function GET(request: Request) {
  return run(request);
}
