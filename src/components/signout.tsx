"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  async function out() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }
  return (
    <button onClick={out} className="nm-btn-ghost w-full !py-3 !text-red-600 hover:!bg-red-50">
      Log out
    </button>
  );
}
