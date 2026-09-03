import { NextResponse } from "next/server";
import { fetchSolPriceUsd } from "@/lib/pump-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const usd = await fetchSolPriceUsd();
  return NextResponse.json({ usd });
}
