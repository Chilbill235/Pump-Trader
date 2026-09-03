import { NextRequest, NextResponse } from "next/server";
import { fetchCoinMeta } from "@/lib/pump-api";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ mint: string }> },
) {
  const { mint } = await ctx.params;
  const result = await fetchCoinMeta(mint);
  return NextResponse.json(result);
}
