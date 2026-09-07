import { NextRequest, NextResponse } from "next/server";
import { fetchCoinMeta } from "@/lib/pump-api";
import { cacheGet, cacheSet } from "@/lib/api-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ mint: string }> },
) {
  const { mint } = await ctx.params;
  if (!mint || mint.length < 32 || mint.length > 64 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(mint)) {
    return NextResponse.json(
      { coin: null, source: null, error: "Invalid mint" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  // Cache coin metadata briefly (30s) — meta is semi-static and the endpoint
  // gets re-polled by the coin page while a position is open.
  const key = `coin-meta:${mint}`;
  const hit = cacheGet<Awaited<ReturnType<typeof fetchCoinMeta>>>(key);
  const result = hit ?? (await fetchCoinMeta(mint));
  if (!hit) cacheSet(key, result, 30_000);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}
