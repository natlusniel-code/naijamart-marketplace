import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { INSTALL_CAPTURE_SCRIPT } from "@/lib/install-capture";
import { GlobalLoader } from "@/components/global-loader";
import { GlobalLoaderTriggers } from "@/components/global-loader-triggers";
import { NotificationBridge } from "@/components/notification-bridge";
import "./globals.css";
// Responsive guards, imported separately so globals.css stays as it was.
import "./responsive-guards.css";

export const metadata: Metadata = {
  title: {
    default: "NaijaMart — buy and hire from verified sellers in your state",
    template: "%s · NaijaMart",
  },
  description:
    "NaijaMart is a Nigerian marketplace for goods and services. We hold your money in escrow until you confirm delivery.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
  manifest: "/manifest.webmanifest",
  applicationName: "NaijaMart",
  appleWebApp: {
    capable: true,
    title: "NaijaMart",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B8A3E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Captures Chrome's `beforeinstallprompt` before React hydrates.

          The event can fire before any component mounts, and it is
          single-use — if nothing is listening when it fires, the ability to
          show the install dialog from our own "Install app" button is gone
          for that page load. This inline listener stashes it on `window` so
          the toast and the profile row can use it later. See
          src/lib/install-app.ts.
        */}
        <script dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SCRIPT }} />
      </head>
      <body>
        {/*
          Global loading overlay — one instance for the entire site.

          `GlobalLoaderTriggers` is what decides when it shows: link clicks,
          router.push, back/forward, and every same-origin fetch. It is wrapped
          in Suspense because it reads `useSearchParams`, which would otherwise
          opt the whole layout out of static rendering.
        */}
        <Suspense fallback={null}>
          <GlobalLoaderTriggers />
        </Suspense>
        <GlobalLoader />
        {/* Registers this device for background push and raises an OS
            notification for a new row while the tab is open. In the ROOT
            layout so buyers, sellers and admins all get it. */}
        <NotificationBridge />
        {children}
      </body>
    </html>
  );
}
