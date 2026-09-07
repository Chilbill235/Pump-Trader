import { NextResponse } from "next/server";
import { fetchSolPriceUsd } from "@/lib/pump-api";
import { cached } from "@/lib/api-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const usd = await cached("sol-price", 30_000, fetchSolPriceUsd);
  return NextResponse.json(
    { usd },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } },
  );
}
