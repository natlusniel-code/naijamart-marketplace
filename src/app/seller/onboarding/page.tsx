import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { getCategories, getSettings } from "@/lib/queries";
import { onboardingStepFor, isApprovedSeller } from "@/lib/seller-gate";
import { OnboardingFlow } from "@/components/seller/onboarding-flow";
import { Logo, Avatar } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Seller onboarding" };

/**
 * Seller onboarding — business profile → verification → plan → approval wait.
 *
 * This route deliberately sits OUTSIDE the `(hub)` route group, so it does not
 * inherit the hub's approval gate. That is what makes the gate safe: the hub
 * layout redirects unapproved sellers here, and this page must be reachable or
 * the redirect would loop.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { step?: string };
}) {
  const session = await getSession();
  const [categories, settings] = await Promise.all([getCategories(), getSettings()]);

  const shop = session?.shop ?? null;

  // An approved seller has finished onboarding — the hub is theirs now.
  if (isApprovedSeller(shop)) redirect("/seller");

  // The step is derived from the shop row, never from the query string alone,
  // so a refresh, a deep link, or a stale `?step=1` cannot skip a stage. The
  // query string is only honoured when it does not move the seller backwards
  // past what they have already completed.
  const derived = onboardingStepFor(shop);
  const requested = Number(searchParams.step ?? 0);
  const step =
    requested >= derived && requested <= 4 ? (requested as 1 | 2 | 3 | 4) : derived;

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Logo />
          <div className="ml-auto flex items-center gap-3">
            <Link href="/" className="text-[12.5px] font-semibold text-ink-500 hover:text-ink-900">
              Marketplace
            </Link>
            {session && (
              <Link href="/profile" aria-label="Profile">
                <Avatar name={session.profile.full_name} src={session.profile.avatar_url} size={30} />
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4 pb-16">
        <OnboardingFlow
          step={step}
          shop={shop ?? undefined}
          signedIn={!!session}
          categories={categories.map((c: any) => ({ name: c.name }))}
          subscriptionPrice={Number(settings.subscription_price)}
          bank={{
            bank_name: settings.bank_name,
            bank_account_number: settings.bank_account_number,
            bank_account_name: settings.bank_account_name,
          }}
          initial={{ city: session?.profile.city ?? "Abeokuta South", state: session?.profile.state ?? "Ogun" }}
        />
      </main>
    </div>
  );
}
