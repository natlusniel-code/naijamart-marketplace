"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui";

export function ReviewReply({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (text.trim().length < 2) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("reviews").update({ seller_reply: text.trim() }).eq("id", reviewId);
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[12px] font-semibold text-brand-600 hover:underline">
        Reply to this review
      </button>
    );
  }

  return (
    <div>
      <textarea rows={2} className="nm-input resize-none !text-[12.5px]" placeholder="Thanks for the feedback…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-1.5 flex gap-1.5">
        <button onClick={send} disabled={busy} className="nm-btn-primary !px-3 !py-1.5 !text-[11.5px]">
          {busy ? <Spinner className="!h-3 !w-3" /> : "Post reply"}
        </button>
        <button onClick={() => setOpen(false)} className="nm-btn-ghost !px-3 !py-1.5 !text-[11.5px]">Cancel</button>
      </div>
    </div>
  );
}
