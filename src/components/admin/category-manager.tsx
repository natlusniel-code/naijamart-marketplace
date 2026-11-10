"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui";
import { slugify } from "@/lib/utils";

export function CategoryManager({ categories }: { categories: any[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("categories").insert({
      name: name.trim(),
      slug: slugify(name),
      sort_order: (categories.at(-1)?.sort_order ?? 0) + 10,
      icon: "🏷️",
    });
    setName("");
    setBusy(false);
    router.refresh();
  }

  async function toggle(id: string, active: boolean) {
    const supabase = createClient();
    await supabase.from("categories").update({ active: !active }).eq("id", id);
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={add} className="flex gap-1.5">
        <input className="nm-input !py-1.5 !text-[12px]" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={busy} className="nm-btn-primary !px-3 !py-1.5 !text-[11.5px]">Add</button>
      </form>

      <ul className="mt-2 divide-y divide-[var(--line)]">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
            <span className="flex items-center gap-1.5 text-[12.5px] text-ink-700">
              <span>{c.icon}</span>
              {c.name}
              {!c.active && <Badge tone="gray">hidden</Badge>}
            </span>
            <button onClick={() => toggle(c.id, c.active)} className="text-[11.5px] font-semibold text-ink-500 hover:text-ink-900">
              {c.active ? "Hide" : "Show"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
