import "server-only";

/**
 * Transactional email delivery.
 *
 * ── Why this module exists ───────────────────────────────────────────────────
 * Supabase's BUILT-IN mailer works, but it is a *testing* mailer: the project's
 * `rate_limit_email_sent` is 2 per hour, and that value cannot be raised
 * without custom SMTP (the API rejects it with "Custom SMTP required to
 * configure ... RATE_LIMIT_EMAIL_SENT"). Two signups an hour is not a product.
 *
 * The previous custom SMTP pointed at Resend with a dead key, which is what
 * broke signup in the first place. So instead of putting a mail provider back
 * in Supabase's critical path, we send the confirmation email ourselves:
 *
 *   1. `admin.auth.admin.createUser()` creates the account WITHOUT sending
 *      anything — no mailer in the path, so signup can never 500 on a mail
 *      failure and is not subject to the 2/hour cap.
 *   2. `admin.auth.admin.generateLink()` mints the real confirmation URL.
 *   3. This module delivers that URL through a provider we control.
 *
 * ── Configuration ────────────────────────────────────────────────────────────
 * Set ONE of these in the deployment environment (server-side only — never
 * prefix with NEXT_PUBLIC_):
 *
 *   RESEND_API_KEY      + EMAIL_FROM   (e.g. "NaijaMart <hello@naijamart.ng>")
 *   SENDGRID_API_KEY    + EMAIL_FROM
 *
 * If neither is set, `sendEmail()` returns `{ delivered: false }` and the
 * caller falls back to Supabase's built-in mailer. That keeps local dev and a
 * fresh deploy working with zero configuration, while a production deployment
 * gets unlimited, provider-backed delivery by setting one variable.
 *
 * We deliberately do NOT use nodemailer/SMTP: an HTTP API needs no new
 * dependency, no TLS handshake, and no long-lived socket in a serverless
 * function — and the SMTP path is exactly what failed before.
 */

export type SendResult =
  | { delivered: true; provider: "resend" | "sendgrid" }
  | { delivered: false; reason: string };

const FROM =
  process.env.EMAIL_FROM?.trim() || "NaijaMart <onboarding@resend.dev>";

/** Which provider, if any, is configured. */
export function emailProvider(): "resend" | "sendgrid" | null {
  if (process.env.RESEND_API_KEY?.trim()) return "resend";
  if (process.env.SENDGRID_API_KEY?.trim()) return "sendgrid";
  return null;
}

/** True when we can deliver mail ourselves (i.e. not the capped built-in). */
export const hasEmailProvider = emailProvider() !== null;

function confirmationHtml(link: string, name: string) {
  // Inline styles only — every mail client strips <style> blocks differently.
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f9d58">NaijaMart</p>
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#111827">Confirm your email address</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4b5563">
            Hi ${name || "there"}, thanks for signing up. Confirm this address to finish setting up your account.
          </p>
          <p style="margin:0 0 24px">
            <a href="${link}" style="display:inline-block;background:#0f9d58;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 22px;border-radius:10px">Confirm email address</a>
          </p>
          <p style="margin:0 0 8px;font-size:12.5px;line-height:1.6;color:#6b7280">
            The link works once and expires after an hour. If the button doesn't work, paste this into your browser:
          </p>
          <p style="margin:0 0 20px;font-size:12px;line-height:1.5;color:#0f9d58;word-break:break-all">${link}</p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af">
            Didn't sign up? You can safely ignore this email — no account will be created without confirmation.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function confirmationText(link: string, name: string) {
  return `Hi ${name || "there"},

Thanks for signing up to NaijaMart. Confirm your email address to finish setting up your account:

${link}

The link works once and expires after an hour.

Didn't sign up? You can safely ignore this email.
`;
}

/**
 * Deliver the confirmation email. Never throws — a mail failure must not take
 * down signup. The caller decides what to do with `delivered: false`.
 */
export async function sendConfirmationEmail(opts: {
  to: string;
  link: string;
  name?: string;
}): Promise<SendResult> {
  const provider = emailProvider();
  if (!provider) {
    return { delivered: false, reason: "no_provider_configured" };
  }

  const subject = "Confirm your email address";
  const html = confirmationHtml(opts.link, opts.name ?? "");
  const text = confirmationText(opts.link, opts.name ?? "");

  try {
    if (provider === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: FROM, to: [opts.to], subject, html, text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { delivered: false, reason: `resend_${res.status}: ${body.slice(0, 200)}` };
      }
      return { delivered: true, provider: "resend" };
    }

    // SendGrid
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: opts.to }] }],
        from: parseFrom(FROM),
        subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { delivered: false, reason: `sendgrid_${res.status}: ${body.slice(0, 200)}` };
    }
    return { delivered: true, provider: "sendgrid" };
  } catch (e) {
    return {
      delivered: false,
      reason: `network: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** "NaijaMart <hello@x.ng>" → { email, name } for SendGrid's shape. */
function parseFrom(from: string): { email: string; name?: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2] };
  return { email: from.trim() };
}
