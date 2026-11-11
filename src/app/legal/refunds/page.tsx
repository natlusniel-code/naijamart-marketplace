import Link from "next/link";
import { POLICY_EFFECTIVE_DATE, POLICY_LAST_UPDATED } from "../policy-content";

export const metadata = { title: "Refund Policy — NaijaMart" };

export default function RefundsPage() {
  return (
    <article>
      <h1 className="text-[24px] font-extrabold tracking-tight text-ink-900">Refund Policy</h1>
      <p className="mt-1.5 text-[12px] text-ink-500">
        Effective {POLICY_EFFECTIVE_DATE} · Last updated {POLICY_LAST_UPDATED}
      </p>

      <div className="mt-4 space-y-4 text-[13.5px] leading-relaxed text-ink-600">
        <p>
          This Refund Policy forms part of the{" "}
          <Link href="/legal" className="font-semibold text-brand-600 hover:underline">
            NaijaMart Marketplace Policy
          </Link>
          . Section 6 (Orders, Delivery, Cancellation and Returns) and Section 7 (Disputes and Buyer
          Protection) set out the full rules.
        </p>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">When a refund applies</h2>
          <ul className="mt-1 ml-4 list-disc space-y-1">
            <li>The seller does not accept the order within 24 hours.</li>
            <li>The item never arrives, or arrives materially different from the listing.</li>
            <li>A dispute is decided in the buyer&apos;s favour.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">When a return may not apply</h2>
          <p className="mt-1">
            Digital products, customized goods, perishable goods and completed services may have
            limited return rights where the law permits. The item, the seller&apos;s stated policy,
            its condition and applicable law all matter.
          </p>
        </section>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">How to ask for one</h2>
          <p className="mt-1">
            Open the order, choose to raise an issue, and submit your evidence — photos, videos,
            delivery records and messages. We review the evidence and the platform records and tell
            you the outcome.
          </p>
        </section>

        <p className="rounded-xl border border-amber-500/30 bg-amber-50 px-3.5 py-3 text-[12.5px] text-amber-900">
          This is general platform information, not legal advice. It should be reviewed by a
          qualified Nigerian lawyer before publication.
        </p>
      </div>
    </article>
  );
}
