"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { cartCount, readCart, type Cart } from "@/lib/cart";
import { naira } from "@/lib/utils";

/**
 * Floating cart button — draggable, but only ever docks to an edge.
 *
 * ── Why it is a small circle ───────────────────────────────────────────
 * The previous version was a full-width pill pinned to the horizontal centre
 * (`left-1/2 -translate-x-1/2`, "View cart · ₦12,000"). On a phone it sat right
 * on top of the bottom tab bar and covered listing cards and the "Add to cart"
 * bar; on desktop it floated over the middle of the content column. It was
 * always visible once the cart had anything in it, so it permanently blocked
 * whatever was underneath.
 *
 * ── Why it is draggable, and why it snaps ──────────────────────────────
 * A fixed button in one corner is still in the way for someone reading the
 * bottom of a long listing. So it can be dragged anywhere — but it may only
 * COME TO REST on the left or right edge, whichever is nearer. A button
 * parked in the middle of the screen covers the content it is meant to
 * accompany, and a half-dragged button left mid-column is worse than the
 * corner it started in.
 *
 * During the drag it follows the finger freely (that is what makes it feel
 * direct); on release it animates to the nearest edge. The chosen side and
 * the vertical position are remembered, so it stays where the user put it.
 *
 * ── Why pointer events, not mouse/touch pairs ──────────────────────────
 * `pointerdown/move/up` covers mouse, touch and pen in one path, and
 * `setPointerCapture` keeps the drag alive when the finger leaves the
 * button — without it, a fast drag drops the element the moment the pointer
 * outruns it.
 */

const KEY = "nm_cart_fab_v1";

type Dock = { side: "left" | "right"; y: number };

/** Distance from the bottom of the viewport, in px, when nothing is stored. */
const DEFAULT_BOTTOM = 88;
const SIZE = 48;
const EDGE = 16;

function readDock(): Dock {
  if (typeof window === "undefined") return { side: "right", y: 0 };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { side: "right", y: 0 };
    const d = JSON.parse(raw) as Dock;
    return {
      side: d.side === "left" ? "left" : "right",
      y: Number.isFinite(d.y) ? d.y : 0,
    };
  } catch {
    return { side: "right", y: 0 };
  }
}

export function CartFab() {
  const [cart, setCart] = useState<Cart>({});
  const [dock, setDock] = useState<Dock>({ side: "right", y: 0 });
  /** Live position while dragging; null when not dragging. */
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const moved = useRef(false);
  const start = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const router = useRouter();
  const path = usePathname() || "/";

  useEffect(() => {
    const sync = () => setCart(readCart());
    sync();
    setDock(readDock());
    setReady(true);
    window.addEventListener("nm:cart", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("nm:cart", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const n = cartCount(cart);

  /** Where the button sits when it is not being dragged. */
  const restX = useCallback(
    (side: "left" | "right") =>
      side === "left" ? EDGE : Math.max(EDGE, window.innerWidth - SIZE - EDGE),
    [],
  );

  const restY = useCallback(() => {
    const h = window.innerHeight;
    // `dock.y` is measured from the bottom, so it survives a rotation or a
    // window resize without the button jumping off-screen.
    const y = h - DEFAULT_BOTTOM - SIZE - dock.y;
    return Math.min(Math.max(EDGE, y), h - SIZE - EDGE);
  }, [dock.y]);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    // Left button only; a right-click is not a drag.
    if (e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    moved.current = false;
    start.current = {
      x: e.clientX,
      y: e.clientY,
      px: restX(dock.side),
      py: restY(),
    };
    setDrag({ x: start.current.px, y: start.current.py });
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    // A few pixels of slop, so a tap is not read as a 1px drag.
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true;
    setDrag({
      x: Math.min(Math.max(0, start.current.px + dx), window.innerWidth - SIZE),
      y: Math.min(Math.max(0, start.current.py + dy), window.innerHeight - SIZE),
    });
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    // Snap to whichever edge the button is nearest. The centre line is the
    // only decision: left of it docks left, right of it docks right.
    const centre = drag.x + SIZE / 2;
    const side: "left" | "right" = centre < window.innerWidth / 2 ? "left" : "right";

    // Store the vertical position as a distance from the bottom, clamped so
    // it can never be saved off-screen.
    const yFromBottom = window.innerHeight - (drag.y + SIZE);
    const y = Math.min(Math.max(0, yFromBottom - DEFAULT_BOTTOM), window.innerHeight - SIZE - EDGE);

    const next = { side, y };
    setDock(next);
    setDrag(null);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // storage full or blocked — the button still works, it just forgets
    }
  }

  // The cart page itself has nothing to link to, and a listing page already
  // has a sticky "Add to cart / Buy now" bar in the same corner — a floating
  // button there would sit on top of it. Everywhere else it is shown.
  const hidden = path === "/cart" || path.startsWith("/listing/");

  if (!ready || !n || hidden) return null;

  const total = Object.values(cart).reduce(
    (sum, s) => sum + s.lines.reduce((m, l) => m + l.price * l.quantity, 0),
    0,
  );

  const x = drag ? drag.x : restX(dock.side);
  const y = drag ? drag.y : restY();

  return (
    <button
      type="button"
      onClick={() => {
        // A drag must not also navigate. `moved` is set the moment the
        // pointer travels past the slop threshold.
        if (moved.current) return;
        router.push("/cart");
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-label={`View cart — ${n} item${n === 1 ? "" : "s"}, ${naira(total)}`}
      title={`View cart · ${naira(total)}`}
      className={`group fixed z-40 grid h-12 w-12 touch-none select-none place-items-center rounded-full bg-brand-600 text-white shadow-lift ring-1 ring-black/5 transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
        drag ? "cursor-grabbing" : "cursor-grab"
      }`}
      style={{
        left: x,
        top: y,
        // Only animate the snap, never the drag itself — a transition during
        // the drag would make the button lag behind the finger.
        transition: drag ? "none" : "left 220ms cubic-bezier(.2,.8,.2,1), top 220ms cubic-bezier(.2,.8,.2,1)",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[22px] w-[22px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 4h2.2l2.1 10.4a1.6 1.6 0 0 0 1.6 1.3h8.3a1.6 1.6 0 0 0 1.6-1.3L20.5 7H6" />
        <circle cx="9.5" cy="19.5" r="1.4" />
        <circle cx="17.5" cy="19.5" r="1.4" />
      </svg>

      {/* Count badge — sits on the top-right edge of the circle, outside it, so
          it never covers the icon itself. */}
      <span
        className="pointer-events-none absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10.5px] font-bold leading-none text-white ring-2 ring-white"
        aria-hidden="true"
      >
        {n > 99 ? "99+" : n}
      </span>
    </button>
  );
}
