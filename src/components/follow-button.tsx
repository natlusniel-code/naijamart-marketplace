"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui";

export function FollowButton({ shopId, following, signedIn }: { shopId: string; following: boolean; signedIn: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(following);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!signedIn) {
      router.push(`/signin?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (on) {
      await supabase.from("shop_followers").delete().eq("shop_id", shopId).eq("user_id", u.user!.id);
      setOn(false);
    } else {
      await supabase.from("shop_followers").insert({ shop_id: shopId, user_id: u.user!.id });
      setOn(true);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <button onClick={toggle} disabled={busy}
      className={`nm-btn !py-2.5 !px-4 ${on ? "bg-brand-50 text-brand-700" : "nm-btn-ghost"}`}>
      {busy ? <Spinner /> : on ? "Following ✓" : "Follow"}
    </button>
  );
}
