"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cartCount, readCart, type Cart } from "@/lib/cart";
import { naira } from "@/lib/utils";

/** Floating cart button that only appears once the cart has something in it. */
export function CartFab() {
  const [cart, setCart] = useState<Cart>({});

  useEffect(() => {
    const sync = () => setCart(readCart());
    sync();
    window.addEventListener("nm:cart", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("nm:cart", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const n = cartCount(cart);
  if (!n) return null;

  const total = Object.values(cart).reduce(
    (sum, s) => sum + s.lines.reduce((m, l) => m + l.price * l.quantity, 0),
    0,
  );

  return (
    <Link
      href="/cart"
      className="fixed bottom-[74px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-brand-600 px-5 py-3 text-white shadow-lift transition hover:bg-brand-700 md:bottom-6"
    >
      <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/20 px-1.5 text-[12px] font-bold">{n}</span>
      <span className="text-[14px] font-semibold">View cart</span>
      <span className="text-[14px] font-bold">{naira(total)}</span>
    </Link>
  );
}
