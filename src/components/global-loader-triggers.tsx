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
 *      non-blocking and delayed by `SHOW_DELAY`, so a fast request never
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
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      // Only same-origin requests count. A third-party beacon (analytics, an
      // image CDN) is not something the user is waiting on.
      let sameOrigin = true;
      try {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        sameOrigin = new URL(raw, window.location.href).origin === window.location.origin;
      } catch {
        sameOrigin = false;
      }

      if (!sameOrigin) return originalFetch(input as any, init);

      // Next prefetches every <Link> it can see, on hover and on viewport
      // entry. Those requests are speculative — the user has not asked for
      // that page — so counting them would flash the overlay while someone
      // merely moves the mouse across the page. `next-router-prefetch` is the
      // header Next sets on them.
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      if (headers.get("next-router-prefetch") === "1") {
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
