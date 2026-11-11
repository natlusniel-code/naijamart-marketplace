/**
 * The NaijaMart Marketplace Policy, as data.
 *
 * Kept in one place so the page, the search index and any future
 * "print / export" view all read the same text. Plain English, written
 * for Nigeria. Every company-specific detail is a clearly marked
 * placeholder — nothing here invents a registration number, address,
 * fee, licence or legal guarantee.
 */

export const POLICY_EFFECTIVE_DATE = "11 November 2026";
export const POLICY_LAST_UPDATED = "11 November 2026";

export type PolicySection = {
  id: string;
  number: number;
  title: string;
  /** Paragraphs of body text. */
  body: string[];
  /** Optional bullet list rendered after the paragraphs. */
  bullets?: string[];
};

export const POLICY_SECTIONS: PolicySection[] = [
  {
    id: "introduction",
    number: 1,
    title: "Introduction and Acceptance",
    body: [
      "NaijaMart is a marketplace that connects buyers and sellers of products and services. We provide the platform; the seller provides the product or service.",
      "By using NaijaMart — browsing, listing, chatting, ordering or paying — you accept this policy and the other policies it links to. If you do not accept them, please do not use the platform.",
      "You must give accurate information when you register and keep it up to date, and you must keep your account secure. Do not share your password, one-time codes or account access with anyone.",
    ],
  },
  {
    id: "buyer-policy",
    number: 2,
    title: "Buyer Policy",
    body: [
      "Before you order, review the item description, the price, the seller's information, the delivery details and the return conditions. Ask the seller questions in the chat if anything is unclear.",
      "You must not use NaijaMart for fraud, chargeback abuse, harassment or the purchase of anything illegal.",
      "If something goes wrong with an order, report it promptly through the platform so we can look into it while the details are still fresh.",
    ],
  },
  {
    id: "seller-policy",
    number: 3,
    title: "Seller Policy",
    body: [
      "Sellers must describe items accurately, use genuine images of what they are actually selling, and state correct prices, stock availability and delivery information.",
      "You may only list lawful products and services that comply with Nigerian law. You must fulfil confirmed orders, communicate professionally, and must not list counterfeit, stolen, dangerous or otherwise prohibited goods.",
      "NaijaMart may suspend or remove listings and accounts that violate this policy.",
    ],
  },
  {
    id: "prohibited",
    number: 4,
    title: "Prohibited Products and Activities",
    body: [
      "The following are not allowed on NaijaMart, and anything else prohibited by Nigerian law:",
    ],
    bullets: [
      "Illegal drugs, weapons and stolen goods",
      "Counterfeit goods and fraudulent documents",
      "Unsafe products and adult exploitation",
      "Hate content",
      "Scams and impersonation",
      "Account sharing and review manipulation",
      "Unauthorized scraping and malware",
      "Any attempt to bypass platform security",
    ],
  },
  {
    id: "payments",
    number: 5,
    title: "Payments and Escrow",
    body: [
      "Payments may be held temporarily while an order is processed or a dispute is reviewed. This is a holding arrangement, not a bank deposit and not guaranteed insurance.",
      "Sellers are paid according to the platform's order, delivery, confirmation, cancellation and dispute rules. Where possible, keep your payment and communication records inside the platform so there is a clear record if something goes wrong.",
    ],
  },
  {
    id: "orders",
    number: 6,
    title: "Orders, Delivery, Cancellation and Returns",
    body: [
      "This section covers order confirmation, seller fulfilment, delivery, cancellation, failed delivery and refund handling.",
      "Whether an item can be returned depends on the item itself, the seller's policy, its condition and applicable law. Digital products, customized goods, perishable goods and completed services may have limited return rights where the law permits.",
    ],
  },
  {
    id: "disputes",
    number: 7,
    title: "Disputes and Buyer Protection",
    body: [
      "To raise a dispute, open the order, submit your evidence, describe the problem clearly and cooperate with the review.",
      "Evidence may include photos, videos, delivery records, messages and payment information. NaijaMart may decide the outcome based on the available evidence and platform records.",
    ],
  },
  {
    id: "reviews",
    number: 8,
    title: "Reviews and User Content",
    body: [
      "Reviews must be honest, relevant and based on real transactions. Do not post fake reviews, threats, other people's personal data, hate speech, spam or defamatory content.",
      "NaijaMart may remove content that violates this policy or the law.",
    ],
  },
  {
    id: "fees",
    number: 9,
    title: "Fees, Taxes and Payouts",
    body: [
      "Listing, transaction, subscription, delivery or payout fees may apply. Where possible, fees are shown clearly before you confirm.",
      "You are responsible for your own taxes and legal obligations.",
    ],
  },
  {
    id: "privacy",
    number: 10,
    title: "Privacy and Account Security",
    body: [
      "Personal information is handled according to the Privacy Policy.",
      "Never share your password, one-time codes, payment credentials or private account links with anyone. If you suspect unauthorized access to your account, report it to support immediately.",
    ],
  },
  {
    id: "ip",
    number: 11,
    title: "Intellectual Property",
    body: [
      "You must own, or have permission to use, the images, logos, descriptions and videos you upload.",
      "NaijaMart may use content you submit to operate, promote and improve the marketplace, subject to the Privacy Policy and applicable law.",
    ],
  },
  {
    id: "liability",
    number: 12,
    title: "Limitation of Responsibility",
    body: [
      "Sellers are responsible for their listings, products, services, fulfilment and legal compliance.",
      "NaijaMart is a marketplace. We do not manufacture, own or guarantee every listed product or service. Nothing in this policy removes rights that cannot legally be excluded under Nigerian law.",
    ],
  },
  {
    id: "suspension",
    number: 13,
    title: "Suspension and Termination",
    body: [
      "NaijaMart may restrict, suspend or terminate accounts for fraud, abuse, non-payment, policy violations, legal requests or security risks.",
      "Pending orders, refunds, disputes and lawful obligations may continue after suspension or termination.",
    ],
  },
  {
    id: "changes",
    number: 14,
    title: "Policy Changes",
    body: [
      "NaijaMart may update this policy and will publish the revised version with an updated effective date. Material changes will be communicated where the law requires it.",
    ],
  },
  {
    id: "contact",
    number: 15,
    title: "Contact and Complaints",
    body: [
      "Support contact: [support email] and [support phone/WhatsApp].",
      "To make a complaint, report a safety issue, report fraud, or make a data-protection request, contact support through the details above. We will acknowledge your report and explain the next steps.",
    ],
  },
  {
    id: "governing-law",
    number: 16,
    title: "Governing Law",
    body: [
      "This policy is drafted for Nigeria. The company's registered legal name and address are [registered company name] and [registered company address].",
      "This policy has not been reviewed or approved by any regulator or legal body.",
    ],
  },
];

/** Flattened, lowercased text used by the on-page search. */
export function policySearchText(s: PolicySection): string {
  return [s.title, ...s.body, ...(s.bullets ?? [])].join(" ").toLowerCase();
}
