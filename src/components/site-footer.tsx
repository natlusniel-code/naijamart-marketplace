import Link from "next/link";
import { SupportLink } from "@/components/support-link";
import { ShareLocationButton } from "@/components/share-location-button";
import { SUPPORT_WHATSAPP_DISPLAY } from "@/lib/support";

/**
 * Site footer.
 *
 * Carries the single "Contact support" entry point for the storefront. It is
 * hidden on the mobile tab-bar breakpoint only in the sense that it sits
 * above the fixed tab bar (the layout already reserves `pb-24`), so it never
 * ends up underneath it.
 */
export function SiteFooter() {
  return (
    <footer className="mt-8 border-t border-[var(--line)] bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-[12.5px] text-ink-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="font-bold text-ink-900">NaijaMart</span>
          <Link href="/help" className="hover:text-ink-900 hover:underline">
            Help &amp; support
          </Link>
          <Link href="/search" className="hover:text-ink-900 hover:underline">
            Browse
          </Link>
          <Link href="/orders" className="hover:text-ink-900 hover:underline">
            My orders
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <SupportLink>Contact support</SupportLink>
          <span className="text-ink-300">·</span>
          <span className="text-ink-400">WhatsApp {SUPPORT_WHATSAPP_DISPLAY}</span>
        </div>
      </div>

      {/* Location sharing.
          Sits on its own row so the privacy note has room to breathe on a
          phone, and so the button is not lost among the footer links. The
          component is client-side only and never sends the coordinates
          anywhere — see src/components/share-location-button.tsx. */}
      <div className="mx-auto max-w-7xl border-t border-[var(--line)] px-4 py-4">
        <ShareLocationButton />
      </div>
    </footer>
  );
}
