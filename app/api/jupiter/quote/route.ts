import { NextRequest, NextResponse } from "next/server";

const JUP_API = "https://quote-api.jup.ag/v6";
const JUP_API_KEY = process.env.NEXT_PUBLIC_JUPITER_API_KEY?.trim();

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const target = new URL(JUP_API + "/quote?" + searchParams.toString());

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(JUP_API_KEY ? { "x-api-key": JUP_API_KEY } : {}),
  };

  try {
    const res = await fetch(target.toString(), { headers, cache: "no-store" });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "proxy failed" },
      { status: 502 },
    );
  }
}
