import Link from "next/link";
import { POLICY_EFFECTIVE_DATE, POLICY_LAST_UPDATED } from "../policy-content";

export const metadata = { title: "Community Guidelines — NaijaMart" };

export default function CommunityGuidelinesPage() {
  return (
    <article>
      <h1 className="text-[24px] font-extrabold tracking-tight text-ink-900">Community Guidelines</h1>
      <p className="mt-1.5 text-[12px] text-ink-500">
        Effective {POLICY_EFFECTIVE_DATE} · Last updated {POLICY_LAST_UPDATED}
      </p>

      <div className="mt-4 space-y-4 text-[13.5px] leading-relaxed text-ink-600">
        <p>
          These guidelines form part of the{" "}
          <Link href="/legal" className="font-semibold text-brand-600 hover:underline">
            NaijaMart Marketplace Policy
          </Link>
          . They apply to chats, reviews and every other place users interact.
        </p>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">Keep it on the platform</h2>
          <p className="mt-1">
            Keep communication and payment inside NaijaMart. Messages that share phone numbers,
            email addresses, social handles, external links or payment details outside the platform
            are blocked automatically — the message is not sent at all, and the sender is warned.
          </p>
        </section>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">Be respectful</h2>
          <p className="mt-1">
            No threats, blackmail, severe insults, repeated harassment, sexual requests, hate speech
            or discrimination. No content that exploits or endangers a child — that is reported
            immediately.
          </p>
        </section>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">Be honest</h2>
          <p className="mt-1">
            No fake reviews, fake followers, fake documents or impersonation. Reviews must be honest,
            relevant and based on a real transaction.
          </p>
        </section>

        <section>
          <h2 className="text-[15px] font-bold text-ink-900">Protect your account</h2>
          <p className="mt-1">
            Never share your password, one-time codes, card details, BVN or NIN. Nobody from
            NaijaMart will ask for them in a chat.
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
