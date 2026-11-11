import type { MetadataRoute } from "next";

/**
 * Web app manifest — this is what makes NaijaMart installable from Chrome.
 *
 * Chrome's install criteria, all satisfied here:
 *   * `name` (or `short_name`) present
 *   * a 192px and a 512px icon
 *   * `start_url` present
 *   * `display` is standalone / fullscreen / minimal-ui
 *   * served over HTTPS (Vercel does that)
 *   * a service worker registered on the origin (public/sw.js)
 *
 * `id` is pinned to "/" so the installed app keeps one identity even if
 * `start_url` ever gains a query string — without it Chrome treats a changed
 * start_url as a different app and the user ends up with two icons.
 *
 * The maskable icons are separate files, not the same artwork reused: Android
 * crops a maskable icon to whatever shape the launcher uses, so the artwork is
 * inset inside the safe zone there. Reusing the full-bleed icon would clip the
 * cart and the wordmark.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "NaijaMart — buy and hire from verified sellers",
    short_name: "NaijaMart",
    description:
      "A Nigerian marketplace for goods and services. Your money is held in escrow until you confirm delivery.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0B8A3E",
    lang: "en-NG",
    dir: "ltr",
    categories: ["shopping", "business"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Search", url: "/search", description: "Find a product or service" },
      { name: "My orders", url: "/orders", description: "Track your orders" },
      { name: "Chats", url: "/chats", description: "Talk to a seller" },
    ],
  };
}
