import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// IPFS gateways, ordered by historical uptime + speed. We race them in
// parallel and use whichever responds first. Some (cloudflare-ipfs.com,
// cf-ipfs.com) are end-of-life and removed; nftstorage + pinata + dweb
// + w3s + 4everland are the reliable ones in 2026.
const GATEWAYS = [
  "https://nftstorage.link/ipfs",
  "https://gateway.pinata.cloud/ipfs",
  "https://ipfs.io/ipfs",
  "https://dweb.link/ipfs",
  "https://w3s.link/ipfs",
  "https://4everland.io/ipfs",
];

const AR_HOST = "https://arweave.net";

const FETCH_TIMEOUT_MS = 4500;

async function tryFetch(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "image/*,image/jpeg,image/png,image/gif,image/webp,image/svg+xml,*/*",
        "User-Agent": "pump-trader/0.1 (+image-proxy)",
      },
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    // Some gateways return 200 with an HTML error page; reject those.
    if (ct && !ct.startsWith("image/") && !ct.includes("octet-stream")) {
      try {
        await res.arrayBuffer();
      } catch {
        // ignore
      }
      return null;
    }
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isLikelyCid(s: string): boolean {
  // CIDv0: starts with Qm, base58, 46 chars total.
  // CIDv1: base32 (b32) or base58, starts with b..., 59+ chars.
  // Base58 alphabet excludes 0, O, I, l.
  return /^(Qm[1-9A-HJ-NP-Za-km-z2-9]{44}|b[A-Za-z2-7]{58,})$/.test(s);
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("u")?.trim();
  if (!raw) return new NextResponse("missing u", { status: 400 });

  let candidates: string[] = [];
  let cacheKey = raw;
  if (raw.startsWith("ipfs://")) {
    const cid = raw.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "").split("/")[0];
    if (!isLikelyCid(cid)) {
      return new NextResponse("bad cid", { status: 400 });
    }
    cacheKey = `ipfs:${cid}`;
    candidates = GATEWAYS.map((g) => `${g}/${cid}`);
  } else if (raw.startsWith("ar://")) {
    const id = raw.replace(/^ar:\/\//, "").split("/")[0];
    if (!id || id.length < 20) return new NextResponse("bad ar id", { status: 400 });
    cacheKey = `ar:${id}`;
    candidates = [`${AR_HOST}/${id}`];
  } else if (/^https?:\/\//i.test(raw)) {
    if (raw.length > 1024) return new NextResponse("url too long", { status: 400 });
    candidates = [raw];
  } else {
    return new NextResponse("unsupported scheme", { status: 400 });
  }

  // Race all gateways in parallel. We tolerate a couple of failures; if all
  // fail, we still return a 502 but with a short Cache-Control so the
  // browser doesn't hammer us during a transient outage.
  const results = await Promise.allSettled(candidates.map((u) => tryFetch(u)));
  const winner = results
    .map((r, i) => ({ r, u: candidates[i] }))
    .find((x) => x.r.status === "fulfilled" && x.r.value !== null) as
    | { r: PromiseFulfilledResult<Response | null>; u: string }
    | undefined;
  if (!winner || !winner.r.value) {
    return new NextResponse("upstream failed", {
      status: 502,
      headers: {
        "Cache-Control": "public, max-age=10, s-maxage=10",
        "X-Img-Fail": "1",
      },
    });
  }
  const res = winner.r.value;
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "image/png";
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "*",
      "X-Img-Source": winner.u,
      "X-Img-Key": cacheKey,
    },
  });
}