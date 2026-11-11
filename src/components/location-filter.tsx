import Link from "next/link";
import { cn } from "@/lib/utils";
import { ALL_CITIES, type Place } from "@/lib/queries";

/**
 * City / state filter.
 *
 * Defaults to the buyer's own city, but every other city is one tap away
 * and "All cities" removes the filter entirely — buyers can always browse
 * the whole marketplace, they just start local.
 *
 * Rendered as links (not a client component) so it works without JS and
 * keeps the current query string intact.
 */
export function LocationFilter({
  places,
  activeCity,
  myCity,
  basePath,
  params,
  className,
}: {
  places: Place[];
  /** null = all cities */
  activeCity: string | null;
  myCity: string | null;
  basePath: string;
  /** existing query params to preserve when switching city */
  params?: Record<string, string | undefined>;
  className?: string;
}) {
  const href = (city: string | null) => {
    const p = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => {
      if (v && k !== "city") p.set(k, v);
    });
    if (city) p.set("city", city);
    else p.set("city", ALL_CITIES);
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const isAll = activeCity === null;

  return (
    <div className={cn("nm-scroll -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1", className)}>
      <span className="shrink-0 text-[12px] font-semibold text-ink-400">Location</span>

      <Link
        href={href(null)}
        className={cn("nm-chip shrink-0", isAll && "nm-chip-active")}
        aria-current={isAll ? "true" : undefined}
      >
        🌍 All cities
      </Link>

      {places.map((p) => {
        const active = activeCity === p.city;
        const mine = myCity === p.city;
        return (
          <Link
            key={`${p.city}-${p.state ?? ""}`}
            href={href(p.city)}
            className={cn("nm-chip shrink-0", active && "nm-chip-active")}
            aria-current={active ? "true" : undefined}
            title={p.state ? `${p.city}, ${p.state}` : p.city}
          >
            {mine && <span aria-hidden>📍</span>}
            {p.city}
            <span className={cn("ml-1 text-[10.5px]", active ? "opacity-80" : "text-ink-400")}>{p.shop_count}</span>
          </Link>
        );
      })}

      {myCity && !places.some((p) => p.city === myCity) && (
        <Link href={href(myCity)} className={cn("nm-chip shrink-0", activeCity === myCity && "nm-chip-active")}>
          📍 {myCity}
        </Link>
      )}
    </div>
  );
}
