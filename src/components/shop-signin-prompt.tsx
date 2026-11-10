import Link from "next/link";

/** Shown to visitors of a public shop page — browsing is open, buying is not. */
export function ShopSignInPrompt() {
  return (
    <div className="fixed bottom-[62px] left-0 right-0 z-30 px-4 pb-2 md:bottom-4">
      <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-[var(--line)] bg-white/95 px-4 py-3 shadow-lift backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-ink-900">Sign in to buy or chat</p>
          <p className="text-[11.5px] text-ink-500">Browsing is free — you only need an account to order.</p>
        </div>
        <Link href="/signin" className="nm-btn-primary shrink-0 !px-3.5 !py-2 !text-[13px]">Sign in</Link>
      </div>
    </div>
  );
}
