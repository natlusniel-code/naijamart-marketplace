"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard for the seller's public shop URL.
 *
 * The old page rendered a bare relative path (`/shop/<slug>`) inside a
 * <code> block with no copy button, so a seller who copied it got
 * something that only worked if pasted onto the same origin — and on
 * WhatsApp/Instagram it resolved to nothing. This takes the ABSOLUTE url
 * built on the server and copies exactly that.
 */
export function CopyLinkButton({ url, label = "Copy link" }: { url: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for non-secure contexts / older browsers.
        const ta = document.createElement("textarea");
        ta.value = url;
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
      className="nm-btn-primary shrink-0 !px-3 !py-2 !text-[12px]"
      aria-live="polite"
    >
      {state === "copied" ? "✓ Copied" : state === "error" ? "Copy failed" : label}
    </button>
  );
}
