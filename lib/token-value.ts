"use client";

/**
 * Universal "what is X worth" lookup for any SPL mint.
 *
 * The pump-sdk only knows about pump.fun bonding curves / pump-amm. For
 * USDC, BONK, wBTC, JUP, RAY, memecoins, etc. we need a different source.
 *
 * Strategy:
 *  1. Try `quoteTrade` from lib/sdk (pump bonding curve / pump-amm). If it
 *     returns a positive SOL output we use it.
 *  2. If it errors (e.g. "not a pump coin"), fall back to Jupiter price
 *     feed (usdPrice per token) and convert via SOL/USD.
 *  3. If both fail, return `null` and the caller decides what to show.
 *
 * This lets the Positions view show "3.99 USDC ≈ 3.99 USDC" instead of "err",
 * and lets the bot / TP-SL watcher value non-pump positions.
 */

import type { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { quoteTrade, friendlyOnchainError } from "./sdk";
import { fetchJupiterUsdPrice } from "./jupiter";
import { TOKEN_DECIMALS } from "./constants";
import { lamportsToSol, tokensToUi } from "./format";

export type TokenValueQuote = {
  mint: string;
  /** SOL you would receive for `tokenAmountRaw` (best estimate). */
  solLamports: string | null;
  /** USDC value, derived from Jupiter price feed. */
  usd: number | null;
  /** True if we got a real on-chain quote. False if it's just the price feed. */
  fromOnchain: boolean;
  /** True if this is a pump.fun bonding-curve / pump-amm coin. */
  isPumpCoin: boolean;
  /** For display when we don't have a real quote. */
  error?: string;
};

const PRICE_CACHE = new Map<string, { usd: number; ts: number }>();
const PRICE_TTL_MS = 60_000;
const KNOWN_PRICES: Record<string, number> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1, // USDC
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 1, // USDT
};

async function getUsdPrice(
  mints: string[],
  solUsd: number | null,
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  const needFetch: string[] = [];
  const now = Date.now();
  for (const m of mints) {
    const known = KNOWN_PRICES[m];
    if (known != null) {
      out[m] = known;
      continue;
    }
    const cached = PRICE_CACHE.get(m);
    if (cached && now - cached.ts < PRICE_TTL_MS) {
      out[m] = cached.usd;
      continue;
    }
    needFetch.push(m);
  }
  if (needFetch.length > 0) {
    const fetched = await fetchJupiterUsdPrice(needFetch);
    for (const m of needFetch) {
      const v = fetched[m] ?? null;
      out[m] = v;
      if (v != null) PRICE_CACHE.set(m, { usd: v, ts: now });
    }
  }
  if (solUsd != null && Number.isFinite(solUsd) && solUsd > 0) {
    if (out["So11111111111111111111111111111111111111112"] == null) {
      out["So11111111111111111111111111111111111111112"] = solUsd;
    }
  }
  return out;
}

export async function getSolUsd(): Promise<number | null> {
  try {
    const res = await fetch("/api/sol-price", { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { usd?: number | null };
    return j.usd && Number.isFinite(j.usd) ? j.usd : null;
  } catch {
    return null;
  }
}

/**
 * Quote `tokenAmountRaw` (raw integer) of `mint` to SOL.
 * Returns null if we cannot get any estimate.
 */
export async function quoteTokenToSol(args: {
  connection: Connection;
  mint: string;
  tokenAmountRaw: bigint | BN | number | string;
  user?: PublicKey | null;
  slippagePct: number;
  solUsd?: number | null;
}): Promise<TokenValueQuote> {
  const raw = toBN(args.tokenAmountRaw);
  const decimals = await fetchMintDecimals(args.connection, args.mint);
  const uiAmount = Number(tokensToUi(raw, decimals));

  // 1) Try the pump program (covers bonding-curve and pump-amm).
  try {
    const q = await quoteTrade({
      connection: args.connection,
      mint: args.mint,
      user: args.user ?? null,
      side: "sell",
      tokenAmountRaw: raw,
      slippagePct: args.slippagePct,
    });
    const solOut = new BN(q.solLamports);
    if (solOut.gt(new BN(0))) {
      const solUsd = args.solUsd ?? (await getSolUsd());
      const solUi = Number(lamportsToSol(solOut));
      return {
        mint: args.mint,
        solLamports: solOut.toString(),
        usd: solUsd != null ? solUi * solUsd : null,
        fromOnchain: true,
        isPumpCoin: true,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // pump coin but transient error — surface it
    if (looksLikePumpError(msg)) {
      return {
        mint: args.mint,
        solLamports: null,
        usd: null,
        fromOnchain: false,
        isPumpCoin: true,
        error: friendlyOnchainError(err, args.mint),
      };
    }
  }

  // 2) Fall back to Jupiter price feed.
  const solUsd = args.solUsd ?? (await getSolUsd());
  const prices = await getUsdPrice([args.mint], solUsd);
  const usdPrice = prices[args.mint] ?? null;
  if (usdPrice != null && Number.isFinite(usdPrice) && usdPrice > 0) {
    const usd = usdPrice * uiAmount;
    if (solUsd != null && solUsd > 0) {
      const solUi = usd / solUsd;
      const lamports = new BN(Math.max(0, Math.floor(solUi * 1e9)).toString());
      return {
        mint: args.mint,
        solLamports: lamports.toString(),
        usd,
        fromOnchain: false,
        isPumpCoin: false,
      };
    }
    return {
      mint: args.mint,
      solLamports: null,
      usd,
      fromOnchain: false,
      isPumpCoin: false,
    };
  }
  return {
    mint: args.mint,
    solLamports: null,
    usd: null,
    fromOnchain: false,
    isPumpCoin: false,
    error: "No price source available for this token.",
  };
}

export function looksLikePumpError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("doesn't look like a pump") ||
    lower.includes("bondingcurve") ||
    lower.includes("bonding curve") ||
    lower.includes("pool account not found") ||
    lower.includes("invalid account data") ||
    lower.includes("beyond buffer length") ||
    lower.includes("deserialize") ||
    lower.includes("graduat") ||
    lower.includes("simulate") ||
    lower.includes("blockhash") ||
    lower.includes("403") ||
    lower.includes("forbidden") ||
    lower.includes("rate limit")
  );
}

const DECIMALS_CACHE = new Map<string, number>();

export async function fetchMintDecimals(
  connection: Connection,
  mint: string,
): Promise<number> {
  if (DECIMALS_CACHE.has(mint)) return DECIMALS_CACHE.get(mint)!;
  try {
    const info = await connection.getParsedAccountInfo(toPk(mint));
    const parsed = (info.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)
      ?.parsed?.info;
    if (parsed && typeof parsed.decimals === "number") {
      DECIMALS_CACHE.set(mint, parsed.decimals);
      return parsed.decimals;
    }
  } catch {
    // ignore
  }
  DECIMALS_CACHE.set(mint, TOKEN_DECIMALS);
  return TOKEN_DECIMALS;
}

function toBN(v: bigint | BN | number | string): BN {
  if (typeof v === "bigint") return new BN(v.toString());
  if (typeof v === "string") return new BN(v);
  if (typeof v === "number") return new BN(Math.max(0, Math.floor(v)).toString());
  return v as BN;
}

function toPk(mint: string): PublicKey {
  // Lazy import: this file is "use client" so we can still import web3.js
  // but we re-create the PublicKey here to avoid a top-level import that
  // bundlers might pull into a server context in some setups.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PublicKey } = require("@solana/web3.js") as typeof import("@solana/web3.js");
  return new PublicKey(mint);
}
