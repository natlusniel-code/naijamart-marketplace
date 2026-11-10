import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/jobs/run
 *
 * Drives `public.run_order_timers()` from an external scheduler (Vercel Cron,
 * GitHub Actions, cron-job.org, ...). The function itself is idempotent and
 * safe to call as often as you like: it auto-cancels orders the seller never
 * accepted, auto-confirms deliveries after 7 days, releases queued payouts and
 * expires lapsed seller subscriptions.
 *
 * Auth: send the shared secret in either header:
 *   x-jobs-secret: <JOBS_SECRET>
 *   Authorization: Bearer <JOBS_SECRET>
 *
 * The route uses the anon key (RLS stays on) and only calls the RPC, so no
 * service-role key is ever needed in the app.
 */
export async function POST(request: Request) {
  const secret = process.env.JOBS_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "JOBS_SECRET is not configured on the server." },
      { status: 500 },
    );
  }

  const headerSecret =
    request.headers.get("x-jobs-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (headerSecret !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { ok: false, error: "Supabase environment variables are missing." },
      { status: 500 },
    );
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("run_order_timers");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result: data });
}

/** Convenience for uptime checks / manual pokes from a browser. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "POST to this route with the x-jobs-secret header to run the order timers.",
  });
}
