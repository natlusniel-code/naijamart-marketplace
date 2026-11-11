"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { postAuthDestination } from "@/lib/post-auth";
import { cn } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";
import { GoogleButton } from "@/components/google-button";

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Only an EXPLICIT ?next= is forwarded to OAuth. Defaulting it to "/" would
  // make the callback treat the storefront as a deliberate destination and
  // skip the seller-hub routing below.
  const next = params.get("next") ?? "";

  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  // Friendly copy for deep links from /auth/callback (?error=…). Without this,
  // a failed confirmation or OAuth round-trip lands back here in silence.
  const errorCode = params.get("error");
  useEffect(() => {
    if (!errorCode) return;
    const messages: Record<string, string> = {
      google_disabled:
        "Google sign-in isn't enabled on this project. Use your email and password instead.",
      expired:
        "That confirmation link has expired or was already used. Request a fresh link from the sign-up page.",
      auth: "We couldn't complete that sign-in. Please try again.",
    };
    setErr(messages[errorCode] ?? messages.auth);
  }, [errorCode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!email.trim()) fe.email = "Enter your email address.";
    if (!password) fe.password = "Enter your password.";
    setFieldErr(fe);
    setErr("");
    if (Object.keys(fe).length) return;

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setBusy(false);
      const m = error.message.toLowerCase();
      if (m.includes("invalid login") || m.includes("credentials")) {
        setErr("That email and password don't match. Check the password, or reset it below.");
      } else if (m.includes("not confirmed") || m.includes("confirm")) {
        setErr("Please verify your email first — we emailed you a confirmation link. Open it, then sign in.");
      } else {
        setErr(error.message);
      }
      return;
    }
    // Sellers land in the Seller Hub (or in onboarding if they have not opened
    // a shop yet), buyers on the storefront. `postAuthDestination` asks the
    // database — the profile role and the `shops` row together, via the shared
    // `isBuyerAccount` rule — so a seller who has not started onboarding is not
    // mistaken for a buyer, and a buyer who owns a shop is not mistaken for a
    // seller. An explicit `?next=` always wins.
    const explicitNext = params.get("next");
    const uid = (await supabase.auth.getUser()).data.user?.id ?? "";
    const dest = await postAuthDestination(supabase, uid, explicitNext);

    router.push(dest);
    router.refresh();
  }

  return (
    <div>
      <h1 className="text-[26px] font-extrabold tracking-tight text-ink-900">Welcome back</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-500">Sign in to track orders, chats and payouts.</p>

      <form onSubmit={submit} className="mt-6 space-y-3.5" noValidate>
        <div>
          <label className="nm-label" htmlFor="email">Email address</label>
          <input
            id="email"
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

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label className="text-[13px] font-semibold text-ink-700" htmlFor="password">Password</label>
            <Link href="/reset" className="text-[12.5px] font-semibold text-brand-600 hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setFieldErr((f) => ({ ...f, password: "" })); }}
              className={cn("nm-input pr-11", fieldErr.password && "border-red-400")}
              placeholder="Your password"
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

        {err && <Alert tone="red">{err}</Alert>}

        <button type="submit" disabled={busy} className="nm-btn-primary w-full !py-3">
          {busy ? <><Spinner /> Signing in…</> : "Sign in"}
        </button>

        <GoogleButton
          redirectTo={`/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          onError={setErr}
        />
      </form>

      <p className="mt-5 text-center text-[13px] text-ink-500">
        New to NaijaMart?{" "}
        <Link href="/signup" className="font-semibold text-brand-600 hover:underline">Create an account</Link>
      </p>
    </div>
  );
}
