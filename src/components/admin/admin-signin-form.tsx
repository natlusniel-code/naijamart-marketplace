"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Spinner, Alert } from "@/components/ui";

/**
 * Admin sign-in.
 *
 * Two gates, in this order:
 *   1. credentials  — signInWithPassword
 *   2. authorisation — is this user on `admin_users`?
 *
 * Gate 2 is the important one. A valid buyer/seller account is NOT an admin,
 * and letting them through to the console only to be bounced by the layout
 * would be a confusing half-login. So we check the admin row here, and if it
 * is missing we sign the session straight back out and say so plainly.
 *
 * The check is a plain `select` on `admin_users` filtered to the caller's own
 * id — the RLS policy `admin_users_self` allows exactly that and nothing more,
 * so this cannot be used to enumerate admins.
 */
export function AdminSignInForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  // Deep links from the console layout / auth callback.
  const errorCode = params.get("error");
  useEffect(() => {
    if (!errorCode) return;
    const messages: Record<string, string> = {
      not_admin:
        "That account isn't an admin. Sign in with an admin email, or ask an existing admin to add you.",
      expired:
        "That confirmation link has expired or was already used. Sign in again, or request a fresh link.",
      auth: "We couldn't complete that sign-in. Please try again.",
    };
    setErr(messages[errorCode] ?? messages.auth);
  }, [errorCode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!email.trim()) fe.email = "Enter your admin email address.";
    if (!password) fe.password = "Enter your password.";
    setFieldErr(fe);
    setErr("");
    if (Object.keys(fe).length) return;

    setBusy(true);
    const supabase = createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setBusy(false);
      const m = error.message.toLowerCase();
      if (m.includes("invalid login") || m.includes("credentials")) {
        setErr("That email and password don't match.");
      } else if (m.includes("not confirmed") || m.includes("confirm")) {
        setErr(
          "This email isn't confirmed yet. Open the confirmation link we emailed you, then sign in.",
        );
      } else {
        setErr(error.message);
      }
      return;
    }

    // Gate 2 — authorisation.
    const uid = data.user?.id;
    const { data: adminRow, error: adminErr } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", uid)
      .maybeSingle();

    if (adminErr) {
      setBusy(false);
      setErr("We couldn't verify your admin access. Please try again.");
      return;
    }

    if (!adminRow) {
      // Do not leave a half-authenticated session behind.
      await supabase.auth.signOut();
      setBusy(false);
      setErr(
        "That account isn't an admin. This area is limited to emails on the admin list — sign in with an admin account, or ask an existing admin to add you.",
      );
      return;
    }

    // Straight to the console. Never the buyer or seller pages.
    router.replace("/admin-fuckliving");
    router.refresh();
  }

  return (
    <div>
      <h2 className="text-[20px] font-extrabold tracking-tight text-ink-900">
        Admin sign in
      </h2>
      <p className="mt-1 text-[12.5px] text-ink-500">
        Use the email address on the admin list.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-3.5" noValidate>
        <div>
          <label className="nm-label" htmlFor="admin-email">
            Admin email
          </label>
          <input
            id="admin-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErr((f) => ({ ...f, email: "" }));
            }}
            className={cn("nm-input", fieldErr.email && "border-red-400")}
            placeholder="admin@naijamart.ng"
          />
          {fieldErr.email && (
            <p className="mt-1 text-[12px] font-medium text-red-600">
              {fieldErr.email}
            </p>
          )}
        </div>

        <div>
          <label className="nm-label" htmlFor="admin-password">
            Password
          </label>
          <div className="relative">
            <input
              id="admin-password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldErr((f) => ({ ...f, password: "" }));
              }}
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

        {err && <Alert tone="red">{err}</Alert>}

        <button type="submit" disabled={busy} className="nm-btn-primary w-full !py-3">
          {busy ? (
            <>
              <Spinner /> Checking access…
            </>
          ) : (
            "Sign in to admin"
          )}
        </button>
      </form>

      <p className="mt-5 text-center text-[12.5px] text-ink-500">
        Need an admin account?{" "}
        <Link
          href="/admin-fuckliving/signup"
          className="font-semibold text-brand-600 hover:underline"
        >
          Create one
        </Link>
      </p>
      <p className="mt-2 text-center text-[11.5px] text-ink-400">
        Not an admin?{" "}
        <Link href="/signin" className="font-semibold text-ink-600 hover:underline">
          Buyer / seller sign in
        </Link>
      </p>
    </div>
  );
}
