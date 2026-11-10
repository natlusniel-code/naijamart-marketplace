import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "NaijaMart — buy and hire from verified sellers in your state",
    template: "%s · NaijaMart",
  },
  description:
    "NaijaMart is a Nigerian marketplace for goods and services. We hold your money in escrow until you confirm delivery.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B8A3E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
