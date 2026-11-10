"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";

/**
 * Admin sign-up.
 *
 * Creating an account is not the same as becoming an admin — `admin_users` is
 * the only source of admin truth, and a fresh project has zero rows. So this
 * form does three things:
 *
 *   1. signUp with `role: "admin"` in the metadata (the profile trigger stores
 *      it, and it is what /auth/callback reads to route the user)
 *   2. call `claim_first_admin()` — a SECURITY DEFINER function that promotes
 *      the caller ONLY while `admin_users` is empty. That is the bootstrap.
 *   3. verify the admin row actually exists before letting anyone through.
 *
 * If an admin already exists, step 2 returns false and we say so plainly
 * instead of creating a half-admin account. Further admins are added by an
 * existing admin (README §5).
 */
export function AdminSignUpForm() {
  const router = useRouter();

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [sentTo, setSentTo] = useState("");

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErr((e) => ({ ...e, [k]: "" }));
  }

  function validate() {
    const e: Record<string, string> = {};
    if (form.full_name.trim().length < 3) e.full_name = "Enter your full name.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(form.email))
      e.email = "Enter a valid email address.";
    if (form.password.length < 8) e.password = "Use at least 8 characters.";
    if (form.password !== form.confirm) e.confirm = "The passwords don't match.";
    setFieldErr(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setErr("");
    const supabase = createClient();

    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: {
          full_name: form.full_name.trim(),
          role: "admin",
        },
        emailRedirectTo: `${window.location.origin}/auth/callback?role=admin`,
      },
    });

    if (error) {
      setBusy(false);
      const m = error.message.toLowerCase();
      if (m.includes("already") || m.includes("registered") || m.includes("exists")) {
        setFieldErr({ email: "That email is already registered. Try signing in." });
      } else if (m.includes("password")) {
        setFieldErr({ password: "That password is too weak. Try a longer one." });
      } else {
        setErr(error.message);
      }
      return;
    }

    // Supabase returns a user with no identities when the email already exists.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setBusy(false);
      setFieldErr({ email: "That email is already registered. Try signing in." });
      return;
    }

    // Email confirmation is ON for this project, so there is no session yet.
    // The promotion happens in /auth/callback once the link is clicked.
    if (!data.session) {
      setBusy(false);
      setSentTo(form.email.trim());
      return;
    }

    // Confirmation is off (or already confirmed): promote right now.
    const { data: claimed, error: claimErr } = await supabase.rpc("claim_first_admin");

    if (claimErr) {
      setBusy(false);
      setErr(
        "Your account was created, but we couldn't grant admin access. Ask an existing admin to add your email to the admin list.",
      );
      return;
    }

    if (claimed !== true) {
      // An admin already exists — this is not a bootstrap.
      await supabase.auth.signOut();
      setBusy(false);
      setErr(
        "An admin already exists for this marketplace, so self sign-up can't grant admin access. Ask an existing admin to add your email, then sign in.",
      );
      return;
    }

    router.replace("/admin-fuckliving");
    router.refresh();
  }

  if (sentTo) {
    return (
      <div>
        <h2 className="text-[20px] font-extrabold tracking-tight text-ink-900">
          Confirm your email
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-600">
          We sent a confirmation link to{" "}
          <strong className="text-ink-900">{sentTo}</strong>. Open it to finish
          creating your admin account — you&apos;ll land straight in the admin
          console.
        </p>
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
          Admin access is granted when you click that link. If an admin already
          exists, the link will sign you in as a normal user instead — ask an
          existing admin to add your email.
        </p>
        <Link
          href="/admin-fuckliving/signin"
          className="nm-btn-ghost mt-5 w-full !py-2.5"
        >
          Back to admin sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-[20px] font-extrabold tracking-tight text-ink-900">
        Create admin account
      </h2>
      <p className="mt-1 text-[12.5px] text-ink-500">
        The first account created here becomes the marketplace admin.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-3.5" noValidate>
        <div>
          <label className="nm-label" htmlFor="admin-name">
            Full name
          </label>
          <input
            id="admin-name"
            className="nm-input"
            value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            placeholder="Anifowose Mutiu Ayinde"
            autoComplete="name"
          />
          {fieldErr.full_name && (
            <p className="mt-1 text-[12px] font-medium text-red-600">
              {fieldErr.full_name}
            </p>
          )}
        </div>

        <div>
          <label className="nm-label" htmlFor="admin-signup-email">
            Admin email
          </label>
          <input
            id="admin-signup-email"
            type="email"
            inputMode="email"
            className={cn("nm-input", fieldErr.email && "border-red-400")}
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="admin@naijamart.ng"
            autoComplete="email"
          />
          {fieldErr.email && (
            <p className="mt-1 text-[12px] font-medium text-red-600">
              {fieldErr.email}
            </p>
          )}
        </div>

        <div>
          <label className="nm-label" htmlFor="admin-signup-password">
            Password
          </label>
          <div className="relative">
            <input
              id="admin-signup-password"
              type={show ? "text" : "password"}
              className={cn("nm-input pr-11", fieldErr.password && "border-red-400")}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-400 hover:text-ink-700"
            >
              {show ? (
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                  <path d="M6.7 6.7C4.6 8 3 10 2.2 12c1.6 3.5 5.2 6 9.8 6 1.7 0 3.3-.36 4.7-1M17.9 15.4c1.4-1.1 2.5-2.5 3.1-3.4-1.6-3.5-5.2-6-9.8-6-.6 0-1.2.05-1.7.14" />
                </svg>
              ) : (
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M2.2 12C3.8 8.5 7.4 6 12 6s8.2 2.5 9.8 6c-1.6 3.5-5.2 6-9.8 6s-8.2-2.5-9.8-6Z" />
                  <circle cx="12" cy="12" r="2.6" />
                </svg>
              )}
            </button>
          </div>
          {fieldErr.password && (
            <p className="mt-1 text-[12px] font-medium text-red-600">
              {fieldErr.password}
            </p>
          )}
        </div>

        <div>
          <label className="nm-label" htmlFor="admin-signup-confirm">
            Confirm password
          </label>
          <input
            id="admin-signup-confirm"
            type={show ? "text" : "password"}
            className={cn("nm-input", fieldErr.confirm && "border-red-400")}
            value={form.confirm}
            onChange={(e) => set("confirm", e.target.value)}
            placeholder="Repeat your password"
            autoComplete="new-password"
          />
          {fieldErr.confirm && (
            <p className="mt-1 text-[12px] font-medium text-red-600">
              {fieldErr.confirm}
            </p>
          )}
        </div>

        {err && <Alert tone="red">{err}</Alert>}

        <button type="submit" disabled={busy} className="nm-btn-primary w-full !py-3">
          {busy ? (
            <>
              <Spinner /> Creating admin…
            </>
          ) : (
            "Create admin account"
          )}
        </button>
      </form>

      <p className="mt-5 text-center text-[12.5px] text-ink-500">
        Already an admin?{" "}
        <Link
          href="/admin-fuckliving/signin"
          className="font-semibold text-brand-600 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
