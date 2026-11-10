"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge, Avatar } from "@/components/ui";
import { shortDate } from "@/lib/utils";

export function BuyersTable({ buyers }: { buyers: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");

  async function toggleBan(id: string, banned: boolean) {
    setBusy(id);
    const supabase = createClient();
    await supabase.from("profiles").update({ is_banned: !banned }).eq("id", id);
    setBusy("");
    router.refresh();
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12px]">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-ink-400">
          <tr>
            <th className="px-4 py-2 font-semibold">Buyer</th>
            <th className="px-2 py-2 font-semibold">Location</th>
            <th className="px-2 py-2 font-semibold">Phone</th>
            <th className="px-2 py-2 font-semibold">Orders</th>
            <th className="px-2 py-2 font-semibold">Joined</th>
            <th className="px-4 py-2 font-semibold">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {buyers.map((b) => (
            <tr key={b.id}>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <Avatar name={b.full_name} src={b.avatar_url} size={26} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-900">{b.full_name}</p>
                    <p className="truncate text-[11px] text-ink-400">{b.email}</p>
                  </div>
                </div>
              </td>
              <td className="px-2 py-2 text-ink-600">{b.city}{b.state ? `, ${b.state}` : ""}</td>
              <td className="px-2 py-2 text-ink-600">{b.phone ?? "—"}</td>
              <td className="px-2 py-2 text-ink-600">{b.orderCount}</td>
              <td className="px-2 py-2 text-ink-500">{shortDate(b.created_at)}</td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  {b.is_banned && <Badge tone="red">banned</Badge>}
                  <button
                    onClick={() => toggleBan(b.id, b.is_banned)}
                    disabled={busy === b.id}
                    className={`text-[11.5px] font-semibold ${b.is_banned ? "text-brand-600" : "text-red-600"}`}
                  >
                    {busy === b.id ? "…" : b.is_banned ? "Unban" : "Ban"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
