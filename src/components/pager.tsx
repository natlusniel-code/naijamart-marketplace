import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Page links for a listing feed.
 *
 * The blueprint puts numbered page links ("Page 1", "Page 2", "Page 3",
 * ">") against the listing. They are plain links with a `?page=` query, so
 * a page is shareable, survives a refresh and works with JavaScript off —
 * no client state to get out of step with what the server rendered.
 *
 * `total` comes from `storefront_feed_count`, which applies exactly the
 * same eligibility rules as the feed itself, so the number of links can
 * never disagree with the rows.
 */
export function Pager({
  page,
  pageCount,
  basePath,
  params = {},
  className,
}: {
  page: number;
  pageCount: number;
  basePath: string;
  /** Existing query params to preserve across page links. */
  params?: Record<string, string | undefined>;
  className?: string;
}) {
  if (pageCount <= 1) return null;

  const href = (p: number) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) q.set(k, v);
    });
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  // Keep the bar short on a long feed: first, last, and a window around
  // the current page, with an ellipsis where the run is broken.
  const shown: (number | "gap")[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) {
      shown.push(p);
    } else if (shown[shown.length - 1] !== "gap") {
      shown.push("gap");
    }
  }

  return (
    <nav aria-label="Pages" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Link
        href={href(Math.max(1, page - 1))}
        aria-disabled={page <= 1}
        tabIndex={page <= 1 ? -1 : undefined}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] bg-white text-[13px] font-semibold",
          page <= 1 ? "pointer-events-none text-ink-300" : "text-ink-700 hover:border-brand-300 hover:text-brand-700",
        )}
      >
        ‹
      </Link>

      {shown.map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-[13px] text-ink-300">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={href(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-[13px] font-semibold",
              p === page
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-[var(--line)] bg-white text-ink-700 hover:border-brand-300 hover:text-brand-700",
            )}
          >
            {p}
          </Link>
        ),
      )}

      <Link
        href={href(Math.min(pageCount, page + 1))}
        aria-disabled={page >= pageCount}
        tabIndex={page >= pageCount ? -1 : undefined}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] bg-white text-[13px] font-semibold",
          page >= pageCount ? "pointer-events-none text-ink-300" : "text-ink-700 hover:border-brand-300 hover:text-brand-700",
        )}
      >
        ›
      </Link>
    </nav>
  );
}
