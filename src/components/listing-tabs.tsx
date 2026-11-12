import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The storefront's listing tabs.
 *
 * The blueprint draws the product listing and the service listing as two
 * tabs of one section — "Product Listing" and "Service Gig" side by side
 * — with a "See more" link that leads to the full sub page. Both are
 * rendered as links rather than client-side state so the tab survives a
 * refresh, can be shared, and works without JavaScript.
 */
export function ListingTabs({
  current,
  productHref,
  serviceHref,
  seeMoreHref,
  seeMoreLabel = "See more",
}: {
  current: "product" | "service";
  productHref: string;
  serviceHref: string;
  seeMoreHref: string;
  seeMoreLabel?: string;
}) {
  const tabs = [
    { key: "product" as const, label: "Product Listing", href: productHref },
    { key: "service" as const, label: "Service Gig", href: serviceHref },
  ];

  return (
    <div className="mb-3 flex items-end justify-between gap-3 border-b border-[var(--line)]">
      <div className="flex items-center gap-1">
        {tabs.map((t) => {
          const active = t.key === current;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-1 pb-2.5 pt-1 text-[15px] font-bold transition",
                active
                  ? "border-brand-600 text-ink-900"
                  : "border-transparent text-ink-400 hover:text-ink-700",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <Link
        href={seeMoreHref}
        className="mb-2.5 shrink-0 whitespace-nowrap text-[13px] font-semibold text-brand-600 hover:text-brand-700"
      >
        {seeMoreLabel} →
      </Link>
    </div>
  );
}
