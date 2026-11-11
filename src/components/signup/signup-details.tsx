"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { startSignupAction } from "@/app/auth/actions";
import { NIGERIA_STATES, lgasFor, cn } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";

type Props = { initialRole: "buyer" | "seller" };

function passwordScore(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

/**
 * Signup step 2 — details.
 *
 * No email is sent. `startSignupAction` creates the account, stores the
 * password in our own credential table, and returns a 6-digit code which the
 * next screen displays for the user to retype. See sql/0015.
 */
export function SignupDetails({ initialRole }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const role = (params.get("role") as "buyer" | "seller") || initialRole;

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    state: "Ogun",
    city: "Abeokuta South",
    terms: false,
  });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const lg = lgasFor(form.state);
  const score = passwordScore(form.password);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  }

  function submit(ev: React.FormEvent) {
    ev.preventDefault();

    const e: Record<string, string> = {};
    if (form.full_name.trim().length < 3) e.full_name = "Enter your full name.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(form.email)) e.email = "Enter a valid email address.";
    if (!/^0\d{10}$/.test(form.phone.replace(/\s/g, ""))) e.phone = "Use 11 digits, like 08012345678.";
    if (form.password.length < 8) e.password = "Use at least 8 characters.";
    if (!form.terms) e.terms = "Please accept the Terms and Refund Policy.";
    setErrors(e);
    if (Object.keys(e).length) return;

    const fd = new FormData();
    fd.set("full_name", form.full_name.trim());
    fd.set("email", form.email.trim());
    fd.set("phone", form.phone.replace(/\s/g, ""));
    fd.set("password", form.password);
    fd.set("state", form.state);
    fd.set("city", form.city);
    fd.set("role", role);

    startTransition(async () => {
      const result = await startSignupAction(fd);
      if (!result.ok) {
        if (result.field) setErrors({ [result.field]: result.error });
        else setErrors({ form: result.error });
        return;
      }
      // The code is shown on the next screen. It is passed in the URL because
      // it must survive a refresh — it is a one-time code for an account that
      // was just created in this same browser, not a secret credential.
      router.push(
        `/signup/verify?email=${encodeURIComponent(result.email ?? form.email.trim())}` +
          `&role=${role}&code=${encodeURIComponent(result.code ?? "")}`,
      );
    });
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-2 text-[12px] font-semibold text-ink-400">
        <span className="flex items-center gap-1.5 text-brand-600">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-[11px] text-white">1</span>
          Role
        </span>
        <span className="h-px w-5 bg-slate-200" />
        <span className="flex items-center gap-1.5 text-brand-600">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-[11px] text-white">2</span>
          Details
        </span>
        <span className="h-px w-5 bg-slate-200" />
        <span className="flex items-center gap-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-200 text-[11px] text-ink-500">3</span>
          Verify
        </span>
      </div>

      <h1 className="text-[25px] font-extrabold tracking-tight text-ink-900">Create your account</h1>
      <p className="mt-1 text-[13.5px] text-ink-500">
        You&apos;re signing up as a <strong className="text-ink-700">{role === "seller" ? "seller" : "buyer"}</strong>.{" "}
        <Link href="/signup" className="font-semibold text-brand-600 hover:underline">Change</Link>
      </p>

      <form onSubmit={submit} className="mt-5 space-y-3.5" noValidate>
        <div>
          <label className="nm-label" htmlFor="full_name">Full name</label>
          <input
            id="full_name"
            className="nm-input"
            value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            placeholder="Adaeze Okonkwo"
            autoComplete="name"
          />
          {errors.full_name && <p className="mt-1 text-[12px] font-medium text-red-600">{errors.full_name}</p>}
        </div>

        <div>
          <label className="nm-label" htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            inputMode="email"
            className={cn("nm-input", errors.email && "border-red-400 focus:border-red-500 focus:ring-red-500/10")}
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
          {errors.email && (
            <p className="mt-1 flex items-start gap-1 text-[12px] font-medium text-red-600">
              <svg viewBox="0 0 24 24" className="mt-px h-3.5 w-3.5 shrink-0" fill="currentColor"><path d="M12 2 1.5 21h21L12 2Zm0 6.5 6.5 11h-13L12 8.5ZM11 11v4h2v-4h-2Zm0 5v2h2v-2h-2Z" /></svg>
              {errors.email}
            </p>
          )}
        </div>

        <div>
          <label className="nm-label" htmlFor="phone">Phone number</label>
          <input
            id="phone"
            inputMode="tel"
            className="nm-input"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="08012345678"
            autoComplete="tel"
          />
          {errors.phone && <p className="mt-1 text-[12px] font-medium text-red-600">{errors.phone}</p>}
          <p className="mt-1 text-[11.5px] text-ink-400">
            Keep this accurate — it&apos;s how you&apos;ll reset your password.
          </p>
        </div>

        <div>
          <label className="nm-label" htmlFor="password">Password</label>
          <div className="relative">
            <input
              id="password"
              type={show ? "text" : "password"}
              className={cn("nm-input pr-11", errors.password && "border-red-400")}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-400 hover:text-ink-700"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? (
                <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M6.7 6.7C4.6 8 3 10 2.2 12c1.6 3.5 5.2 6 9.8 6 1.7 0 3.3-.36 4.7-1M17.9 15.4c1.4-1.1 2.5-2.5 3.1-3.4-1.6-3.5-5.2-6-9.8-6-.6 0-1.2.05-1.7.14" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M2.2 12C3.8 8.5 7.4 6 12 6s8.2 2.5 9.8 6c-1.6 3.5-5.2 6-9.8 6s-8.2-2.5-9.8-6Z" /><circle cx="12" cy="12" r="2.6" /></svg>
              )}
            </button>
          </div>
          {form.password && (
            <div className="mt-1.5 flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full",
                    i < score ? (score <= 1 ? "bg-red-400" : score === 2 ? "bg-amber-400" : "bg-brand-500") : "bg-slate-200",
                  )}
                />
              ))}
            </div>
          )}
          {errors.password && <p className="mt-1 text-[12px] font-medium text-red-600">{errors.password}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="nm-label" htmlFor="state">State</label>
            <select
              id="state"
              className="nm-input"
              value={form.state}
              onChange={(e) => {
                const st = e.target.value;
                const first = lgasFor(st)[0] ?? "";
                setForm((f) => ({ ...f, state: st, city: first }));
              }}
            >
              {NIGERIA_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="nm-label" htmlFor="city">City / LGA</label>
            <select id="city" className="nm-input" value={form.city} onChange={(e) => set("city", e.target.value)}>
              {(lg.length ? lg : [form.city]).filter(Boolean).map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 pt-1">
          <input
            type="checkbox"
            checked={form.terms}
            onChange={(e) => set("terms", e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
          />
          <span className="text-[12.5px] leading-relaxed text-ink-600">
            I agree to the{" "}
            <Link href="/legal/terms" className="font-semibold text-brand-600 hover:underline">Terms of Service</Link>{" "}
            and{" "}
            <Link href="/legal/refunds" className="font-semibold text-brand-600 hover:underline">Refund Policy</Link>.
          </span>
        </label>
        {errors.terms && <p className="text-[12px] font-medium text-red-600">{errors.terms}</p>}

        {errors.form && <Alert tone="red">{errors.form}</Alert>}

        <button type="submit" disabled={pending} className="nm-btn-primary w-full !py-3">
          {pending ? <><Spinner /> Creating account…</> : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-center text-[13px] text-ink-500">
        Already have an account?{" "}
        <Link href="/signin" className="font-semibold text-brand-600 hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
