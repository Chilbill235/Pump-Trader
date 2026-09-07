import { NextRequest, NextResponse } from "next/server";
import { fetchCoinList } from "@/lib/pump-api";
import { searchCoins } from "@/lib/search";
import { cached } from "@/lib/api-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const kind =
    searchParams.get("kind") === "newest" || searchParams.get("sort") === "created_timestamp"
      ? "newest"
      : "trending";
  try {
    // Short server-side cache so rapid page views / polling clients don't
    // hammer the pump.fun frontend API (which rate-limits aggressively).
    const key = q ? `coins:search:${q.toLowerCase()}` : `coins:${kind}`;
    const result = await cached(key, 10_000, () =>
      q ? searchCoins(q) : fetchCoinList(kind),
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { coins: [], source: null, error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
