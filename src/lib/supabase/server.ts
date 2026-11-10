import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export { SUPABASE_ANON_KEY, SUPABASE_URL };

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

/** Server-side Supabase client. RLS is always in effect — this key is the anon key. */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      // getAll/setAll is the current @supabase/ssr cookie adapter. The older
      // get/set/remove trio is deprecated and mishandles chunked cookies —
      // large session tokens are split across `sb-...auth-token.0`, `.1`, …
      // and a per-name `get` returns only the first chunk.
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The middleware refreshes the session instead — that is expected.
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
