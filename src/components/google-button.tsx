"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchAuthProviders,
  isUnsupportedProviderError,
  markGoogleUnavailable,
  type AuthProviders,
} from "@/lib/supabase/auth-providers";
import { Spinner } from "@/components/ui";

const DEFAULT_REDIRECT = "/auth/callback";

const NOT_ENABLED_NOTE =
  "Email sign-in only for now — Google sign-in isn't enabled on this project.";

/**
 * "Continue with Google", rendered only when the project actually supports it.
 *
 * Three states:
 *   loading  → nothing (avoids a button that flashes and then vanishes)
 *   enabled  → divider + working button
 *   disabled → no button at all, just a calm one-line note explaining why
 *
 * The disabled state matters: a button that walks the user into a raw JSON
 * error page is worse than no button, so we never render one we can't honour.
 */
export function GoogleButton({
  redirectTo = DEFAULT_REDIRECT,
  label = "Continue with Google",
  onError,
}: {
  /** Path (plus query) to land on after the provider round-trip. */
  redirectTo?: string;
  label?: string;
  /** Called with a human-readable message when sign-in can't start. */
  onError?: (message: string) => void;
}) {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [busy, setBusy] = useState(false);
  const [failedHere, setFailedHere] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAuthProviders().then((p) => {
      if (alive) setProviders(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function start() {
    setBusy(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${redirectTo}`,
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });

      if (error) {
        setBusy(false);
        setFailedHere(true);
        markGoogleUnavailable();
        onError?.(
          isUnsupportedProviderError(error.message)
            ? NOT_ENABLED_NOTE
            : "We couldn't reach Google just now. Please use your email instead.",
        );
      }
      // On success the browser navigates away — leave the spinner running.
    } catch {
      setBusy(false);
      setFailedHere(true);
      onError?.("We couldn't reach Google just now. Please use your email instead.");
    }
  }

  if (!providers) return null;

  if (!providers.google || failedHere) {
    return (
      <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-500">
        {NOT_ENABLED_NOTE}
      </p>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-[var(--line)]" />
        <span className="text-[12px] font-medium text-ink-400">or</span>
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>

      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="nm-btn-ghost w-full !py-2.5"
      >
        {busy ? (
          <Spinner />
        ) : (
          <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.2h6.5c-.13 1.1-.85 2.7-2.4 3.8l-.02.14 3.5 2.7.24.02c2.2-2 3.5-5 3.5-8.7Z" />
            <path fill="#34A853" d="M12 24c3.2 0 5.9-1.06 7.8-2.9l-3.7-2.86c-1 .7-2.3 1.2-4.1 1.2-3.1 0-5.8-2.05-6.7-4.9l-.14.01-3.6 2.8-.05.13C3.4 21.3 7.4 24 12 24Z" />
            <path fill="#FBBC05" d="M5.3 14.5a7.4 7.4 0 0 1 0-4.98V9.5L1.6 6.66l-.12.05A12 12 0 0 0 0 12c0 1.9.46 3.7 1.48 5.3l3.8-2.8Z" />
            <path fill="#EA4335" d="M12 4.75c2.2 0 3.7.95 4.5 1.75l3.3-3.2C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.7 1.5 6.7l3.85 2.82C6.2 6.8 8.9 4.75 12 4.75Z" />
          </svg>
        )}
        {label}
      </button>
    </>
  );
}
