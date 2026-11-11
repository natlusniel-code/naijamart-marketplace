"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { finishResetAction, startResetAction } from "@/app/auth/actions";
import { Spinner, Alert } from "@/components/ui";

/**
 * Password reset — the same method as signup.
 *
 * Step 1: identify the account (email, plus the phone number on record when
 *         there is one — with no email in the loop, the code alone would prove
 *         nothing, so a second recorded detail is what authorises the reset).
 * Step 2: a 6-digit code appears on screen; the user retypes it, exactly as in
 *         signup. A wrong entry rotates the code and shows the new one.
 * Step 3: choose the new password.
 *
 * No email is sent at any point.
 */
export function ResetForm() {
  const router = useRouter();
  const [step, setStep] = useState<"identify" | "code">("identify");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function start(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setFieldErr({});

    const fe: Record<string, string> = {};
    if (!email.trim()) fe.email = "Enter your email address.";
    setFieldErr(fe);
    if (Object.keys(fe).length) return;

    const fd = new FormData();
    fd.set("email", email.trim());
    fd.set("phone", phone.replace(/\s/g, ""));

    startTransition(async () => {
      const result = await startResetAction(fd);
      if (!result.ok) {
        setErr(result.error);
        if (result.field) setFieldErr({ [result.field]: result.error });
        return;
      }
      setCode(result.code ?? "");
      setTyped("");
      setStep("code");
    });
  }

  function finish(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setFieldErr({});

    const fe: Record<string, string> = {};
    if (!/^\d{6}$/.test(typed.trim())) fe.code = "Enter the 6-digit code shown above.";
    if (password.length < 8) fe.password = "Use at least 8 characters.";
    setFieldErr(fe);
    if (Object.keys(fe).length) return;

    const fd = new FormData();
    fd.set("email", email.trim());
    fd.set("code", typed.trim());
    fd.set("password", password);

    startTransition(async () => {
      const result = await finishResetAction(fd);
      if (!result.ok) {
        setErr(result.error);
        if (result.code) {
          // The code rotated — show the new one and clear the box.
          setCode(result.code);
          setTyped("");
        }
        if (result.field) setFieldErr({ [result.field]: result.error });
        return;
      }
      router.push(result.next ?? "/");
      router.refresh();
    });
  }

  return (
    <div>
      <h1 className="text-[26px] font-extrabold tracking-tight text-ink-900">Reset your password</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-500">
        {step === "identify"
          ? "Confirm the details on your account. We'll show you a code to type in."
          : "Type the code below, then choose a new password."}
      </p>

      {step === "identify" ? (
        <form onSubmit={start} className="mt-6 space-y-3.5" noValidate>
          <div>
            <label className="nm-label" htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className="nm-input"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setFieldErr((f) => ({ ...f, email: "" })); }}
              placeholder="you@example.com"
            />
            {fieldErr.email && <p className="mt-1 text-[12px] font-medium text-red-600">{fieldErr.email}</p>}
          </div>
          <div>
            <label className="nm-label" htmlFor="phone">Phone number on the account</label>
            <input
              id="phone"
              inputMode="tel"
              autoComplete="tel"
              className="nm-input"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setFieldErr((f) => ({ ...f, phone: "" })); }}
              placeholder="08012345678"
            />
            {fieldErr.phone && <p className="mt-1 text-[12px] font-medium text-red-600">{fieldErr.phone}</p>}
            <p className="mt-1 text-[11.5px] text-ink-400">
              This is the number you signed up with. It confirms the account is yours.
            </p>
          </div>

          {err && <Alert tone="red">{err}</Alert>}

          <button type="submit" disabled={pending} className="nm-btn-primary w-full !py-3">
            {pending ? <><Spinner /> Checking…</> : "Continue"}
          </button>
        </form>
      ) : (
        <form onSubmit={finish} className="mt-6 space-y-3.5" noValidate>
          {/* The code, shown exactly as on the signup screen. */}
          <div className="rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/60 px-4 py-4 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wider text-brand-700">Your code</p>
            <p
              className="mt-1 select-all font-mono text-[32px] font-extrabold leading-none tracking-[0.22em] text-brand-800"
              aria-live="polite"
            >
              {code || "------"}
            </p>
            <p className="mt-2 text-[11.5px] text-ink-500">Expires in 10 minutes.</p>
          </div>

          <div>
            <label className="nm-label" htmlFor="code">Retype the code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="nm-input text-center font-mono text-[22px] tracking-[0.3em]"
              value={typed}
              onChange={(e) => { setTyped(e.target.value.replace(/\D/g, "")); setFieldErr((f) => ({ ...f, code: "" })); }}
              placeholder="000000"
            />
            {fieldErr.code && <p className="mt-1 text-[12px] font-medium text-red-600">{fieldErr.code}</p>}
          </div>

          <div>
            <label className="nm-label" htmlFor="password">New password</label>
            <div className="relative">
              <input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                className="nm-input pr-11"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setFieldErr((f) => ({ ...f, password: "" })); }}
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

          {err && <Alert tone="red">{err}</Alert>}

          <button type="submit" disabled={pending} className="nm-btn-primary w-full !py-3">
            {pending ? <><Spinner /> Saving…</> : "Set new password"}
          </button>

          <button
            type="button"
            onClick={() => { setStep("identify"); setErr(""); setCode(""); setTyped(""); setPassword(""); }}
            className="w-full text-[12.5px] font-semibold text-brand-600 hover:underline"
          >
            Start over
          </button>
        </form>
      )}

      <p className="mt-5 text-center text-[13px] text-ink-500">
        Remembered it?{" "}
        <Link href="/signin" className="font-semibold text-brand-600 hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
