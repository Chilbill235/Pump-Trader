import { NextRequest, NextResponse } from "next/server";

const JUP_API = "https://quote-api.jup.ag/v6";
const JUP_API_KEY = process.env.NEXT_PUBLIC_JUPITER_API_KEY?.trim();

export async function POST(request: NextRequest) {
  const body = await request.text();
  const target = new URL(JUP_API + "/swap");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(JUP_API_KEY ? { "x-api-key": JUP_API_KEY } : {}),
  };

  try {
    const res = await fetch(target.toString(), {
      method: "POST",
      headers,
      body,
      cache: "no-store",
    });
    const respBody = await res.text();
    return new NextResponse(respBody, {
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
