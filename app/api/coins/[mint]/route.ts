import { NextRequest, NextResponse } from "next/server";
import { fetchCoinMeta } from "@/lib/pump-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ mint: string }> },
) {
  const { mint } = await ctx.params;
  if (!mint || mint.length < 32 || mint.length > 64) {
    return NextResponse.json(
      { coin: null, source: null, error: "Invalid mint" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await fetchCoinMeta(mint);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
