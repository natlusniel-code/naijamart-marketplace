"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  labelForPath,
  startLoading,
  stopLoading,
  stopAllNavigation,
  getLoaderState,
} from "@/lib/global-loader";

/**
 * Wires the site's navigation and network activity into the global loader.
 *
 * Mounted once in the root layout. It does three things, because Next's App
 * Router gives no single "navigation started" event:
 *
 *   1. **Click interceptor** (capture phase, on `document`). Any same-origin
 *      `<a>` click starts a navigation load immediately — before the router
 *      has done anything — which is what makes the overlay appear on the same
 *      frame as the click rather than after a round trip. It also swallows the
 *      click while a blocking load is on screen, so a double click cannot
 *      start two navigations.
 *
 *   2. **`history.pushState` / `replaceState` patch.** `router.push()` from
 *      code (the sign-in form, the checkout flow) never produces a click, so
 *      without this those navigations would be silent. Only a real path
 *      change starts a load — Next also calls these during hydration and
 *      scroll restoration, and those must not flash the overlay.
 *
 *   3. **`fetch` patch.** Every request the app makes (Supabase included, it
 *      uses `fetch` under the hood) is counted, so a search, a filter, an
 *      add-to-cart or a list refresh shows the loader too. These are
 *      non-blocking and delayed by `DATA_SHOW_DELAY`, so a fast request never
 *      flashes anything.
 *
 * The load is ended by the `usePathname` / `useSearchParams` effect below:
 * those only change once the new route has rendered, which is exactly the
 * "hide when the page has finished loading" the brief asks for.
 */
export function GlobalLoaderTriggers() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navToken = useRef<string | null>(null);
  const lastUrl = useRef<string>("");

  // ── End a navigation load when the new route has rendered ────────────────
  useEffect(() => {
    const url = `${pathname}?${searchParams?.toString() ?? ""}`;
    if (lastUrl.current !== url) {
      lastUrl.current = url;
      // Stop EVERY navigation token, not just the newest one. A superseded
      // navigation (two clicks in one tick) would otherwise stay pending and
      // keep the overlay on screen forever — the stuck search loader.
      stopAllNavigation();
      navToken.current = null;
    }
  }, [pathname, searchParams]);

  // ── Click interceptor ────────────────────────────────────────────────────
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Only a plain left click navigates. Ctrl/cmd/shift/middle-click open a
      // new tab, which is not a navigation of THIS page.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as Element | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;

      // ── A control INSIDE the link is not a navigation ────────────────────
      //
      // The product cards wrap a whole card in `<a>` and place the wishlist
      // heart as a `<button>` inside it. That button's handler calls
      // `preventDefault()` (and `stopPropagation()`), so clicking the heart
      // stays on the page. The capture listener below runs BEFORE React's
      // handler — so it saw a click on an `<a>`, started a navigation load,
      // and then nothing ever stopped it: the overlay stayed up with
      // `pointer-events: auto` covering the viewport for the rest of the
      // session. That is precisely "the site is not scrolling at all".
      //
      // A button, input or label inside a link is always its own action, never
      // the link's destination, so it must not start a navigation load.
      const nested = target?.closest?.(
        'button, [role="button"], input, select, textarea, label, summary, [data-no-nav-loader]',
      );
      if (nested && anchor.contains(nested)) return;

      const href = anchor.getAttribute("href");
      if (!href) return;
      // New tab / external / download / hash-only / mailto: not our business.
      if (anchor.getAttribute("target") === "_blank") return;
      if (anchor.hasAttribute("download")) return;
      if (/^(https?:)?\/\//i.test(href)) return;
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return;
      if (href.startsWith("#")) return;

      // A blocking load is already on screen: swallow the click so a double
      // click cannot queue a second navigation.
      if (getLoaderState().visible && getLoaderState().blocking) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      // Clicking the page you are already on is not a load.
      const here = `${window.location.pathname}${window.location.search}`;
      const there = `${url.pathname}${url.search}`;
      if (here === there) return;

      // One navigation at a time. Without this, a second click in the same
      // tick starts a second token that nothing will ever stop.
      if (navToken.current) return;

      navToken.current = startLoading("navigation", labelForPath(url.pathname));
    }

    // Capture phase: run before React's own handlers, so the overlay is up
    // before the router starts working.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // ── Programmatic navigation (router.push) ────────────────────────────────
  useEffect(() => {
    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);

    function begin(url: URL | null | undefined) {
      if (!url) return;
      if (url.origin !== window.location.origin) return;
      const here = `${window.location.pathname}${window.location.search}`;
      const there = `${url.pathname}${url.search}`;
      if (here === there) return;
      if (navToken.current) return; // already tracking one
      navToken.current = startLoading("navigation", labelForPath(url.pathname));
    }

    history.pushState = function (data: any, unused: string, url?: string | URL | null) {
      try {
        begin(url ? new URL(String(url), window.location.href) : null);
      } catch {
        /* ignore a malformed url */
      }
      return originalPush(data, unused, url as any);
    };

    history.replaceState = function (data: any, unused: string, url?: string | URL | null) {
      try {
        begin(url ? new URL(String(url), window.location.href) : null);
      } catch {
        /* ignore */
      }
      return originalReplace(data, unused, url as any);
    };

    // Back / forward: the route is about to change, so show the overlay.
    function onPopState() {
      if (navToken.current) return;
      navToken.current = startLoading("navigation", "Loading...");
    }
    window.addEventListener("popstate", onPopState);

    return () => {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  // ── Network activity ─────────────────────────────────────────────────────
  //
  // Counting every request has a cost: this runs for EVERY fetch the app makes,
  // and Supabase alone issues several per page (session, the page's own
  // queries, realtime). The old version built a fresh `Headers` object for each
  // one just to read a single prefetch flag, and did so before the cheap
  // same-origin rejection. Both are fixed below, and two classes of request
  // are excluded outright.
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    /**
     * Requests that are never something the user is waiting on.
     *
     * `/api/jobs/run` is the background push flush: it is explicitly
     * fire-and-forget and can take seconds, so counting it would keep the
     * overlay up over a page the user is already reading. The Supabase auth
     * token refresh happens on a timer in the background for the same reason.
     */
    function isBackground(raw: string): boolean {
      if (raw.includes("/api/jobs/run")) return true;
      if (raw.includes("/auth/v1/token")) return true;
      if (raw.includes("/auth/v1/logout")) return true;
      return false;
    }

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      let raw: string;
      try {
        raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
      } catch {
        return originalFetch(input as any, init);
      }

      // A third-party beacon (analytics, an image CDN) is not a page load.
      if (!raw.startsWith("/")) {
        try {
          if (new URL(raw, window.location.href).origin !== window.location.origin) {
            return originalFetch(input as any, init);
          }
        } catch {
          return originalFetch(input as any, init);
        }
      }

      if (isBackground(raw)) return originalFetch(input as any, init);

      // Next prefetches every <Link> it can see, on hover and on viewport
      // entry. Those are speculative — the user has not asked for that page —
      // so counting them would flash the overlay while someone merely moves
      // the mouse. The header is read in place, with no `Headers` allocation.
      const h = init?.headers;
      if (h) {
        const flag =
          h instanceof Headers
            ? h.get("next-router-prefetch")
            : Array.isArray(h)
              ? (h.find(([k]) => String(k).toLowerCase() === "next-router-prefetch")?.[1] ?? null)
              : ((h as Record<string, string>)["next-router-prefetch"] ??
                (h as Record<string, string>)["Next-Router-Prefetch"] ??
                null);
        if (flag === "1") return originalFetch(input as any, init);
      } else if (input instanceof Request && input.headers.get("next-router-prefetch") === "1") {
        return originalFetch(input as any, init);
      }

      const token = startLoading("data", "Loading...");
      try {
        return await originalFetch(input as any, init);
      } finally {
        stopLoading(token);
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
