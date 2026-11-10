import Link from "next/link";
import { getSession } from "@/lib/supabase/server";
import { NIGERIA_STATES, lgasFor } from "@/lib/utils";
import { Card } from "@/components/ui";
import { LocationPicker } from "@/components/location-picker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your location" };

export default async function LocationPage() {
  const session = await getSession();
  const city = session?.profile.city ?? "Abeokuta South";
  const state = session?.profile.state ?? "Ogun";

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">Your location</h1>
        <p className="mt-1 text-[13px] text-ink-500">
          We show you sellers near you. You can browse any city, but you can only order inside your own.
        </p>
      </div>

      <Card className="p-4">
        {session ? (
          <LocationPicker initial={{ state, city }} />
        ) : (
          <div className="text-center">
            <p className="text-[13.5px] text-ink-600">Sign in to save your city.</p>
            <Link href="/signin?next=%2Fprofile%2Flocation" className="nm-btn-primary mt-3 inline-flex">Sign in</Link>
          </div>
        )}
      </Card>

      {!session && (
        <Card className="p-4">
          <p className="text-[12.5px] font-semibold text-ink-900">Browse as a guest</p>
          <p className="mt-1 text-[12.5px] text-ink-500">
            Pick a city to browse: {["Abeokuta South", "Ikeja", "Ibadan North", "Port Harcourt"].join(", ")}.
          </p>
        </Card>
      )}
    </div>
  );
}
