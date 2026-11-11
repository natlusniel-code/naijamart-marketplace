"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signInAction } from "@/app/auth/actions";
import { cn } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";

/**
 * Sign-in form.
 *
 * The password is posted to a Server Action (`signInAction`), not to Supabase
 * from the browser. That is the fix for "the password is correct but the site
 * says it is wrong": the check now runs against `public.account_credentials`,
 * which is the store this app actually writes to, instead of against a
 * Supabase password that may never have been set for the account.
 *
 * Google sign-in is gone — the brief asked for it to be removed, and the
 * project never had the provider enabled anyway.
 */
export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "";

  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  // Friendly copy for deep links from the old callback route (?error=…).
  const errorCode = params.get("error");
  useEffect(() => {
    if (!errorCode) return;
    const messages: Record<string, string> = {
      expired: "That link has expired. Sign in below, or reset your password.",
      auth: "We couldn't complete that sign-in. Please try again.",
    };
    setErr(messages[errorCode] ?? messages.auth);
  }, [errorCode]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!email.trim()) fe.email = "Enter your email address.";
    if (!password) fe.password = "Enter your password.";
    setFieldErr(fe);
    setErr("");
    if (Object.keys(fe).length) return;

    const fd = new FormData();
    fd.set("email", email.trim());
    fd.set("password", password);
    if (next) fd.set("next", next);

    startTransition(async () => {
      const result = await signInAction(fd);
      if (!result.ok) {
        setErr(result.error);
        if (result.field) setFieldErr({ [result.field]: result.error });
        return;
      }
      router.push(result.next ?? "/");
      router.refresh();
    });
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

        <button type="submit" disabled={pending} className="nm-btn-primary w-full !py-3">
          {pending ? <><Spinner /> Signing in…</> : "Sign in"}
        </button>
      </form>

      <p className="mt-5 text-center text-[13px] text-ink-500">
        New to NaijaMart?{" "}
        <Link href="/signup" className="font-semibold text-brand-600 hover:underline">Create an account</Link>
      </p>
    </div>
  );
}
