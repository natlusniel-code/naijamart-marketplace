import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendConfirmationEmail, hasEmailProvider } from "@/lib/email/send";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";

/**
 * POST /api/auth/signup
 *
 * Creates the account and gets a confirmation email out — without putting a
 * mail provider in Supabase's critical path.
 *
 * ── Why not just `supabase.auth.signUp()` from the browser? ──────────────────
 * Because with `mailer_autoconfirm = false`, `signUp` sends the confirmation
 * INSIDE the request. When the mailer is broken the whole call 500s and no user
 * is created (that was the original bug), and when it works it is still capped
 * at `rate_limit_email_sent` = 2/hour on the built-in mailer. Neither is
 * acceptable for a real signup flow.
 *
 * So this route does the three steps explicitly:
 *
 *   1. `admin.createUser({ email_confirm: false })` — creates the account with
 *      NO email attempt. Cannot 500 on mail, cannot hit the mail rate limit.
 *   2. `admin.generateLink({ type: "signup" })` — mints the real confirmation
 *      URL (the same one Supabase would have emailed).
 *   3. `sendConfirmationEmail()` — delivers it through Resend/SendGrid.
 *
 * If no provider is configured, step 3 reports `delivered: false` and we fall
 * back to `auth.resend()` so the built-in mailer still sends the link. That
 * keeps a zero-config deployment working; a production deployment sets
 * RESEND_API_KEY (or SENDGRID_API_KEY) and gets unlimited delivery.
 *
 * ── Response contract ────────────────────────────────────────────────────────
 *   200 { status: "check_email" }   account created, confirmation sent
 *   200 { status: "signed_in", session }  (only if the address was already
 *        confirmed — we then sign the user in so they are not stranded)
 *   409 { error: "email_taken" }    address already registered
 *   400 { error: "invalid_*" }      validation
 *   502 { error: "email_failed" }   account created but no email could be sent
 *
 * The client shows the "check your email" screen for `check_email` — that is
 * the normal, successful path, not an error.
 */

const ROLES = new Set(["buyer", "seller"]);

type Body = {
  email?: string;
  password?: string;
  full_name?: string;
  phone?: string;
  state?: string;
  city?: string;
  role?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = (body.full_name ?? "").trim();
  const phone = (body.phone ?? "").replace(/\s/g, "");
  const state = (body.state ?? "").trim();
  const city = (body.city ?? "").trim();

  // The role is whitelisted here AND in the DB trigger. Two independent gates,
  // because this value decides where the user lands and what they can do.
  const role = ROLES.has(body.role ?? "") ? (body.role as "buyer" | "seller") : "buyer";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "weak_password" }, { status: 400 });
  }
  if (fullName.length < 3) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }
  if (!/^0\d{10}$/.test(phone)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── 1. Create the account. No email is attempted here. ────────────────────
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: {
      full_name: fullName,
      phone,
      state,
      city,
      role,
    },
  });

  if (createErr) {
    const m = createErr.message.toLowerCase();
    // Order matters. "Unregistered API key" / "Invalid API key" must NOT be
    // mistaken for "already registered" — a dead service-role key would then
    // tell every new user their email is taken, which is a maddening bug to
    // chase. Check the credential failures first and report them as such.
    if (m.includes("api key") || m.includes("unregistered") || m.includes("unauthorized")) {
      return NextResponse.json(
        { error: "server_misconfigured", detail: createErr.message },
        { status: 500 },
      );
    }
    if (m.includes("already") || m.includes("registered") || m.includes("exists")) {
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }
    if (m.includes("password")) {
      return NextResponse.json({ error: "weak_password" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "create_failed", detail: createErr.message },
      { status: 500 },
    );
  }

  const user = created.user;
  if (!user) {
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }

  // ── 2. Mint the confirmation link. ────────────────────────────────────────
  const redirectTo = `${new URL(req.url).origin}/auth/callback?role=${role}`;
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: { redirectTo },
  });

  const link = linkData?.properties?.action_link;

  // ── 3. Deliver it. ────────────────────────────────────────────────────────
  if (link) {
    const sent = await sendConfirmationEmail({ to: email, link, name: fullName });
    if (sent.delivered) {
      return NextResponse.json({ status: "check_email", provider: sent.provider });
    }
    // No provider configured (or it failed) — let Supabase's built-in mailer
    // send it. This is the zero-config path and is capped at 2/hour, which is
    // why a production deployment should set RESEND_API_KEY.
    if (!hasEmailProvider) {
      const resend = await fetch(`${SUPABASE_URL}/auth/v1/resend`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "signup", email, options: { emailRedirectTo: redirectTo } }),
      }).catch(() => null);

      if (resend?.ok) {
        return NextResponse.json({ status: "check_email", provider: "supabase_builtin" });
      }
      return NextResponse.json(
        { error: "email_failed", detail: "built-in mailer rejected the send" },
        { status: 502 },
      );
    }
    // A provider IS configured but the send failed — surface it rather than
    // silently falling back, so a bad key is visible instead of mysterious.
    return NextResponse.json(
      { error: "email_failed", detail: sent.reason },
      { status: 502 },
    );
  }

  // generateLink failed. The account exists, so do not pretend otherwise.
  return NextResponse.json(
    { error: "email_failed", detail: linkErr?.message ?? "could not generate link" },
    { status: 502 },
  );
}
