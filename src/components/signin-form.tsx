"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

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
        setErr("Please verify your email first — check your inbox for the 6-digit code.");
      } else {
        setErr(error.message);
      }
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function google() {
    setGoogleBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setGoogleBusy(false);
      setErr(
        "Google sign-in isn't switched on for this project yet. Use your email and password, or ask the admin to enable Google in Supabase → Authentication → Providers.",
      );
    }
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

        <div className="flex items-center gap-3 py-1">
          <span className="h-px flex-1 bg-[var(--line)]" />
          <span className="text-[12px] font-medium text-ink-400">or</span>
          <span className="h-px flex-1 bg-[var(--line)]" />
        </div>

        <button type="button" onClick={google} disabled={googleBusy} className="nm-btn-ghost w-full !py-2.5">
          {googleBusy ? <Spinner /> : (
            <svg width={18} height={18} viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.2h6.5c-.13 1.1-.85 2.7-2.4 3.8l-.02.14 3.5 2.7.24.02c2.2-2 3.5-5 3.5-8.7Z" />
              <path fill="#34A853" d="M12 24c3.2 0 5.9-1.06 7.8-2.9l-3.7-2.86c-1 .7-2.3 1.2-4.1 1.2-3.1 0-5.8-2.05-6.7-4.9l-.14.01-3.6 2.8-.05.13C3.4 21.3 7.4 24 12 24Z" />
              <path fill="#FBBC05" d="M5.3 14.5a7.4 7.4 0 0 1 0-4.98V9.5L1.6 6.66l-.12.05A12 12 0 0 0 0 12c0 1.9.46 3.7 1.48 5.3l3.8-2.8Z" />
              <path fill="#EA4335" d="M12 4.75c2.2 0 3.7.95 4.5 1.75l3.3-3.2C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.7 1.5 6.7l3.85 2.82C6.2 6.8 8.9 4.75 12 4.75Z" />
            </svg>
          )}
          Continue with Google
        </button>
      </form>

      <p className="mt-5 text-center text-[13px] text-ink-500">
        New to NaijaMart?{" "}
        <Link href="/signup" className="font-semibold text-brand-600 hover:underline">Create an account</Link>
      </p>
    </div>
  );
}
