import { NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/server";
import { aiSearch } from "@/lib/ai-search";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/ai/search
 *
 * The one endpoint behind voice and image search.
 *
 * ── Why a route and not a server action ──────────────────────────────────
 * A server action serialises its arguments through React's protocol, which
 * is fine for a string and wasteful for a base64 image. A plain POST lets
 * the browser send the image as JSON and get the results back without the
 * action round trip — and it is the same shape the voice path uses, so
 * there is one code path to reason about.
 *
 * ── Why the image is downscaled in the browser ───────────────────────────
 * A phone photo is 4-8 MB. Sending that to the server to send to the model
 * would make the request slow for no gain — the model only needs enough
 * detail to name the product. The client resizes to 1024px before posting,
 * which keeps the body under ~200 KB and the whole search under a second.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const modality = body?.modality === "image" ? "image" : body?.modality === "voice" ? "voice" : "text";

    const session = await getSession();

    /*
      Rate limit. Every call here costs a model request, and the endpoint
      is reachable without signing in (a visitor should be able to try a
      photo search before making an account). 30 searches a minute is far
      more than a person can type, and stops a script from draining the
      quota.
    */
    const rl = rateLimit(`search:${clientKey(request, session?.user.id)}`, 30, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many searches. Give it a moment." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }

    // ── Image ──────────────────────────────────────────────────────────
    if (modality === "image") {
      const base64 = String(body?.base64 ?? "");
      const mimeType = String(body?.mimeType ?? "image/jpeg");
      if (!base64) {
        return NextResponse.json({ ok: false, error: "No image was sent." }, { status: 400 });
      }
      // Guard the payload: a 4 MB base64 string is ~5.3 MB of JSON and
      // would be a slow request for no benefit.
      if (base64.length > 3_000_000) {
        return NextResponse.json(
          { ok: false, error: "That image is too large. Try a smaller photo." },
          { status: 413 },
        );
      }

      const result = await aiSearch({
        modality: "image",
        image: { base64, mimeType },
        city: session?.profile.city ?? null,
        userId: session?.user.id ?? null,
      });

      return NextResponse.json({
        ok: true,
        query: result.parsed.query,
        interpretation: result.parsed.interpretation,
        listings: result.listings,
        latencyMs: result.latencyMs,
        degraded: result.degraded,
      });
    }

    // ── Voice / text ───────────────────────────────────────────────────
    const text = String(body?.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ ok: false, error: "Nothing was said." }, { status: 400 });
    }

    const result = await aiSearch({
      modality: modality === "voice" ? "voice" : "text",
      text,
      city: session?.profile.city ?? null,
      userId: session?.user.id ?? null,
    });

    return NextResponse.json({
      ok: true,
      query: result.parsed.query,
      interpretation: result.parsed.interpretation,
      listings: result.listings,
      latencyMs: result.latencyMs,
      degraded: result.degraded,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Search failed." },
      { status: 500 },
    );
  }
}
