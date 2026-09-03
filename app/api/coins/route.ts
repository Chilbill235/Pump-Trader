import { NextRequest, NextResponse } from "next/server";
import { fetchCoinList } from "@/lib/pump-api";
import { searchCoins } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const sort = searchParams.get("sort");
  const kind =
    sort === "created_timestamp" || searchParams.get("kind") === "newest"
      ? "newest"
      : "trending";
  try {
    const result = q ? await searchCoins(q) : await fetchCoinList(kind);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { coins: [], source: null, error: message },
      { status: 502 },
    );
  }
}
