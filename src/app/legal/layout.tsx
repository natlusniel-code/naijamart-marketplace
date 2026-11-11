import Link from "next/link";

export const metadata = {
  title: "NaijaMart Marketplace Policy",
  description:
    "The NaijaMart Marketplace Policy: buyer and seller rules, payments and escrow, orders, delivery, returns, disputes, privacy and more.",
};

const NAV = [
  { href: "/legal", label: "Marketplace Policy" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/refunds", label: "Refund Policy" },
  { href: "/legal/seller-agreement", label: "Seller Agreement" },
  { href: "/legal/community-guidelines", label: "Community Guidelines" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <nav aria-label="Policy pages" className="mb-5 flex flex-wrap gap-2">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink-700 hover:border-brand-400 hover:text-brand-700"
          >
            {n.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
