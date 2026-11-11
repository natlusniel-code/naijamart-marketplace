import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

/**
 * NaijaMart's own sign-in — server side.
 *
 * ── The split ────────────────────────────────────────────────────────────
 * Supabase Auth no longer decides whether a password is correct. That is
 * `public.account_credentials` (sql/0015), checked by `nm_login()`.
 *
 * Supabase sessions are still used, because every table in this project is
 * protected by RLS keyed on `auth.uid()`. Once the password has been verified
 * here, `mintSession()` gives that user a real Supabase session, so all ~170
 * existing queries keep working untouched.
 *
 * ── Why minting needs no password ────────────────────────────────────────
 * `admin.generateLink({ type: "magiclink" })` returns a one-time
 * `hashed_token` for an existing user. `verifyOtp({ token_hash })` exchanges it
 * for a session and writes the auth cookies. The token is single-use and
 * expires in minutes, and it is only ever created on the server, after our own
 * password check has passed — so it is not a way in, it is the last step of a
 * sign-in that already succeeded.
 *
 * ── Why the service role ─────────────────────────────────────────────────
 * `nm_login` is a password oracle. It is EXECUTE-revoked from anon and
 * authenticated (sql/0015), so only this module — which runs on the server —
 * can call it. The browser never sees a hash and never talks to these RPCs.
 */

export type LoginVerdict =
  | { ok: true; userId: string; email: string; role: string }
  | { ok: false; error: "invalid" | "locked" | "banned" | "no_credentials"; retryAfter?: number };

/** Ask the database whether this email + password pair is correct. */
export async function checkPassword(email: string, password: string): Promise<LoginVerdict> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("nm_login", {
    p_email: email,
    p_password: password,
  });

  if (error) {
    // A missing function means sql/0015 has not been applied to this project.
    // Say so plainly instead of pretending the password was wrong.
    if (/could not find the function|does not exist/i.test(error.message)) {
      throw new Error(
        "Sign-in is not set up on this database yet — run sql/0015_local_auth.sql in the Supabase SQL editor.",
      );
    }
    throw new Error(error.message);
  }

  const v = data as {
    ok: boolean;
    error?: string;
    user_id?: string;
    email?: string;
    role?: string;
    retry_after_seconds?: number;
  };

  if (v.ok) {
    return { ok: true, userId: v.user_id!, email: v.email!, role: v.role ?? "buyer" };
  }

  const reason = (v.error ?? "invalid") as "invalid" | "locked" | "banned" | "no_credentials";
  return { ok: false, error: reason, retryAfter: v.retry_after_seconds };
}

/** Store (or replace) a password for an account. */
export async function setPassword(userId: string, email: string, password: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("nm_set_password", {
    p_user_id: userId,
    p_email: email,
    p_password: password,
  });
  if (error) throw new Error(error.message);
}

/**
 * Give this user a Supabase session, writing the auth cookies.
 *
 * Must be called from a Server Action or Route Handler — `cookies()` is
 * read-only in a Server Component, and the write would be silently dropped.
 */
export async function mintSession(email: string): Promise<void> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw new Error(`Could not start a session: ${error.message}`);

  // The shape differs between supabase-js versions: the token sits either at
  // the top level or under `properties`.
  const hashed =
    (data as { hashed_token?: string })?.hashed_token ??
    (data as { properties?: { hashed_token?: string } })?.properties?.hashed_token;

  if (!hashed) throw new Error("Could not start a session: no token was issued.");

  const cookieStore = cookies();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashed,
  });
  if (verifyError) throw new Error(`Could not start a session: ${verifyError.message}`);
}

/** The SSR client bound to the current request's cookies. */
export function requestClient() {
  const cookieStore = cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component: read-only. The middleware refreshes instead.
        }
      },
    },
  });
}

/** Is this address already an account (in either store)? */
export async function emailTaken(email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("nm_email_taken", { p_email: email });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** Does the phone number match the one recorded on this account? */
export async function phoneMatches(email: string, phone: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("nm_phone_matches", {
    p_email: email,
    p_phone: phone,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/**
 * Does this account have a phone number on record at all?
 *
 * Used by the reset flow to decide whether the phone is a required field: an
 * account created before phone numbers were collected must not be locked out
 * of resetting its own password.
 */
export async function accountHasPhone(email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("nm_account_has_phone", { p_email: email });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** Mint a fresh 6-digit code for this email + purpose. */
export async function issueCode(email: string, purpose: "signup" | "reset"): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("nm_issue_code", {
    p_email: email,
    p_purpose: purpose,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export type CodeVerdict =
  | { ok: true }
  | { ok: false; error: "no_code" | "expired" | "too_many" | "mismatch"; rotatedCode?: string; attemptsLeft?: number };

/** Check a retyped code. A wrong code rotates to a new one. */
export async function verifyCode(
  email: string,
  code: string,
  purpose: "signup" | "reset",
): Promise<CodeVerdict> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("nm_verify_code", {
    p_email: email,
    p_code: code,
    p_purpose: purpose,
  });
  if (error) throw new Error(error.message);

  const v = data as {
    ok: boolean;
    error?: string;
    rotated_code?: string;
    attempts_left?: number;
  };

  if (v.ok) return { ok: true };
  return {
    ok: false,
    error: (v.error ?? "mismatch") as "no_code" | "expired" | "too_many" | "mismatch",
    rotatedCode: v.rotated_code,
    attemptsLeft: v.attempts_left,
  };
}

/**
 * Create the auth user for a new account, with no email involved.
 *
 * `email_confirm: true` is what removes the confirmation email: the account is
 * born confirmed, and the code the user retypes on screen is our own check
 * (sql/0015), not Supabase's. The password given here is a throwaway — the
 * real one lives only in `account_credentials`, so a Supabase password grant
 * can never be used to sign in as this user.
 */
export async function createAccountUser(input: {
  email: string;
  fullName: string;
  phone: string;
  state: string;
  city: string;
  role: "buyer" | "seller";
}): Promise<string> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    // 48 random bytes, never shown to anyone. It exists only because the admin
    // API requires a password field.
    password: crypto.randomUUID() + crypto.randomUUID(),
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName,
      phone: input.phone,
      state: input.state,
      city: input.city,
      role: input.role,
    },
  });

  if (error) {
    if (/already|exists|registered/i.test(error.message)) {
      throw new Error("That email is already registered. Try signing in.");
    }
    throw new Error(error.message);
  }

  return data.user.id;
}
