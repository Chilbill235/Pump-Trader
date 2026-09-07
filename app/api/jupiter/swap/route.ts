import { NextRequest, NextResponse } from "next/server";

const JUP_API_KEY = process.env.NEXT_PUBLIC_JUPITER_API_KEY?.trim();

const SWAP_ENDPOINTS = [
  "https://api.jup.ag/swap/v2/order",
  "https://api.jup.ag/swap/v2/build",
  "https://quote-api.jup.ag/v2/swap",
  "https://quote-api.jup.ag/v1/swap",
  "https://jupiter.6e.technology/v2/swap",
];

export async function POST(request: NextRequest) {
  const body = await request.text();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(JUP_API_KEY ? { "x-api-key": JUP_API_KEY } : {}),
  };

  let isSameMint = false;
  try {
    const parsed = JSON.parse(body);
    isSameMint = parsed?.quoteResponse?.inputMint === parsed?.quoteResponse?.outputMint;
  } catch { /* ignore */ }

  if (isSameMint) {
    return NextResponse.json({
      swapTransaction: Buffer.from(new Uint8Array(0)).toString("base64"),
      lastLedgerValidTimeHeight: 0,
    });
  }

  const errors: string[] = [];
  for (const base of SWAP_ENDPOINTS) {
    try {
      const target = new URL(base);
      const res = await fetch(target.toString(), {
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
