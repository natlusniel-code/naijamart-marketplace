import Link from "next/link";
import { Card } from "@/components/ui";
import { SupportLink } from "@/components/support-link";
import { SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from "@/lib/support";

export const metadata = { title: "Help & support" };

const FAQ = [
  {
    q: "How does payment work?",
    a: "NaijaMart holds your money in escrow. The seller is only paid after you confirm the item arrived as described. If it doesn't, raise an issue on the order and support steps in.",
  },
  {
    q: "How long does delivery take?",
    a: "It depends on the seller and your city. Most sellers in your own city deliver within 1–3 days. You'll see the delivery fee and estimate at checkout.",
  },
  {
    q: "Can I buy from a seller in another city?",
    a: "Yes. The home page defaults to your city, but the location filter has an \"All cities\" option that shows every seller on NaijaMart.",
  },
  {
    q: "How do I become a seller?",
    a: "Create an account, choose \"Sell on NaijaMart\", and complete the four-step onboarding. You'll need a valid NIN or CAC number and your bank details for payouts.",
  },
  {
    q: "My order never arrived. What now?",
    a: "Open the order and tap \"Raise an issue\". Your money stays in escrow while support reviews it. You can also message us on WhatsApp with the order reference.",
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-tight text-ink-900">Help &amp; support</h1>
        <p className="mt-1 text-[13.5px] text-ink-500">
          We answer on WhatsApp — usually within a few minutes during business hours.
        </p>
      </div>

      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Talk to a human</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
          Message us on WhatsApp at <strong className="text-ink-700">{SUPPORT_WHATSAPP_DISPLAY}</strong>. Include your
          order reference if you have one — it helps us find you faster.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={supportWhatsAppUrl("Hi NaijaMart support, I need help with...")}
            target="_blank"
            rel="noreferrer noopener"
            className="nm-btn-primary !px-4 !py-2.5 !text-[13px]"
          >
            Chat on WhatsApp
          </a>
          <Link href="/orders" className="nm-btn-ghost !px-4 !py-2.5 !text-[13px]">
            My orders
          </Link>
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-[13.5px] font-bold text-ink-900">Common questions</p>
        <dl className="mt-3 space-y-3.5">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt className="text-[13px] font-semibold text-ink-900">{item.q}</dt>
              <dd className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">{item.a}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <p className="pb-2 text-center text-[12.5px] text-ink-500">
        Still stuck? <SupportLink>Contact support on WhatsApp</SupportLink>
      </p>
    </div>
  );
}
