import Link from "next/link";
import { Logo } from "@/components/ui";

/**
 * Shell for the admin sign-in / sign-up pages.
 *
 * Deliberately NOT `AuthSplit`: that panel sells the marketplace to buyers
 * ("Buy and hire from verified sellers in your state"), which is the wrong
 * message for someone who came here to administer it. This is a dark, plain,
 * unmistakably-admin surface with a large ADMIN wordmark so there is never any
 * doubt which door you walked through.
 */
export function AdminAuthShell({
  children,
  subtitle,
}: {
  children: React.ReactNode;
  subtitle: string;
}) {
  return (
    <div className="min-h-screen bg-[#0b1220]">
      {/* top bar */}
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Logo light />
          <span className="rounded-md bg-amber-400/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-amber-300">
            Admin
          </span>
          <Link
            href="/"
            className="ml-auto text-[12.5px] font-semibold text-white/50 hover:text-white"
          >
            Back to storefront
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[1fr_420px] lg:items-center lg:py-16">
        {/* the big ADMIN header */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-amber-400/80">
            Restricted area
          </p>
          <h1 className="mt-2 text-[clamp(3rem,11vw,6.5rem)] font-black leading-[0.85] tracking-[-0.04em] text-white">
            ADMIN
          </h1>
          <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed text-white/55">
            {subtitle}
          </p>

          <ul className="mt-6 space-y-2 text-[12.5px] text-white/40">
            <li className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-amber-400" />
              Every action here is logged against your account.
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-amber-400" />
              Only emails on the admin list can get past this page.
            </li>
          </ul>
        </div>

        {/* the form card */}
        <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/40 sm:p-7">
          {children}
        </div>
      </main>
    </div>
  );
}
