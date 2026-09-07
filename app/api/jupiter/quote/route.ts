import { NextRequest, NextResponse } from "next/server";

const JUP_API_KEY = process.env.NEXT_PUBLIC_JUPITER_API_KEY?.trim();

/**
 * Current Jupiter Swap API V2 (https://api.jup.ag/swap/v2).
 * GET /order returns a quote AND, when `taker` is provided, an assembled
 * base64 transaction the wallet can sign. Keyless access works at 0.5 RPS;
 * pass an x-api-key header when NEXT_PUBLIC_JUPITER_API_KEY is configured.
 *
 * Legacy quote-only endpoints are kept as a last-resort fallback. They do not
 * return a transaction — the client then uses the legacy /swap path.
 */
const ORDER_ENDPOINTS = [
  "https://api.jup.ag/swap/v2/order",
  "https://lite-api.jup.ag/swap/v2/order",
];

const QUOTE_ONLY_ENDPOINTS = [
  "https://lite-api.jup.ag/swap/v1/quote",
  "https://quote-api.jup.ag/v6/quote",
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
      transaction: null,
      requestId: null,
    });
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(JUP_API_KEY ? { "x-api-key": JUP_API_KEY } : {}),
  };

  const errors: string[] = [];
  const endpoints = [...ORDER_ENDPOINTS, ...QUOTE_ONLY_ENDPOINTS];
  for (const base of endpoints) {
    try {
      const target = new URL(base + "?" + searchParams.toString());
      const res = await fetch(target.toString(), {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        // Normalize the response so the client always sees a consistent quote
        // shape, whether the upstream was /order (v2) or a legacy /quote.
        let data: Record<string, unknown>;
        try {
          data = (await res.json()) as Record<string, unknown>;
        } catch {
          errors.push(`${base}: invalid json`);
          continue;
        }
        const isOrder = base.endsWith("/order");
        const normalized: Record<string, unknown> = {
          inputMint,
          outputMint,
          inAmount: data.inAmount ?? amount,
          outAmount: data.outAmount,
          otherAmountThreshold: data.otherAmountThreshold ?? data.outAmount,
          swapMode: data.swapMode ?? searchParams.get("swapMode") ?? "ExactIn",
          slippageBps: Number(data.slippageBps ?? searchParams.get("slippageBps") ?? 0),
          priceImpactPct: data.priceImpactPct ?? "0",
          routePlan: data.routePlan ?? [],
          transaction: isOrder ? (data.transaction ?? null) : null,
          requestId: isOrder ? (data.requestId ?? null) : null,
        };
        if (isOrder && typeof data.errorMessage === "string" && data.errorMessage) {
          normalized.errorMessage = data.errorMessage;
        }
        return NextResponse.json(normalized, {
          status: res.status,
          headers: { "Cache-Control": "no-store" },
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
