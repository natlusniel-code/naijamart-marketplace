"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard for a single value shown at checkout.
 *
 * Buyers pay by bank transfer, so they have to retype the bank, the account
 * number and the exact amount into their banking app. Retyping a 10-digit
 * account number is where transfers go wrong — one wrong digit and the money
 * lands in a stranger's account, or bounces and the order sits unpaid.
 *
 * `value` is what gets copied; `children` is what is displayed. They differ
 * for the amount: the buyer reads "₦12,500" but a transfer form wants
 * "12500", so the formatted string is never what lands on the clipboard.
 */
export function CopyValue({
  value,
  label,
  children,
  mono = false,
  className = "",
}: {
  value: string;
  /** Accessible name, e.g. "account number". Used in the button's aria-label. */
  label: string;
  children?: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback for non-secure contexts / older browsers.
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={mono ? "font-mono font-semibold tracking-wide" : "font-semibold"}>
        {children ?? value}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={state === "copied" ? `${label} copied` : `Copy ${label}`}
        title={`Copy ${label}`}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-brand-700/60 transition hover:bg-brand-500/15 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {state === "copied" ? (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M4 10.5l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : state === "error" ? (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M10 5v6M10 14.5v.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <rect x="7" y="7" width="9" height="9" rx="1.6" />
            <path d="M13 7V5.6A1.6 1.6 0 0011.4 4H5.6A1.6 1.6 0 004 5.6v5.8A1.6 1.6 0 005.6 13H7" strokeLinecap="round" />
          </svg>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? `${label} copied to clipboard` : state === "error" ? `Could not copy ${label}` : ""}
      </span>
    </span>
  );
}

/**
 * Copies the whole payment block in one go, formatted for pasting into a
 * bank app's narration field or a WhatsApp message to support.
 */
export function CopyPaymentDetails({
  bank,
  accountNumber,
  accountName,
  amount,
  amountLabel,
}: {
  bank: string;
  accountNumber: string;
  accountName: string;
  /** Plain digits — what a transfer form expects. */
  amount: string;
  /** Formatted for humans, e.g. "₦12,500". */
  amountLabel: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  const text = [
    `Bank: ${bank}`,
    `Account number: ${accountNumber}`,
    `Account name: ${accountName}`,
    `Amount: ${amountLabel}`,
  ].join("\n");

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-500/30 bg-white/70 px-3 py-2 text-[12px] font-semibold text-brand-800 transition hover:border-brand-500/60 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {state === "copied" ? (
        <>
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M4 10.5l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Payment details copied
        </>
      ) : state === "error" ? (
        "Could not copy — select the details above"
      ) : (
        <>
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <rect x="7" y="7" width="9" height="9" rx="1.6" />
            <path d="M13 7V5.6A1.6 1.6 0 0011.4 4H5.6A1.6 1.6 0 004 5.6v5.8A1.6 1.6 0 005.6 13H7" strokeLinecap="round" />
          </svg>
          Copy all payment details
        </>
      )}
    </button>
  );
}
