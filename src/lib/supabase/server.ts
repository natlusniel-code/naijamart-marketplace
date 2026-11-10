import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Server-side Supabase client. RLS is always in effect — this key is the anon key. */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // called from a Server Component — the middleware refreshes instead
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          /* ignore */
        }
      },
    },
  });
}

export type SessionProfile = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  state: string | null;
  city: string | null;
  role: "buyer" | "seller" | "admin";
  is_banned: boolean;
};

/** Current user + profile + admin flag, or null. One round of queries. */
export async function getSession() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, avatar_url, state, city, role, is_banned")
    .eq("id", user.id)
    .maybeSingle();

  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: shop } = await supabase
    .from("shops")
    .select("id,name,slug,status,verified,city,state,subscription_status,subscription_expires_at,description,logo_url,banner_url,category,kind,delivery_fee,free_delivery_threshold,pickup_available,bank_name,bank_account_number,bank_account_name,nin_or_cac,documents,rating_avg,rating_count,review_note,created_at")
    .eq("owner_id", user.id)
    .maybeSingle();

  const isAdmin = !!adminRow;
  const prof = (profile ?? {
    id: user.id,
    full_name: user.email?.split("@")[0] ?? "There",
    email: user.email ?? null,
    phone: null,
    avatar_url: null,
    state: null,
    city: null,
    role: "buyer",
    is_banned: false,
  }) as SessionProfile;

  return { user, profile: prof, isAdmin, shop };
}

export type Session = Awaited<ReturnType<typeof getSession>>;
