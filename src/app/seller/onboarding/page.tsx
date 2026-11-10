import { getSession } from "@/lib/supabase/server";
import { getCategories, getSettings } from "@/lib/queries";
import { OnboardingFlow } from "@/components/seller/onboarding-flow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Seller onboarding" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { step?: string };
}) {
  const session = await getSession();
  const [categories, settings] = await Promise.all([getCategories(), getSettings()]);

  const shop = session?.shop ?? null;
  let step = Number(searchParams.step ?? 1);

  // derive the real step from the shop's state so refresh/deep-link works
  if (shop) {
    if (shop.status === "approved") step = 4;
    else if (shop.subscription_status === "pending") step = 4;
    else if (!searchParams.step) {
      step = shop.bank_account_number ? 3 : 2;
    }
  }
  if (![1, 2, 3, 4].includes(step)) step = 1;

  return (
    <OnboardingFlow
      step={step as 1 | 2 | 3 | 4}
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
  );
}
