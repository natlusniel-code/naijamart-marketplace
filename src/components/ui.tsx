import Link from "next/link";
import { cn, initials } from "@/lib/utils";

/* ------------------------------------------------------------------ Logo */
export function Logo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7h14l-1.5 9H5.2L3 7Z" />
          <path d="M17 7V5H19" />
          <circle cx="7" cy="19" r="1.4" />
          <circle cx="15" cy="19" r="1.4" />
        </svg>
      </span>
      {!compact && (
        <span className={cn("text-[17px] font-extrabold tracking-tight", light ? "text-white" : "text-ink-900")}>
          Naija<span className="text-brand-500">Mart</span>
        </span>
      )}
    </Link>
  );
}

/* ------------------------------------------------------------------ Badge */
const TONES = {
  green: "bg-brand-50 text-brand-700 ring-brand-500/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-500/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-500/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-500/20",
  gray: "bg-slate-100 text-slate-600 ring-slate-400/20",
  red: "bg-red-50 text-red-700 ring-red-500/20",
} as const;

export function Badge({
  children,
  tone = "gray",
  className,
  dot = false,
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11.5px] font-semibold text-brand-700", className)}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
        <path d="M12 2 15.1 4.6l4.1.2.2 4.1L22 12l-2.6 3.1-.2 4.1-4.1.2L12 22l-3.1-2.6-4.1-.2-.2-4.1L2 12l2.6-3.1.2-4.1 4.1-.2L12 2Z" opacity=".18" />
        <path d="m10.6 14.6-2.2-2.2 1.1-1.1 1.1 1.1 3.9-3.9 1.1 1.1-5 5Z" />
      </svg>
      Verified
    </span>
  );
}

export function OrderStatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: keyof typeof TONES }> = {
    pending_payment: { label: "Pending payment", tone: "amber" },
    paid: { label: "Payment confirmed", tone: "blue" },
    accepted: { label: "Accepted", tone: "blue" },
    processing: { label: "Processing", tone: "blue" },
    shipped: { label: "Shipped", tone: "violet" },
    ready_for_pickup: { label: "Ready", tone: "violet" },
    delivered: { label: "Delivered", tone: "green" },
    completed: { label: "Completed", tone: "green" },
    cancelled: { label: "Cancelled", tone: "gray" },
    disputed: { label: "Disputed", tone: "red" },
  };
  const s = map[status] ?? { label: status, tone: "gray" as const };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function Star({ value, count, className }: { value: number; count?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-amber-400">
        <path d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7L12 17.3Z" />
      </svg>
      <span className="text-[12.5px] font-semibold text-ink-700">{value ? value.toFixed(1) : "New"}</span>
      {typeof count === "number" && count > 0 && <span className="text-[12px] text-ink-400">({count})</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ Avatar */
export function Avatar({
  name,
  src,
  size = 36,
  className,
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? "Avatar"}
        width={size}
        height={size}
        className={cn("rounded-full object-cover ring-1 ring-black/5", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn("grid place-items-center rounded-full bg-brand-100 font-bold text-brand-700", className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ Card */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("nm-card", className)}>{children}</div>;
}

export function SectionHead({
  title,
  action,
  href,
  sub,
}: {
  title: string;
  action?: string;
  href?: string;
  sub?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[16.5px] font-bold text-ink-900">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-ink-500">{sub}</p>}
      </div>
      {action && href && (
        <Link href={href} className="shrink-0 text-[13px] font-semibold text-brand-600 hover:text-brand-700">
          {action} →
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Empty */
export function EmptyState({
  icon = "📦",
  title,
  body,
  action,
  href,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: string;
  href?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-white/60 px-6 py-12 text-center">
      <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-2xl">{icon}</div>
      <h3 className="text-[15.5px] font-bold text-ink-900">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink-500">{body}</p>}
      {action && href && (
        <Link href={href} className="nm-btn-soft mt-4">
          {action}
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Alert */
export function Alert({
  tone = "green",
  title,
  children,
}: {
  tone?: "green" | "amber" | "red" | "blue";
  title?: string;
  children: React.ReactNode;
}) {
  const map = {
    green: "bg-brand-50 text-brand-900 border-brand-500/20",
    amber: "bg-amber-50 text-amber-900 border-amber-500/25",
    red: "bg-red-50 text-red-900 border-red-500/25",
    blue: "bg-sky-50 text-sky-900 border-sky-500/20",
  };
  return (
    <div className={cn("rounded-xl border px-3.5 py-3 text-[13px]", map[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={cn(title && "mt-1", "leading-relaxed opacity-90")}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ Spinner */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity=".25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ Stat */
export function Stat({
  label,
  value,
  hint,
  tone = "plain",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "plain" | "brand" | "amber" | "red";
  icon?: React.ReactNode;
}) {
  const bg = {
    plain: "bg-white",
    brand: "bg-brand-50/70",
    amber: "bg-amber-50/70",
    red: "bg-red-50/60",
  }[tone];
  return (
    <div className={cn("nm-card p-4", bg)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12.5px] font-medium text-ink-500">{label}</p>
        {icon}
      </div>
      <p className="mt-1.5 text-[21px] font-extrabold tracking-tight text-ink-900">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-ink-400">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ Tabs (link based) */
export function Tabs({
  items,
  current,
}: {
  items: { label: string; href: string; count?: number }[];
  current: string;
}) {
  return (
    <div className="nm-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {items.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn("nm-chip", active && "nm-chip-active")}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span className={cn("rounded-full px-1.5 py-px text-[11px]", active ? "bg-brand-500 text-white" : "bg-slate-100 text-ink-500")}>
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
