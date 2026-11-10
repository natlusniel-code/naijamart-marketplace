import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const role = searchParams.get("role");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // OAuth first login: Supabase fills the profile trigger from user_metadata,
      // but the role choice lives in our query string — apply it here.
      if (user) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, state, city")
          .eq("id", user.id)
          .maybeSingle();

        const meta = user.user_metadata ?? {};
        const patch: Record<string, string> = {};
        if (!prof?.avatar_url && meta.avatar_url) patch.avatar_url = meta.avatar_url;
        if (!prof?.full_name && meta.full_name) patch.full_name = meta.full_name;
        if (role === "seller") patch.role = "seller";
        if (Object.keys(patch).length && prof) {
          await supabase.from("profiles").update(patch).eq("id", user.id);
        }
      }

      const dest = role === "seller" ? "/seller/onboarding" : next;
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=auth`);
}
