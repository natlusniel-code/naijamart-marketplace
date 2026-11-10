import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { Logo, Badge } from "@/components/ui";
import { AdminNav } from "@/components/admin/admin-nav";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "NaijaMart admin" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  // Admins get their OWN sign-in page. Sending them to the buyer/seller page
  // was the bug: it offered "create a buyer account" to someone who came here
  // to administer the marketplace.
  if (!session) {
    redirect("/admin-fuckliving/signin");
  }

  // Signed in but not on the admin list. Bounce to the admin sign-in with a
  // reason, so the message is shown in the admin area rather than as a dead
  // end inside the console.
  if (!session.isAdmin) {
    redirect("/admin-fuckliving/signin?error=not_admin");
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
