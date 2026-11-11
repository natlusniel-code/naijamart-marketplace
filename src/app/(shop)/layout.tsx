import Link from "next/link";
import { getSession } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import { Logo, Avatar } from "@/components/ui";
import { TabBar } from "@/components/tab-bar";
import { CartFab } from "@/components/cart-fab";
import { SiteFooter } from "@/components/site-footer";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const supabase = createClient();

  // Unread MESSAGES, not conversations — the old count never cleared after
  // reading a chat. Backed by the unread_message_count() RPC (sql/0009).
  let unread = 0;
  if (session) {
    const { data } = await supabase.rpc("unread_message_count");
    unread = typeof data === "number" ? data : 0;
  }

  const city = session?.profile.city ?? "Abeokuta South";

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <Logo />
          <Link
            href="/profile/location"
            className="ml-1 hidden items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-1 text-[12.5px] font-medium text-ink-700 hover:bg-slate-50 sm:inline-flex"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
            {city}, {session?.profile.state ?? "Ogun"}
            <span className="text-ink-400">▾</span>
          </Link>

          <div className="ml-auto flex items-center gap-1.5">
            {session?.shop && (
              <Link href="/seller" className="nm-btn-ghost hidden !px-3 !py-1.5 !text-[13px] sm:inline-flex">
                Seller hub
              </Link>
            )}
            {session?.isAdmin && (
              <Link href="/admin-fuckliving" className="nm-btn-ghost hidden !px-3 !py-1.5 !text-[13px] lg:inline-flex">
                Admin
              </Link>
            )}
            {session ? (
              <Link href="/profile" aria-label="Your profile">
                <Avatar name={session.profile.full_name} src={session.profile.avatar_url} size={32} />
              </Link>
            ) : (
              <Link href="/signin" className="nm-btn-primary !px-3.5 !py-1.5 !text-[13px]">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-3 md:pb-10">{children}</main>

      <SiteFooter />

      {/* Floating cart: a small circle in the bottom-right corner, above the
          mobile tab bar. Rendered once here so it is available on every shop
          page instead of only the home page. */}
      <CartFab />

      <TabBar unread={unread} />
    </div>
  );
}

export const dynamic = "force-dynamic";
