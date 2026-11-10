import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { Logo, Badge } from "@/components/ui";
import { AdminNav } from "@/components/admin/admin-nav";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "NaijaMart admin" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect(`/signin?next=${encodeURIComponent("/admin-fuckliving")}`);
  }

  if (!session.isAdmin) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="nm-card w-full max-w-sm p-6 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-xl">🔒</div>
          <h1 className="mt-3 text-[18px] font-extrabold text-ink-900">Admins only</h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
            This account isn&apos;t on the admin list. Ask an existing admin to add your email to{" "}
            <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">admin_users</code>, or run the SQL in the README.
          </p>
          <p className="mt-2 text-[11.5px] text-ink-400">{session.profile.email}</p>
          <Link href="/" className="nm-btn-ghost mt-4 w-full">Back to the marketplace</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <Logo />
          <Badge tone="gray" className="hidden sm:inline-flex">Admin</Badge>
          <div className="ml-auto flex items-center gap-3 text-[12.5px]">
            <Link href="/" className="font-semibold text-ink-500 hover:text-ink-900">Storefront</Link>
            <span className="hidden text-ink-400 sm:inline">{session.profile.email}</span>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4">
          <AdminNav />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-4 pb-16">{children}</main>
    </div>
  );
}
