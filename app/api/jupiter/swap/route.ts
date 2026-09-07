import { NextRequest, NextResponse } from "next/server";

const JUP_API_KEY = process.env.JUPITER_API_KEY?.trim();

/**
 * Two supported request shapes:
 *
 * 1. { signedTransaction, requestId } — Swap API V2 flow. The client got an
 *    assembled transaction from GET /swap/v2/order, signed it in-wallet, and
 *    hands it here. We forward to POST /swap/v2/execute for Jupiter's managed
 *    landing pipeline (optimised slippage, priority fees, retries).
 * 2. { quoteResponse, ... } — legacy flow. The client only got a quote (no
 *    transaction) from a legacy fallback endpoint, so we build the swap
 *    transaction upstream and return { swapTransaction } for the wallet.
 */
const EXECUTE_ENDPOINTS = [
  "https://api.jup.ag/swap/v2/execute",
  "https://lite-api.jup.ag/swap/v2/execute",
];

const LEGACY_SWAP_ENDPOINTS = [
  "https://lite-api.jup.ag/swap/v1/swap",
  "https://quote-api.jup.ag/v6/swap",
];

export async function POST(request: NextRequest) {
  const body = await request.text();

  let parsed: {
    signedTransaction?: string;
    requestId?: string;
    quoteResponse?: { inputMint?: string; outputMint?: string };
  } | null = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(JUP_API_KEY ? { "x-api-key": JUP_API_KEY } : {}),
  };

  // Swap API V2 execute path.
  if (parsed?.signedTransaction) {
    const payload = JSON.stringify({
      signedTransaction: parsed.signedTransaction,
      ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
    });
    const errors: string[] = [];
    for (const base of EXECUTE_ENDPOINTS) {
      try {
        const res = await fetch(base, {
          method: "POST",
          headers,
          body: payload,
          cache: "no-store",
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
          const respBody = await res.text();
          return new NextResponse(respBody, {
            status: res.status,
            headers: { "Content-Type": "application/json" },
          });
        }
        // 4xx from /execute is a definitive rejection (bad request, expired
        // requestId…) — no point hammering the fallback with the same payload,
        // but still try the mirror endpoint once.
        errors.push(`${base}: ${res.status}`);
      } catch (err) {
        errors.push(`${base}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.error("[jupiter/swap] execute failed:", errors);
    return NextResponse.json(
      { error: "execute_failed", details: errors },
      { status: 502 },
    );
  }

  // Legacy quote → swapTransaction path (fallback).
  const isSameMint =
    parsed?.quoteResponse?.inputMint != null &&
    parsed.quoteResponse.inputMint === parsed.quoteResponse.outputMint;

  if (isSameMint) {
    return NextResponse.json({
      swapTransaction: Buffer.from(new Uint8Array(0)).toString("base64"),
      lastLedgerValidTimeHeight: 0,
    });
  }

  if (!parsed?.quoteResponse) {
    return NextResponse.json(
      { error: "bad_request", message: "Body must contain signedTransaction or quoteResponse." },
      { status: 400 },
    );
  }

  const errors: string[] = [];
  for (const base of LEGACY_SWAP_ENDPOINTS) {
    try {
      const res = await fetch(base, {
        method: "POST",
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const respBody = await res.text();
        return new NextResponse(respBody, {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      errors.push(`${base}: ${res.status}`);
    } catch (err) {
      errors.push(`${base}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.error("[jupiter/swap] all endpoints failed:", errors);
  return NextResponse.json(
    {
      error: "all_jupiter_endpoints_failed",
      details: errors,
      message: "Jupiter swap is unreachable from this network. Try VPN or later.",
    },
    { status: 502 },
  );
}
