"use client";

import Link from "next/link";
import { useEffect } from "react";
import { supportWhatsAppUrl } from "@/lib/support";

/**
 * Route-level error boundary.
 *
 * Without this, a thrown error in any page shows Next's bare "Application
 * error: a client-side exception has occurred" screen with no way out and no
 * way to reach us. This gives the user a retry, a route home, and the one
 * WhatsApp support link.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest in the console so a support conversation can quote it.
    console.error("Route error:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-[26px]">⚠️</div>
      <h1 className="mt-4 text-[20px] font-extrabold tracking-tight text-ink-900">Something went wrong</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
        That page didn&apos;t load. Try again — if it keeps happening, message us on WhatsApp and we&apos;ll sort it out.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-[11px] text-ink-400">Reference: {error.digest}</p>
      )}

      <div className="mt-5 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <button onClick={reset} className="nm-btn-primary !px-4 !py-2.5 !text-[13px]">
          Try again
        </button>
        <Link href="/" className="nm-btn-ghost !px-4 !py-2.5 !text-[13px]">
          Back to marketplace
        </Link>
      </div>

      <a
        href={supportWhatsAppUrl(
          `Hi NaijaMart support, I need help with... (error reference: ${error.digest ?? "none"})`,
        )}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-4 text-[12.5px] font-semibold text-brand-600 hover:underline"
      >
        Contact support on WhatsApp
      </a>
    </div>
  );
}
