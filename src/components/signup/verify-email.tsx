"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Spinner, Alert } from "@/components/ui";

const COOLDOWN = 45;

/**
 * Post-signup screen.
 *
 * IMPORTANT — why this page does not show a code box:
 *
 * The project's Confirmation email template is the stock Supabase one, which
 * renders a LINK:
 *
 *   <p><a href="{{ .ConfirmationURL }}">Confirm email address</a></p>
 *
 * There is no `{{ .Token }}` in it, so the email contains NO 6-digit code. A
 * code box would ask the user to type something that was never sent. Until the
 * template in Supabase → Authentication → Email Templates → Confirm signup is
 * changed to print `{{ .Token }}`, this screen must describe a link.
 *
 * If you switch the template to a code, also switch this component to
 * `supabase.auth.verifyOtp({ email, token, type: "signup" })` — see README §1a.
 */
export function VerifyEmail({
  email,
  role,
  limited = false,
}: {
  email: string;
  role: string;
  limited?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [resent, setResent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function resend() {
    if (cooldown > 0) return;
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?role=${role}`,
      },
    });
    setBusy(false);
    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes("rate limit") || m.includes("too many")) {
        setErr(
          "You've requested a few too many links. Wait a minute, then try again.",
        );
      } else {
        setErr(error.message);
      }
      return;
    }
    setResent(true);
    setCooldown(COOLDOWN);
  }

  return (
    <div className="mx-auto w-full max-w-[420px] text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-50">
        <svg viewBox="0 0 24 24" className="h-8 w-8 text-brand-600" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.8" y="5" width="18.4" height="14" rx="2.4" />
          <path d="m3.5 6.5 8.5 6 8.5-6" />
        </svg>
      </div>

      <h1 className="mt-5 text-[24px] font-extrabold tracking-tight text-ink-900">Check your email</h1>
      <p className="mx-auto mt-1.5 max-w-[330px] text-[13.5px] leading-relaxed text-ink-500">
        We sent a confirmation link to{" "}
        <strong className="font-semibold text-ink-800">{email}</strong>. Open it to confirm your address and
        finish setting up your account.
      </p>

      <p className="mx-auto mt-3 max-w-[330px] text-[12.5px] leading-relaxed text-ink-400">
        The link works once and expires after an hour. Open it in this browser so you land back in NaijaMart.
      </p>

      {limited && !err && !resent && (
        <p className="mx-auto mt-4 max-w-[330px] text-[12.5px] leading-relaxed text-amber-700" role="status">
          Your account was created, but the mailer hit its hourly limit, so the email may not have gone
          out yet. Use the resend button below in a little while.
        </p>
      )}

      {err && (
        <p className="mt-4 text-[12.5px] font-medium text-red-600" role="alert">
          {err}
        </p>
      )}
      {resent && !err && (
        <p className="mt-4 text-[12.5px] font-medium text-brand-700">
          A new confirmation link is on its way.
        </p>
      )}

      <button onClick={resend} disabled={busy || cooldown > 0} className="nm-btn-primary mt-6 w-full !py-3">
        {busy ? (
          <>
            <Spinner /> Sending…
          </>
        ) : cooldown > 0 ? (
          `Resend in ${cooldown}s`
        ) : (
          "Resend confirmation link"
        )}
      </button>

      <Alert tone="blue">
        Can&apos;t find it? Check your spam folder — the email comes from Supabase Auth, not NaijaMart.
      </Alert>

      <p className="mt-5 text-[12.5px] text-ink-500">
        Already confirmed?{" "}
        <Link href="/signin" className="font-semibold text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>

      <p className="mt-2 text-[12.5px] text-ink-500">
        Wrong email?{" "}
        <Link href="/signup/details" className="font-semibold text-brand-600 hover:underline">
          Start again
        </Link>
      </p>
    </div>
  );
}
