"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner, Alert } from "@/components/ui";

const LEN = 6;

export function VerifyEmail({ email, role }: { email: string; role: string }) {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [resent, setResent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const code = digits.join("");

  function setAt(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    setErr("");
    if (clean.length > 1) {
      const arr = clean.slice(0, LEN).split("");
      const next = [...digits];
      arr.forEach((c, k) => (next[i + k] = c));
      setDigits(next.slice(0, LEN));
      refs.current[Math.min(i + arr.length, LEN - 1)]?.focus();
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < LEN - 1) refs.current[i + 1]?.focus();
  }

  function onKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < LEN - 1) refs.current[i + 1]?.focus();
  }

  async function verify() {
    if (code.length !== LEN) {
      setErr("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });
    if (error) {
      setBusy(false);
      const m = error.message.toLowerCase();
      if (m.includes("expired")) setErr("That code has expired. Tap “Resend code” to get a new one.");
      else if (m.includes("invalid") || m.includes("token")) setErr("That code is not correct. Check the email again.");
      else setErr(error.message);
      return;
    }
    router.push(role === "seller" ? "/seller/onboarding" : "/");
    router.refresh();
  }

  async function resend() {
    if (cooldown > 0) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setResent(true);
    setCooldown(45);
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
        We sent a 6-digit code to <strong className="font-semibold text-ink-800">{email}</strong>. Enter it below to
        finish setting up your account.
      </p>

      <div className="mt-6 flex justify-center gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            value={d}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => onKey(i, e)}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={LEN}
            aria-label={`Digit ${i + 1}`}
            className={`h-13 w-11 rounded-xl border-2 text-center text-[20px] font-bold text-ink-900 outline-none transition
              ${err ? "border-red-300" : "border-[var(--line)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"}`}
            style={{ height: 54 }}
          />
        ))}
      </div>

      {err && <p className="mt-3 text-[12.5px] font-medium text-red-600">{err}</p>}
      {resent && !err && (
        <p className="mt-3 text-[12.5px] font-medium text-brand-700">A new code is on its way.</p>
      )}

      <button onClick={verify} disabled={busy} className="nm-btn-primary mt-6 w-full !py-3">
        {busy ? <><Spinner /> Verifying…</> : "Verify"}
      </button>

      <button
        onClick={resend}
        disabled={busy || cooldown > 0}
        className="mt-3 text-[13px] font-semibold text-brand-600 hover:underline disabled:text-ink-400 disabled:no-underline"
      >
        {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
      </button>

      <Alert tone="blue">
        Can&apos;t find it? Check your spam folder — the code comes from Supabase Auth, not NaijaMart.
      </Alert>

      <p className="mt-5 text-[12.5px] text-ink-500">
        Wrong email?{" "}
        <Link href="/signup/details" className="font-semibold text-brand-600 hover:underline">Start again</Link>
      </p>
    </div>
  );
}
