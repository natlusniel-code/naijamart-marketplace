"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function ReviewModeration({ reviewId, status, flagged }: { reviewId: string; status: string; flagged: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function update(patch: Record<string, any>) {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("reviews").update(patch).eq("id", reviewId);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex shrink-0 items-center gap-2 text-[11.5px] font-semibold">
      {status === "published" ? (
        <button disabled={busy} onClick={() => update({ status: "hidden" })} className="text-red-600">Hide</button>
      ) : (
        <button disabled={busy} onClick={() => update({ status: "published", flagged: false })} className="text-brand-600">Publish</button>
      )}
      <button disabled={busy} onClick={() => update({ flagged: !flagged })} className="text-ink-500">
        {flagged ? "Unflag" : "Flag"}
      </button>
    </div>
  );
}
