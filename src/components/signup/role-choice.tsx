"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui";

type Role = "buyer" | "seller";

const CARDS: { key: Role; emoji: string; title: string; body: string }[] = [
  { key: "buyer", emoji: "🛒", title: "I want to buy / hire", body: "Shop goods or book a service from verified sellers near you." },
  { key: "seller", emoji: "🏪", title: "I want to sell / offer services", body: "Open a shop, list your products or offer your skills." },
];

export function RoleChoice() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);

  function next() {
    if (!role) return;
    setBusy(true);
    router.push(`/signup/details?role=${role}`);
  }

  return (
    <div>
      <h1 className="text-[26px] font-extrabold tracking-tight text-ink-900">Create your account</h1>
      <p className="mt-1.5 text-[14px] text-ink-500">
        Tell us what you&apos;re here for. You can always add a shop later.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => {
          const active = role === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setRole(c.key)}
              aria-pressed={active}
              className={cn(
                "relative rounded-2xl border-2 p-4 text-left transition",
                active
                  ? "border-brand-500 bg-brand-50/60 shadow-card"
                  : "border-[var(--line)] bg-white hover:border-brand-300 hover:bg-brand-50/30",
              )}
            >
              <span className="text-2xl">{c.emoji}</span>
              <p className="mt-2 text-[14.5px] font-bold leading-snug text-ink-900">{c.title}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{c.body}</p>
              <span
                className={cn(
                  "absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full border-2",
                  active ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300",
                )}
              >
                {active && (
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3.5}>
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <button onClick={next} disabled={!role || busy} className="nm-btn-primary mt-6 w-full !py-3">
        {busy ? <Spinner /> : null}
        Continue
      </button>

      <p className="mt-5 text-center text-[13px] text-ink-500">
        Already have an account?{" "}
        <a href="/signin" className="font-semibold text-brand-600 hover:underline">Sign in</a>
      </p>
    </div>
  );
}
