import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import { isSellerAccount } from "@/lib/roles";
import { Logo, Avatar } from "@/components/ui";
import { TabBar } from "@/components/tab-bar";
import { CartFab } from "@/components/cart-fab";
import { SiteFooter } from "@/components/site-footer";
import { NotificationBell } from "@/components/notification-bell";
import { InstallAppPrompt } from "@/components/install-app-prompt";
import { SupportChat } from "@/components/support-chat";
import { SUPPORT_WHATSAPP } from "@/lib/support";

/**
 * Pages a seller is still allowed to open inside the storefront shell.
 *
 * A seller is not a shopper: the storefront is the buyer's surface, and a
 * seller landing on it means they are browsing instead of running their shop.
 * But a blanket redirect would break real flows, so these are the exceptions:
 *
 *   /shop/<their own slug>  their own public page — the hub links to it, and
 *                           they need to see what buyers see before sharing it
 *   /listing/…              a listing detail, reachable from their own shop
 *   /orders/…               an order detail, opened from a chat or a notification
 *   /profile                account settings, which is not a shopping surface
 *   /help, /legal           support and policy pages
 *
 * Everything else — the home feed, search, wishlist, cart, checkout, the shop
 * directory, and other sellers' pages — sends them to the hub.
 */
const SELLER_ALLOWED_PREFIXES = ["/listing/", "/orders/", "/profile", "/help", "/legal"];

function sellerMayView(pathname: string, ownSlug: string | null | undefined): boolean {
  if (pathname === "/") return false;
  // Their OWN public shop page, and only that one. `/shop/` is deliberately not
  // a blanket prefix: another seller's shop is the storefront, and a seller
  // browsing competitors is exactly what this rule exists to stop.
  if (ownSlug && pathname === `/shop/${ownSlug}`) return true;
  // `/shop` with no slug is the directory of all shops — browsing, not allowed.
  if (pathname === "/shop" || pathname === "/shop/") return false;
  return SELLER_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p));
}

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const supabase = createClient();

  // ── Sellers do not shop ───────────────────────────────────────────────────
  // The role is the authority (src/lib/roles.ts): an account with role
  // 'seller'/'admin', or one that owns a shop. The pathname comes from the
  // `x-pathname` header the middleware sets, because a layout cannot read the
  // current URL on its own.
  const isSeller = !!session && isSellerAccount(session.profile, session.shop);
  if (isSeller) {
    const pathname = headers().get("x-pathname") ?? "";
    if (!sellerMayView(pathname, session.shop?.slug)) redirect("/seller");
  }

  // Unread MESSAGES, not conversations — the old count never cleared after
  // reading a chat. Backed by the unread_message_count() RPC (sql/0009).
  let unread = 0;
  // Unread NOTIFICATIONS — a separate count from messages, shown on the bell.
  let unreadNotifications = 0;
  if (session) {
    const [{ data: msgCount }, { data: notifCount }] = await Promise.all([
      supabase.rpc("unread_message_count"),
      supabase.rpc("unread_notification_count"),
    ]);
    unread = typeof msgCount === "number" ? msgCount : 0;
    unreadNotifications = typeof notifCount === "number" ? notifCount : 0;
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
            {session && <NotificationBell unread={unreadNotifications} />}
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
          page instead of only the home page.

          Hidden for a seller: they are only on this shell to look at their own
          shop or an order, and a cart button would invite them to buy from
          themselves. */}
      {!isSeller && <CartFab />}

      {/* "Install app" toast — only for a signed-in user, and only when the
          browser can actually install the app. It sits above the mobile tab
          bar and never blocks the page. See install-app-prompt.tsx. */}
      {session && <InstallAppPrompt />}

      {/* The buyer tab bar (Home / Search / Saved / Chats / Orders / Profile) is
          the shopper's navigation. A seller gets the hub's own nav instead, so
          showing it here would offer routes that immediately redirect. */}
      {!isSeller && <TabBar unread={unread} />}

      {/* Support assistant. Answers from the fixed policy document and hands
          off to WhatsApp when it is unsure — it never invents a policy. Hidden
          for sellers, who have their own hub. */}
      {!isSeller && <SupportChat whatsapp={SUPPORT_WHATSAPP} />}
    </div>
  );
}

export const dynamic = "force-dynamic";
