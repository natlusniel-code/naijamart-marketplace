import Link from "next/link";
import { PolicyBody } from "../policy-body";
import { POLICY_EFFECTIVE_DATE, POLICY_LAST_UPDATED } from "../policy-content";

export const metadata = {
  title: "Terms of Service — NaijaMart",
  description:
    "The NaijaMart Terms of Service — buyer and seller rules, payments and escrow, orders, delivery, returns, disputes and more.",
};

/**
 * Several places in the app link to /legal/terms (signup, profile, auth split,
 * signup details). The canonical policy document lives at /legal, and this route
 * renders the same content so those links resolve instead of 404-ing.
 *
 * It renders rather than redirects: a redirect() here produced a 307 with no
 * Location header on Vercel, which left the link broken in a different way.
 */
export default function TermsPage() {
  return (
    <article>
      <header className="mb-5">
        <h1 className="text-[24px] font-extrabold leading-tight tracking-tight text-ink-900 sm:text-[28px]">
          Terms of Service
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-500">
          These terms form part of the NaijaMart Marketplace Policy and apply to every buyer and
          seller using the platform.
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-500">
          <div className="flex gap-1.5">
            <dt className="font-semibold text-ink-700">Effective date:</dt>
            <dd>{POLICY_EFFECTIVE_DATE}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-semibold text-ink-700">Last updated:</dt>
            <dd>{POLICY_LAST_UPDATED}</dd>
          </div>
        </dl>
      </header>

      <div
        role="note"
        className="mb-6 rounded-xl border border-amber-500/30 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-900"
      >
        <p className="font-bold">Please read this first</p>
        <p className="mt-1">
          This policy is general platform information. It is not legal advice, and it has not been
          approved or certified by any regulator. It should be reviewed by a qualified Nigerian
          lawyer before publication. Items in square brackets — such as [support email],
          [registered company name] and [registered company address] — are placeholders that must be
          filled in with the company&apos;s real details.
        </p>
      </div>

      <PolicyBody />

      <footer className="mt-10 border-t border-[var(--line)] pt-5">
        <p className="text-[12px] font-bold uppercase tracking-wide text-ink-400">Related policies</p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          <li>
            <Link href="/legal" className="text-[13px] font-semibold text-brand-600 hover:underline">
              Marketplace Policy
            </Link>
          </li>
          <li>
            <Link href="/legal/privacy" className="text-[13px] font-semibold text-brand-600 hover:underline">
              Privacy Policy
            </Link>
          </li>
          <li>
            <Link href="/legal/refunds" className="text-[13px] font-semibold text-brand-600 hover:underline">
              Refund Policy
            </Link>
          </li>
          <li>
            <Link href="/legal/seller-agreement" className="text-[13px] font-semibold text-brand-600 hover:underline">
              Seller Agreement
            </Link>
          </li>
          <li>
            <Link href="/legal/community-guidelines" className="text-[13px] font-semibold text-brand-600 hover:underline">
              Community Guidelines
            </Link>
          </li>
        </ul>
        <p className="mt-4 text-[11.5px] leading-relaxed text-ink-400">
          Questions about these terms? Contact [support email] or [support phone/WhatsApp].
        </p>
      </footer>
    </article>
  );
}
