import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATEWAYS = [
  "https://ipfs.io/ipfs",
  "https://gateway.pinata.cloud/ipfs",
  "https://cloudflare-ipfs.com/ipfs",
  "https://nftstorage.link/ipfs",
  "https://cf-ipfs.com/ipfs",
  "https://magenta.imaginative-banana.ts.net/ipfs",
];

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u")?.trim();
  if (!u) return new NextResponse("missing u", { status: 400 });

  let targets: string[] = [];
  if (u.startsWith("ipfs://")) {
    const cid = u.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "");
    targets = GATEWAYS.map((g) => `${g}/${cid}`);
  } else if (u.startsWith("ar://")) {
    targets = [`https://arweave.net/${u.replace(/^ar:\/\//, "")}`];
  } else {
    targets = [u];
  }

  for (const url of targets) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          Accept: "image/*",
          "User-Agent": "pump-trader/0.1 (image proxy)",
        },
        cache: "no-store",
      });
      clearTimeout(to);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") ?? "image/png";
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": ct,
          "Cache-Control": "public, max-age=300, s-maxage=300",
          "Cross-Origin-Resource-Policy": "cross-origin",
          "Access-Control-Allow-Origin": "*",
          "X-Img-Source": url,
        },
      });
    } catch {
      // try next gateway
    }
  }
  return new NextResponse("upstream failed", { status: 502 });
}