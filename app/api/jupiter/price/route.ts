import { NextRequest, NextResponse } from "next/server";

const JUP_API_KEY = process.env.JUPITER_API_KEY?.trim();

const PRICE_ENDPOINTS = [
  "https://api.jup.ag/price/v3",
  "https://lite-api.jup.ag/price/v3",
  "https://price.jup.ag/v3",
  "https://price.jup.ag/v2",
];

const STATIC_PRICES: Record<string, number> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1,
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 1,
  So11111111111111111111111111111111111111112: 101,
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const ids = searchParams.get("ids")?.split(",").filter(Boolean) || [];

  if (ids.length === 0) {
    return NextResponse.json({});
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(JUP_API_KEY ? { "x-api-key": JUP_API_KEY } : {}),
  };

  const errors: string[] = [];
  for (const base of PRICE_ENDPOINTS) {
    try {
      const target = new URL(base + "?" + searchParams.toString());
      const res = await fetch(target.toString(), {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const body = await res.text();
        return new NextResponse(body, {
          status: res.status,
          headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
        });
      }
      errors.push(`${base}: ${res.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${base}: ${msg}`);
      continue;
    }
  }

  console.error("[jupiter/price] all endpoints failed:", errors);
  const staticResult: Record<string, { usdPrice: number }> = {};
  for (const id of ids) {
    if (STATIC_PRICES[id]) {
      staticResult[id] = { usdPrice: STATIC_PRICES[id] };
    }
  }
  return NextResponse.json(staticResult || { error: "all_price_endpoints_failed", details: errors }, { status: 200 });
}
