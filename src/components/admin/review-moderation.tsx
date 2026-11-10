"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moderateReview } from "@/app/admin-fuckliving/actions";

export function ReviewModeration({ reviewId, status, flagged }: { reviewId: string; status: string; flagged: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function update(patch: { status?: "published" | "hidden" }) {
    setBusy(true);
    setErr("");
    const result = await moderateReview(reviewId, patch.status ?? (status === "published" ? "hidden" : "published"));
    setBusy(false);
    if (!result.ok) { setErr(result.error ?? "Could not save."); return; }
    router.refresh();
  }

  return (
    <div className="flex shrink-0 items-center gap-2 text-[11.5px] font-semibold">
      {status === "published" ? (
        <button disabled={busy} onClick={() => update({ status: "hidden" })} className="text-red-600">Hide</button>
      ) : (
        <button disabled={busy} onClick={() => update({ status: "published" })} className="text-brand-600">Publish</button>
      )}
      {err && <span className="text-[10.5px] font-medium text-red-600">{err}</span>}
    </div>
  );
}
