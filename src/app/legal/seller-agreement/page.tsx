import Link from "next/link";
import { POLICY_EFFECTIVE_DATE, POLICY_LAST_UPDATED } from "../policy-content";

export const metadata = { title: "Seller Agreement — NaijaMart" };

export default function SellerAgreementPage() {
  return (
    <article>
      <h1 className="text-[24px] font-extrabold tracking-tight text-ink-900">Seller Agreement</h1>
      <p className="mt-1.5 text-[12px] text-ink-500">
        Effective {POLICY_EFFECTIVE_DATE} · Last updated {POLICY_LAST_UPDATED}
      </p>

      <div className="mt-4 space-y-4 text-[13.5px] leading-relaxed text-ink-600">
        <p>
          This Seller Agreement forms part of the{" "}
          <Link href="/legal" className="font-semibold text-brand-600 hover:underline">
            NaijaMart Marketplace Policy
          </Link>
          . Section 3 (Seller Policy) and Section 9 (Fees, Taxes and Payouts) apply in full.
        </p>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">Your listings</h2>
          <p className="mt-1">
            Describe items accurately, use genuine images, and keep prices, stock and delivery
            information correct. Only list lawful products and services that comply with Nigerian
            law. No counterfeit, stolen, dangerous or prohibited goods.
          </p>
        </section>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">Fulfilling orders</h2>
          <p className="mt-1">
            Accept or decline an order within 24 hours. Fulfil confirmed orders, communicate
            professionally, and keep the buyer informed about delivery.
          </p>
        </section>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">Getting paid</h2>
          <p className="mt-1">
            Your net amount (after the platform commission) is queued when the buyer confirms
            delivery, and unlocks <strong>4 days after delivery confirmation</strong>. You can then
            request a withdrawal to your registered bank account.
          </p>
        </section>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">Suspension</h2>
          <p className="mt-1">
            NaijaMart may suspend or remove listings and accounts that violate policy. Pending
            orders, refunds, disputes and lawful obligations may continue after suspension.
          </p>
        </section>

        <p className="rounded-xl border border-amber-500/30 bg-amber-50 px-3.5 py-3 text-[12.5px] text-amber-900">
          This is general platform information, not legal advice. It should be reviewed by a
          qualified Nigerian lawyer before publication. Company details are placeholders.
        </p>
      </div>
    </article>
  );
}
