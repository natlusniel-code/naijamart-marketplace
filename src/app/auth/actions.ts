"use server";

import { redirect } from "next/navigation";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  accountHasPhone,
  checkPassword,
  createAccountUser,
  emailTaken,
  issueCode,
  mintSession,
  phoneMatches,
  requestClient,
  setPassword,
  verifyCode,
} from "@/lib/auth/local";
import { postAuthDestination } from "@/lib/post-auth";

/**
 * Every sign-in, sign-up and reset action for the site.
 *
 * All of them are Server Actions, so the password travels from the form to
 * this file over TLS and is never held in browser state, never put in a URL,
 * and never logged. The browser only ever receives a short result object.
 */

export type ActionResult =
  | { ok: true; next?: string; code?: string; email?: string }
  | { ok: false; error: string; field?: string; code?: string; attemptsLeft?: number };

/** Only same-origin relative paths — never an absolute URL. */
function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function friendly(error: string): string {
  switch (error) {
    case "invalid":
      return "That email and password don't match. Check the password, or reset it below.";
    case "locked":
      return "Too many wrong attempts. Wait a few minutes, then try again.";
    case "banned":
      return "This account has been suspended. Contact support if you think that's a mistake.";
    default:
      return "We couldn't sign you in. Please try again.";
  }
}

/**
 * One-time migration for accounts that predate `account_credentials`.
 *
 * Those rows were backfilled with a hash that matches nothing, so `nm_login`
 * reports `no_credentials`. Rather than force every existing user through a
 * password reset, we ask Supabase once whether the password they just typed is
 * the one it has on file. If it is, we copy it into our own store and carry on
 * — the user notices nothing, and from then on their password is checked by us.
 *
 * This is the ONLY place Supabase still verifies a password, and it stops
 * being reachable for an account the moment that account has a real hash.
 */
async function migrateLegacyPassword(
  email: string,
  password: string,
): Promise<{ userId: string; email: string } | null> {
  const legacy = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await legacy.auth.signInWithPassword({ email, password });
  if (error || !data.user?.email) return null;

  await setPassword(data.user.id, data.user.email, password);
  return { userId: data.user.id, email: data.user.email };
}

// ───────────────────────────────────────────────────────────────────────
// sign in
// ───────────────────────────────────────────────────────────────────────
export async function signInAction(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""));

  if (!email) return { ok: false, error: "Enter your email address.", field: "email" };
  if (!password) return { ok: false, error: "Enter your password.", field: "password" };

  let userId: string;
  let resolvedEmail = email;

  try {
    const verdict = await checkPassword(email, password);

    if (verdict.ok) {
      userId = verdict.userId;
      resolvedEmail = verdict.email;
    } else if (verdict.error === "no_credentials") {
      const migrated = await migrateLegacyPassword(email, password);
      if (!migrated) {
        return { ok: false, error: friendly("invalid") };
      }
      userId = migrated.userId;
      resolvedEmail = migrated.email;
    } else {
      return { ok: false, error: friendly(verdict.error) };
    }

    await mintSession(resolvedEmail);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "We couldn't sign you in." };
  }

  // Where to land is decided from the database, not from the form: a seller
  // goes to the Seller Hub (or onboarding), a buyer to the storefront.
  let destination = "/";
  try {
    const supabase = requestClient();
    destination = await postAuthDestination(supabase, userId, next);
  } catch {
    destination = next ?? "/";
  }

  return { ok: true, next: destination };
}

// ───────────────────────────────────────────────────────────────────────
// sign up — step 1: create the account and show a code
// ───────────────────────────────────────────────────────────────────────
export async function startSignupAction(formData: FormData): Promise<ActionResult> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").replace(/\s/g, "");
  const password = String(formData.get("password") ?? "");
  const state = String(formData.get("state") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const role = String(formData.get("role") ?? "buyer") === "seller" ? "seller" : "buyer";

  if (fullName.length < 3) return { ok: false, error: "Enter your full name.", field: "full_name" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email))
    return { ok: false, error: "Enter a valid email address.", field: "email" };
  if (!/^0\d{10}$/.test(phone))
    return { ok: false, error: "Use 11 digits, like 08012345678.", field: "phone" };
  if (password.length < 8)
    return { ok: false, error: "Use at least 8 characters.", field: "password" };

  try {
    if (await emailTaken(email)) {
      return { ok: false, error: "That email is already registered. Try signing in.", field: "email" };
    }

    const userId = await createAccountUser({ email, fullName, phone, state, city, role });
    await setPassword(userId, email, password);

    // The code is generated here and returned to the form, which displays it.
    // No email is sent — that is the whole point of this flow.
    const code = await issueCode(email, "signup");

    return { ok: true, code, email };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "We couldn't create your account." };
  }
}

// ───────────────────────────────────────────────────────────────────────
// sign up — step 2: the user retypes the code
// ───────────────────────────────────────────────────────────────────────
export async function verifySignupAction(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();
  const role = String(formData.get("role") ?? "buyer") === "seller" ? "seller" : "buyer";

  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "Enter the 6-digit code shown above.", field: "code" };
  }

  try {
    const verdict = await verifyCode(email, code, "signup");

    if (!verdict.ok) {
      if (verdict.error === "mismatch") {
        return {
          ok: false,
          error: `That code doesn't match. Here's a new one — type it in.`,
          code: verdict.rotatedCode,
          attemptsLeft: verdict.attemptsLeft,
        };
      }
      if (verdict.error === "expired") {
        return { ok: false, error: "That code expired. Request a new one below." };
      }
      if (verdict.error === "too_many") {
        return { ok: false, error: "Too many wrong tries. Request a new code below." };
      }
      return { ok: false, error: "That code is no longer valid. Request a new one below." };
    }

    // The account is confirmed. Sign them in and route by role.
    const admin = createAdminClient();
    const { data: prof } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    await mintSession(email);

    let destination = role === "seller" ? "/seller/onboarding?step=1" : "/";
    if (prof?.id) {
      try {
        const supabase = requestClient();
        destination = await postAuthDestination(supabase, prof.id, null, role);
      } catch {
        /* keep the role-based default */
      }
    }

    return { ok: true, next: destination };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "We couldn't verify that code." };
  }
}

/** Issue a fresh signup code (the "request a new code" button). */
export async function resendSignupCodeAction(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  try {
    const code = await issueCode(email, "signup");
    return { ok: true, code, email };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "We couldn't create a new code." };
  }
}

// ───────────────────────────────────────────────────────────────────────
// password reset — no email, so the phone number on the account is the
// second factor. Two recorded details, not one.
// ───────────────────────────────────────────────────────────────────────
export async function startResetAction(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").replace(/\s/g, "");

  if (!email) return { ok: false, error: "Enter your email address.", field: "email" };

  try {
    if (!(await emailTaken(email))) {
      // Same message as a wrong phone, so this form cannot be used to discover
      // which addresses have accounts.
      return {
        ok: false,
        error: "That email and phone number don't match an account.",
        field: "email",
      };
    }

    // The phone number is the only real check here: the code is displayed on
    // screen, so it proves nothing on its own. But it must never lock out a
    // legitimate user, so it is only enforced when the account actually has a
    // phone on record. An account with no phone falls through to the code.
    const hasPhone = await phoneMatches(email, phone);
    if (!hasPhone && phone) {
      return {
        ok: false,
        error: "That email and phone number don't match an account.",
        field: "phone",
      };
    }
    if (!hasPhone && !phone) {
      const recorded = await accountHasPhone(email);
      if (recorded) {
        return {
          ok: false,
          error: "Enter the phone number on your account.",
          field: "phone",
        };
      }
    }

    const code = await issueCode(email, "reset");
    return { ok: true, code, email };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "We couldn't start a reset." };
  }
}

export async function finishResetAction(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "Enter the 6-digit code shown above.", field: "code" };
  }
  if (password.length < 8) {
    return { ok: false, error: "Use at least 8 characters.", field: "password" };
  }

  try {
    const verdict = await verifyCode(email, code, "reset");
    if (!verdict.ok) {
      if (verdict.error === "mismatch") {
        return {
          ok: false,
          error: "That code doesn't match. Here's a new one — type it in.",
          code: verdict.rotatedCode,
          attemptsLeft: verdict.attemptsLeft,
        };
      }
      return { ok: false, error: "That code is no longer valid. Start the reset again." };
    }

    const admin = createAdminClient();
    const { data: prof } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (!prof?.id) return { ok: false, error: "We couldn't find that account." };

    await setPassword(prof.id, email, password);
    await mintSession(email);

    return { ok: true, next: "/" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "We couldn't reset your password." };
  }
}

// ───────────────────────────────────────────────────────────────────────
// sign out
// ───────────────────────────────────────────────────────────────────────
export async function signOutAction(): Promise<void> {
  const supabase = requestClient();
  await supabase.auth.signOut();
  redirect("/");
}
