import { NextRequest, NextResponse } from "next/server";

const JUP_API_KEY = process.env.NEXT_PUBLIC_JUPITER_API_KEY?.trim();

const QUOTE_ENDPOINTS = [
  "https://quote-api.jup.ag/v2/quote",
  "https://quote-api.jup.ag/v1/quote",
  "https://api.jup.ag/v2/quote",
  "https://jupiter.6e.technology/v2/quote",
];

const SWAP_ENDPOINTS = [
  "https://api.jup.ag/swap/v2/order",
  "https://api.jup.ag/swap/v2/build",
  "https://quote-api.jup.ag/v2/swap",
  "https://quote-api.jup.ag/v1/swap",
  "https://jupiter.6e.technology/v2/swap",
];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const inputMint = searchParams.get("inputMint");
  const outputMint = searchParams.get("outputMint");
  const amount = searchParams.get("amount");

  if (inputMint && outputMint && inputMint === outputMint && amount) {
    return NextResponse.json({
      inputMint,
      outputMint,
      inAmount: amount,
      outAmount: amount,
      otherAmountThreshold: amount,
      swapMode: "ExactIn",
      slippageBps: 0,
      priceImpactPct: "0",
      routePlan: [],
    });
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(JUP_API_KEY ? { "x-api-key": JUP_API_KEY } : {}),
  };

  const errors: string[] = [];
  for (const base of [...QUOTE_ENDPOINTS, ...SWAP_ENDPOINTS]) {
    try {
      const target = new URL(base + "?" + searchParams.toString());
      const res = await fetch(target.toString(), {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
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

  console.error("[jupiter/quote] all endpoints failed:", errors);
  return NextResponse.json(
    {
      error: "all_jupiter_endpoints_failed",
      details: errors,
      message: "Jupiter aggregator is unreachable from this network. Try VPN or later.",
    },
    { status: 502 },
  );
}
