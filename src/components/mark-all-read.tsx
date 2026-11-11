"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui";

/** Marks every unread notification as read, in one call. */
export function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setBusy(true);
    const supabase = createClient();
    await supabase.rpc("mark_notifications_read", { p_ids: null });
    setBusy(false);
    startTransition(() => router.refresh());
  }

  return (
    <button onClick={run} disabled={busy} className="nm-btn-ghost shrink-0 !px-3 !py-1.5 !text-[12.5px]">
      {busy ? <Spinner /> : "Mark all read"}
    </button>
  );
}
