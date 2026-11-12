"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui";
import { openChatWithDraft } from "@/lib/offer-draft";

/**
 * A small pill pinned to the viewport: "💬 Chat — Seller".
 *
 * ── Why it is fixed, not in the page flow ─────────────────────────
 * The seller card that carried "Chat with seller" / "Visit shop" sat at the
 * bottom of the listing column. On the gig pages it landed BELOW the reviews,
 * so a buyer who was reading the plan had to scroll past every review to
 * reach the one action that matters on a service: talking to the provider.
 * The pill is `position: fixed`, so it stays reachable while the page scrolls
 * under it — that is the whole point of it existing.
 *
 * ── Why `pb-24` matters ───────────────────────────────────────────
 * A fixed element is out of the flow: without a spacer it covers whatever
 * happens to be at the bottom of the viewport. Callers add bottom padding to
 * the page so the last review can still be read past the pill. On a phone it
 * sits above the tab bar (`bottom-[70px]`); on a wide screen the tab bar is
 * gone, so it drops to the corner at `lg:bottom-6`.
 *
 * The draft is optional: the gig page has no plan selected at this level, so
 * it opens an empty composer, while the cart passes the plan text through.
 */
export function ChatPill({
  shopId,
  shopName,
  shopLogo,
  draft,
  signedIn,
}: {
  shopId: string;
  shopName: string;
  shopLogo: string | null;
  draft?: string | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    if (!signedIn) {
      router.push(`/signin?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const href = await openChatWithDraft({ shopId, draft });
      router.push(href);
    } catch (e: any) {
      setBusy(false);
      setErr(e?.message ?? "Could not open the chat.");
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[70px] z-40 flex justify-center px-4 lg:bottom-6">
      <div className="pointer-events-auto w-full max-w-sm">
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="flex w-full items-center gap-2.5 rounded-full border border-[var(--line)] bg-white/95 py-2 pl-2 pr-3.5 shadow-lift backdrop-blur transition hover:border-brand-400 hover:bg-white active:scale-[0.99]"
        >
          {/* seller mark */}
          {shopLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shopLogo}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--line)]"
            />
          ) : (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-500 text-[11px] font-bold text-white">
              {shopName.slice(0, 2).toUpperCase()}
            </span>
          )}

          <span className="flex min-w-0 items-center gap-1.5">
            {busy ? (
              <Spinner className="!h-4 !w-4" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0 text-brand-600"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20.5 12c0 4.1-3.8 7.4-8.5 7.4-1 0-1.9-.15-2.8-.42L4 21l1.3-3.6A7 7 0 0 1 3.5 12C3.5 7.9 7.3 4.6 12 4.6s8.5 3.3 8.5 7.4Z" />
              </svg>
            )}
            <span className="truncate text-[13px] font-bold text-ink-900">
              Chat <span className="font-medium text-ink-400">—</span> {shopName}
            </span>
          </span>

          <span className="ml-auto shrink-0 text-ink-300" aria-hidden="true">
            ›
          </span>
        </button>
        {err && (
          <p className="mt-1.5 text-center text-[11.5px] font-medium text-red-600">{err}</p>
        )}
      </div>
    </div>
  );
}
