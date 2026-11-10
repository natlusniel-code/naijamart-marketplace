"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner, Alert } from "@/components/ui";

/** Opens (or creates) a buyer↔seller chat, then navigates to it. */
export function ChatWithSeller({
  shopId,
  orderId,
  className,
  label = "Chat with seller",
  signedIn,
}: {
  shopId: string;
  orderId?: string;
  className?: string;
  label?: string;
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
    const supabase = createClient();
    const { data, error } = await supabase.rpc("start_chat", {
      p_shop_id: shopId,
      p_order_id: orderId ?? null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.push(`/chats/${data}`);
  }

  return (
    <>
      <button onClick={go} disabled={busy} className={className ?? "nm-btn-ghost w-full"}>
        {busy ? <Spinner /> : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.5 12c0 4.1-3.8 7.4-8.5 7.4-1 0-1.9-.15-2.8-.42L4 21l1.3-3.6A7 7 0 0 1 3.5 12C3.5 7.9 7.3 4.6 12 4.6s8.5 3.3 8.5 7.4Z" />
          </svg>
        )}
        {label}
      </button>
      {err && <p className="mt-1.5 text-[12px] font-medium text-red-600">{err}</p>}
    </>
  );
}
