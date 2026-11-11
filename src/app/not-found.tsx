import Link from "next/link";
import { supportWhatsAppUrl } from "@/lib/support";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-[26px]">🔍</div>
      <h1 className="mt-4 text-[20px] font-extrabold tracking-tight text-ink-900">We couldn&apos;t find that page</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
        The link may be broken, or the shop or listing may have been removed.
      </p>
      <div className="mt-5 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <Link href="/" className="nm-btn-primary !px-4 !py-2.5 !text-[13px]">
          Back to marketplace
        </Link>
        <Link href="/search" className="nm-btn-ghost !px-4 !py-2.5 !text-[13px]">
          Search listings
        </Link>
      </div>
      <a
        href={supportWhatsAppUrl("Hi NaijaMart support, I need help with...")}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-4 text-[12.5px] font-semibold text-brand-600 hover:underline"
      >
        Contact support on WhatsApp
      </a>
    </div>
  );
}
