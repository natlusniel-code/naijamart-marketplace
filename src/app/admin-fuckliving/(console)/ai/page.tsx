import { createAdminClient } from "@/lib/supabase/admin";
import { AiConsole } from "@/components/admin/ai-console";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI assistant" };

/**
 * Admin AI console.
 *
 * Reads the open suggestion queue server-side with the service-role key, the
 * same way every other admin page does. The AI itself is never called during
 * this render — every report is a button, so the page loads instantly even when
 * Teamily is slow or down.
 */
export default async function AdminAiPage() {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("ai_suggestions")
    .select("id,feature,severity,title,detail,status,created_at")
    .eq("status", "open")
    .order("severity", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  return <AiConsole suggestions={(data ?? []) as any} />;
}
