"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";

/**
 * Password reset — request a link, then set a new password.
 *
 * ── Why this page exists ───────────────────────────────────────────────────
 * The sign-in form has always linked to `/reset` ("Forgot password?"), but no
 * such route existed: the link 404'd, so a buyer who forgot their password had
 * no way back into their account. This is that route.
 *
 * ── Two modes, one page ────────────────────────────────────────────────────
 * `request`  — no session yet. The user types their email and Supabase mails a
 *              recovery link.
 * `update`   — the user arrived from that link. Supabase's recovery link
 *              carries a `code`; `/auth/callback` exchanges it for a session
 *              and redirects here with `?mode=update`. With a live session we
 *              can call `updateUser({ password })`.
 *
 * The mode is derived from the URL, not from local state, so a refresh or a
 * link opened in a new tab lands in the right place.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();

  const mode = params.get("mode") === "update" ? "update" : "request";

  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  // A recovery link that has already been used, or that expired, arrives with
  // `?error=expired` from /auth/callback. Say so instead of showing a form that
  // will fail on submit.
  const errorCode = params.get("error");
  useEffect(() => {
    if (errorCode === "expired") {
      setErr(
        "That reset link has expired or was already used. Request a new one below.",
      );
    }
  }, [errorCode]);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())) {
      fe.email = "Enter a valid email address.";
    }
    setFieldErr(fe);
    setErr("");
    if (Object.keys(fe).length) return;

    setBusy(true);
    const supabase = createClient();

    // `resetPasswordForEmail` sends Supabase's Recovery template, which
    // contains `{{ .ConfirmationURL }}`. `redirectTo` is where that link lands
    // AFTER Supabase verifies the token — /auth/callback exchanges the code
    // for a session and forwards to /reset?mode=update.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        "/reset?mode=update",
      )}`,
    });

    setBusy(false);

    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes("rate limit") || m.includes("too many")) {
        setErr("Too many requests just now. Wait a minute, then try again.");
      } else {
        setErr(error.message);
      }
      return;
    }

    // Deliberately the same message whether or not the address exists:
    // telling an anonymous visitor "no account with that email" leaks which
    // addresses are registered.
    setSent(true);
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (password.length < 8) fe.password = "Use at least 8 characters.";
    if (password !== confirm) fe.confirm = "The two passwords don't match.";
    setFieldErr(fe);
    setErr("");
    if (Object.keys(fe).length) return;

    setBusy(true);
    const supabase = createClient();

    // The recovery link already signed the user in, so this updates the
    // password on the current session — no old password required.
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setBusy(false);
      const m = error.message.toLowerCase();
      if (m.includes("session") || m.includes("jwt") || m.includes("expired")) {
        setErr(
          "Your reset link has expired. Request a new one and open it in this browser.",
        );
      } else if (m.includes("weak") || m.includes("password")) {
        setFieldErr({ password: "That password is too weak. Try a longer one." });
      } else {
        setErr(error.message);
      }
      return;
    }

    setBusy(false);
    setDone(true);

    // Send them into the app as the account they just recovered. A short beat
    // lets the success message register before the route changes.
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1200);
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 13 4 4L19 7" />
          </svg>
        </div>
        <h1 className="mt-4 text-[24px] font-extrabold tracking-tight text-ink-900">Password updated</h1>
        <p className="mt-1.5 text-[13.5px] text-ink-500">
          You&apos;re signed in. Taking you to the marketplace&hellip;
        </p>
      </div>
    );
  }

  if (mode === "update") {
    return (
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight text-ink-900">Choose a new password</h1>
        <p className="mt-1.5 text-[13.5px] text-ink-500">
          Pick something you haven&apos;t used before.
        </p>

        <form onSubmit={updatePassword} className="mt-6 space-y-3.5" noValidate>
          <div>
            <label className="nm-label" htmlFor="new-password">New password</label>
            <div className="relative">
              <input
                id="new-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setFieldErr((f) => ({ ...f, password: "" })); }}
                className={cn("nm-input pr-11", fieldErr.password && "border-red-400")}
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-400 hover:text-ink-700"
              >
                {show ? (
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M6.7 6.7C4.6 8 3 10 2.2 12c1.6 3.5 5.2 6 9.8 6 1.7 0 3.3-.36 4.7-1M17.9 15.4c1.4-1.1 2.5-2.5 3.1-3.4-1.6-3.5-5.2-6-9.8-6-.6 0-1.2.05-1.7.14" /></svg>
                ) : (
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M2.2 12C3.8 8.5 7.4 6 12 6s8.2 2.5 9.8 6c-1.6 3.5-5.2 6-9.8 6s-8.2-2.5-9.8-6Z" /><circle cx="12" cy="12" r="2.6" /></svg>
                )}
              </button>
            </div>
            {fieldErr.password && <p className="mt-1 text-[12px] font-medium text-red-600">{fieldErr.password}</p>}
          </div>

          <div>
            <label className="nm-label" htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setFieldErr((f) => ({ ...f, confirm: "" })); }}
              className={cn("nm-input", fieldErr.confirm && "border-red-400")}
              placeholder="Type it again"
            />
            {fieldErr.confirm && <p className="mt-1 text-[12px] font-medium text-red-600">{fieldErr.confirm}</p>}
          </div>

          {err && <Alert tone="red">{err}</Alert>}

          <button type="submit" disabled={busy} className="nm-btn-primary w-full !py-3">
            {busy ? <><Spinner /> Saving&hellip;</> : "Update password"}
          </button>
        </form>

        <p className="mt-5 text-center text-[13px] text-ink-500">
          <Link href="/reset" className="font-semibold text-brand-600 hover:underline">
            Request a new link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[26px] font-extrabold tracking-tight text-ink-900">Reset your password</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-500">
        Enter the email on your account and we&apos;ll send you a link to choose a new password.
      </p>

      {sent ? (
        <div className="mt-6">
          <Alert tone="blue" title="Check your email">
            If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way.
            Open it in this browser to choose a new password.
          </Alert>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-400">
            The link works once and expires after an hour. Nothing arrived? Check your spam folder,
            then try again in a minute.
          </p>
          <button
            type="button"
            onClick={() => { setSent(false); setErr(""); }}
            className="nm-btn-ghost mt-4 w-full !py-2.5"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={requestLink} className="mt-6 space-y-3.5" noValidate>
          <div>
            <label className="nm-label" htmlFor="reset-email">Email address</label>
            <input
              id="reset-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setFieldErr((f) => ({ ...f, email: "" })); }}
              className={cn("nm-input", fieldErr.email && "border-red-400")}
              placeholder="you@example.com"
            />
            {fieldErr.email && <p className="mt-1 text-[12px] font-medium text-red-600">{fieldErr.email}</p>}
          </div>

          {err && <Alert tone="red">{err}</Alert>}

          <button type="submit" disabled={busy} className="nm-btn-primary w-full !py-3">
            {busy ? <><Spinner /> Sending&hellip;</> : "Send reset link"}
          </button>
        </form>
      )}

      <p className="mt-5 text-center text-[13px] text-ink-500">
        Remembered it?{" "}
        <Link href="/signin" className="font-semibold text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
