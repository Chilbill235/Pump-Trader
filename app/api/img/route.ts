import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GATEWAYS = [
  "https://ipfs.io/ipfs",
  "https://gateway.pinata.cloud/ipfs",
  "https://cloudflare-ipfs.com/ipfs",
  "https://nftstorage.link/ipfs",
  "https://cf-ipfs.com/ipfs",
];

const AR_HOST = "https://arweave.net";

const FETCH_TIMEOUT_MS = 4000;

async function tryFetch(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "image/*",
        "User-Agent": "pump-trader/0.1 (image proxy)",
      },
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("u")?.trim();
  if (!raw) return new NextResponse("missing u", { status: 400 });

  let candidates: string[] = [];
  if (raw.startsWith("ipfs://")) {
    const cid = raw.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "");
    if (!/^[A-Za-z0-9]{46,}$|^[A-Za-z0-9]{59,}$/.test(cid)) {
      return new NextResponse("bad cid", { status: 400 });
    }
    candidates = GATEWAYS.map((g) => `${g}/${cid}`);
  } else if (raw.startsWith("ar://")) {
    candidates = [`${AR_HOST}/${raw.replace(/^ar:\/\//, "")}`];
  } else if (/^https?:\/\//i.test(raw)) {
    candidates = [raw];
  } else {
    return new NextResponse("unsupported scheme", { status: 400 });
  }

  // Race all gateways in parallel — first one to return wins.
  const winner = await Promise.any(candidates.map((u) => tryFetch(u).then((r) => ({ u, r }))));
  if (!winner || !winner.r) {
    return new NextResponse("upstream failed", { status: 502 });
  }
  const res = winner.r;
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "image/png";
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "*",
      "X-Img-Source": winner.u,
    },
  });
}