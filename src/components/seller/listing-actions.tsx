"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui";

export function ListingRowActions({ id, status, title }: { id: string; status: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  async function patch(nextStatus: string) {
    setBusy(nextStatus);
    const supabase = createClient();
    await supabase.from("listings").update({ status: nextStatus }).eq("id", id);
    setBusy("");
    router.refresh();
  }

  async function duplicate() {
    setBusy("duplicate");
    const supabase = createClient();
    const { data } = await supabase.from("listings").select("*").eq("id", id).single();
    if (data) {
      const { id: _drop, created_at, updated_at, views, ...rest } = data as any;
      await supabase.from("listings").insert({ ...rest, title: `${rest.title} (copy)`, status: "draft" });
    }
    setBusy("");
    router.refresh();
  }

  async function remove() {
    setBusy("delete");
    const supabase = createClient();
    await supabase.from("listings").delete().eq("id", id);
    setBusy("");
    setConfirmDel(false);
    router.refresh();
  }

  if (confirmDel) {
    return (
      <div className="flex items-center justify-between gap-2 py-0.5">
        <span className="truncate text-[11px] text-red-700">Delete “{title}”?</span>
        <span className="flex shrink-0 gap-1">
          <button onClick={remove} className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white">
            {busy === "delete" ? "…" : "Delete"}
          </button>
          <button onClick={() => setConfirmDel(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-ink-600">No</button>
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[11.5px] font-semibold">
      <Link href={`/seller/listings/${id}`} className="text-brand-600 hover:underline">Edit</Link>
      <button onClick={duplicate} className="text-ink-500 hover:text-ink-900">
        {busy === "duplicate" ? "…" : "Duplicate"}
      </button>
      {status === "live" ? (
        <button onClick={() => patch("hidden")} className="text-ink-500 hover:text-ink-900">
          {busy === "hidden" ? "…" : "Hide"}
        </button>
      ) : (
        <button onClick={() => patch("live")} className="text-ink-500 hover:text-ink-900">
          {busy === "live" ? "…" : "Publish"}
        </button>
      )}
      <button onClick={() => setConfirmDel(true)} className="ml-auto text-red-500 hover:text-red-700">Delete</button>
    </div>
  );
}
