import Link from "next/link";
import { Logo, Badge } from "@/components/ui";

const BULLETS = [
  {
    title: "Verified sellers only",
    body: "Every shop sends ID, bank details and a registration number before it can list.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 4.5 6v6c0 4.4 3.1 7.7 7.5 9 4.4-1.3 7.5-4.6 7.5-9V6L12 3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "We hold your money until you confirm delivery",
    body: "You transfer to NaijaMart, not to the seller. We release the money after you confirm.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="6.5" width="17" height="12" rx="2.5" />
        <path d="M3.5 10.5h17" />
        <circle cx="12" cy="14.5" r="1.6" />
      </svg>
    ),
  },
  {
    title: "Chat directly with service providers",
    body: "Describe the job, get a quote, and pay only when you accept the offer.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.5 12c0 4.1-3.8 7.4-8.5 7.4-1 0-1.9-.15-2.8-.42L4 21l1.3-3.6A7 7 0 0 1 3.5 12C3.5 7.9 7.3 4.6 12 4.6s8.5 3.3 8.5 7.4Z" />
      </svg>
    ),
  },
];

export function AuthSplit({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* left, brand panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-600 p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-black/10" />

        <Logo light />

        <div className="relative max-w-md">
          <h1 className="text-[34px] font-extrabold leading-[1.15] tracking-tight">
            Buy and hire from verified sellers in your state.
          </h1>
          <ul className="mt-8 space-y-5">
            {BULLETS.map((b) => (
              <li key={b.title} className="flex gap-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15">
                  {b.icon}
                </span>
                <div>
                  <p className="text-[14.5px] font-semibold">{b.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-white/70">{b.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11.5px] leading-relaxed text-white/55">
          By continuing you agree to our{" "}
          <Link href="/legal/terms" className="underline">Terms</Link> and{" "}
          <Link href="/legal/refunds" className="underline">Refund Policy</Link>.
        </p>
      </aside>

      {/* right, form */}
      <section className="flex flex-col bg-white">
        <div className="flex items-center justify-between px-4 py-3.5 lg:hidden">
          <Logo />
          <Badge tone="green" dot>Escrow protected</Badge>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-10 pt-2 sm:px-8">
          <div className="w-full max-w-[430px] nm-rise">{children}</div>
        </div>
      </section>
    </div>
  );
}
