import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { SupportChat } from "@/components/support-chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask support" };

/**
 * Ask Support — the buyer's AI support assistant.
 *
 * ── Why it lives under /profile ───────────────────────────────────────
 * The buyer's settings surface is the profile page, and that is where a
 * shopper looks for "help with my account". Putting it here means it is
 * reachable from settings, which is what was asked for, without adding a
 * new top-level nav item for a feature used occasionally.
 *
 * ── Why it redirects ──────────────────────────────────────────────────
 * The assistant reads the buyer's own orders, so there is nothing useful
 * to show a signed-out visitor. Sending them to sign-in with a `next`
 * back here is better than an empty chat that answers "you have no
 * orders".
 */
export default async function SupportPage() {
  const session = await getSession();
  if (!session) redirect("/signin?next=%2Fprofile%2Fsupport");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/profile" className="text-[12.5px] font-semibold text-brand-600">
          ← Back to profile
        </Link>
        <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-ink-900">Ask support</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          Ask about your orders, delivery, pickup or payments. It reads your own orders and the
          platform rules.
        </p>
      </div>

      <Card className="p-4">
        <SupportChat />
      </Card>

      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Need a human?</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
          The Help page has the FAQ and a WhatsApp link to NaijaMart support. If an order went
          wrong, open it and tap “Raise an issue” — your money stays in escrow while it is reviewed.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/help" className="nm-btn-ghost">
            Help &amp; support
          </Link>
          <Link href="/orders" className="nm-btn-ghost">
            My orders
          </Link>
        </div>
      </Card>
    </div>
  );
}
