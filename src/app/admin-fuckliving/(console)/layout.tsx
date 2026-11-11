import { Logo, Badge } from "@/components/ui";
import { AdminNav } from "@/components/admin/admin-nav";
import { hasAdminKey } from "@/lib/supabase/admin";
import Link from "next/link";

/**
 * Admin console shell.
 *
 * There is deliberately NO auth gate here — /admin-fuckliving loads directly, as
 * requested. That is safe only because the data is fetched server-side with the
 * service-role key (see `src/lib/supabase/admin.ts`) and the browser never
 * receives that key.
 *
 * `force-dynamic` is required: every admin page shows live business numbers, so
 * nothing here may be statically cached at build time.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "NaijaMart admin" };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <Logo />
          <Badge tone="gray" className="hidden sm:inline-flex">
            Admin
          </Badge>
          <div className="ml-auto flex items-center gap-3 text-[12.5px]">
            <Link href="/" className="font-semibold text-ink-500 hover:text-ink-900">
              Storefront
            </Link>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4">
          <AdminNav />
        </div>
      </header>

      {/* Safety net only. `admin.ts` ships a committed fallback key, so this
          banner should never appear in practice — it exists so that if the
          fallback is ever removed or blanked, the console says so loudly
          instead of rendering an empty dashboard that looks like "no orders yet". */}
      {!hasAdminKey && (
        <div className="mx-auto max-w-7xl px-4 pt-3">
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-900">
            <strong className="font-bold">Admin database access is not configured.</strong>{" "}
            No service-role key was found — neither{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">
              SUPABASE_SERVICE_ROLE_KEY
            </code>{" "}
            nor the committed fallback in{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">
              src/lib/supabase/admin.ts
            </code>
            . Until one is present every page below is empty and no admin action can be saved.
            See README §1d.
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-4 pb-16">{children}</main>
    </div>
  );
}
