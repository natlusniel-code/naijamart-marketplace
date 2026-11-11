import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { sellerGatePath } from "@/lib/seller-gate";
import { isBuyerAccount } from "@/lib/roles";
import { Logo, Badge, Avatar } from "@/components/ui";
import { SellerNav } from "@/components/seller/seller-nav";
import { InstallAppPrompt } from "@/components/install-app-prompt";

export const dynamic = "force-dynamic";

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/signin?next=%2Fseller");

  // ── Buyers never see the Seller Hub ──────────────────────────────────────
  // The hub is seller-only. A buyer account can still own a `shops` row (an
  // earlier shop, a re-assigned or seeded row), and the approval gate below
  // would then let them straight into the seller dashboard and its account
  // settings page. The role is the authority: a buyer goes to the storefront.
  //
  // `isBuyerAccount` (src/lib/roles.ts) is the one shared rule: a seller is an
  // account with role 'seller'/'admin' OR one that owns a shop. The database
  // enforces that agreement (sql/0014), so a genuine buyer — who owns no shop —
  // is always caught here, and a real seller is never locked out by a stale
  // role read.
  if (isBuyerAccount(session.profile, session.shop)) redirect("/");

  // ── The approval gate ────────────────────────────────────────────────────
  // Every seller-only page lives under this layout, so this one check is what
  // keeps an unapproved seller out of the hub. They are sent back to the exact
  // step they are on (business profile → verification → plan → pending
  // approval) instead of seeing a dashboard for a shop that is not live.
  //
  // `/seller/onboarding` is NOT under this layout (it is a sibling route), so
  // this redirect can never loop.
  const gate = sellerGatePath(session.shop);
  if (gate) redirect(gate);

  const shop = session.shop;

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Logo />
          <Badge tone="blue" className="hidden sm:inline-flex">Seller hub</Badge>
          {shop && (
            <Link
              href={`/shop/${shop.slug}`}
              className="ml-1 hidden text-[12.5px] font-semibold text-brand-600 hover:underline sm:inline"
            >
              View public shop ↗
            </Link>
          )}
          <div className="ml-auto flex items-center gap-3">
            <Link href="/" className="text-[12.5px] font-semibold text-ink-500 hover:text-ink-900">
              Marketplace
            </Link>
            <Link href="/profile" aria-label="Profile">
              <Avatar name={session.profile.full_name} src={session.profile.avatar_url} size={30} />
            </Link>
          </div>
        </div>
        {shop && (
          <div className="mx-auto max-w-6xl px-4">
            <SellerNav />
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4 pb-16">{children}</main>

      {/* Sellers get the same "Install app" offer as buyers — the request was
          for every signed-in user, not only the storefront. */}
      <InstallAppPrompt />
    </div>
  );
}
