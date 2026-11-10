"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCategory, toggleCategory } from "@/app/admin-fuckliving/actions";
import { Badge } from "@/components/ui";
import { slugify } from "@/lib/utils";

export function CategoryManager({ categories }: { categories: any[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setBusy(true);
    const result = await addCategory(
      name.trim(),
      slugify(name),
      (categories.at(-1)?.sort_order ?? 0) + 10,
    );
    setBusy(false);
    if (!result.ok) { setErr(result.error ?? "Could not add."); return; }
    setErr("");
    setName("");
    router.refresh();
  }

  async function toggle(id: string, active: boolean) {
    const result = await toggleCategory(id, active);
    if (!result.ok) { setErr(result.error ?? "Could not update."); return; }
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={add} className="flex gap-1.5">
        <input className="nm-input !py-1.5 !text-[12px]" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={busy} className="nm-btn-primary !px-3 !py-1.5 !text-[11.5px]">Add</button>
      </form>
      {err && <p className="mt-1 text-[10.5px] font-medium text-red-600">{err}</p>}

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
