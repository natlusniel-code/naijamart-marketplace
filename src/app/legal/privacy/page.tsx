import Link from "next/link";
import { POLICY_EFFECTIVE_DATE, POLICY_LAST_UPDATED } from "../policy-content";

export const metadata = { title: "Privacy Policy — NaijaMart" };

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="text-[24px] font-extrabold tracking-tight text-ink-900">Privacy Policy</h1>
      <p className="mt-1.5 text-[12px] text-ink-500">
        Effective {POLICY_EFFECTIVE_DATE} · Last updated {POLICY_LAST_UPDATED}
      </p>

      <div className="mt-4 space-y-4 text-[13.5px] leading-relaxed text-ink-600">
        <p>
          This Privacy Policy explains how NaijaMart handles personal information. It forms part of
          the{" "}
          <Link href="/legal" className="font-semibold text-brand-600 hover:underline">
            NaijaMart Marketplace Policy
          </Link>
          .
        </p>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">What we collect</h2>
          <p className="mt-1">
            Account details you give us (name, email, phone, city and state), the listings and
            messages you create, order and delivery information, and payment records needed to
            verify a transfer.
          </p>
        </section>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">How we use it</h2>
          <p className="mt-1">
            To run the marketplace: show listings, connect buyers and sellers, process and verify
            orders, handle disputes, prevent fraud and meet our legal obligations.
          </p>
        </section>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">What we never ask for</h2>
          <p className="mt-1">
            We never ask for your password, one-time codes, card CVV, bank PIN, BVN or NIN in a chat.
            Anyone who asks for these on the platform is attempting fraud — report them.
          </p>
        </section>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">Your choices</h2>
          <p className="mt-1">
            You can review and update your profile details at any time. To make a data-protection
            request, contact [support email].
          </p>
        </section>

        <p className="rounded-xl border border-amber-500/30 bg-amber-50 px-3.5 py-3 text-[12.5px] text-amber-900">
          This is general platform information, not legal advice. It should be reviewed by a
          qualified Nigerian lawyer before publication. Contact details are placeholders.
        </p>
      </div>
    </article>
  );
}
