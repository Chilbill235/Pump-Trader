"use client";

import { Connection, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  OnlinePumpSdk,
  calculateSellPriceImpact,
  getSellSolAmountFromTokenAmount,
} from "@nirholas/pump-sdk";
import BN from "bn.js";
import type { CoinOnchain, QuoteResult, TradeSide, Venue } from "./types";

const sdkCache = new WeakMap<Connection, OnlinePumpSdk>();

export function getPumpSdk(connection: Connection): OnlinePumpSdk {
  const cached = sdkCache.get(connection);
  if (cached) return cached;
  const sdk = new OnlinePumpSdk(connection);
  sdkCache.set(connection, sdk);
  return sdk;
}

export const DUMMY_USER = new PublicKey("11111111111111111111111111111111");

/** Bonding-curve buyInstructions/sellInstructions: 5 means 5%. */
export function curveSlippagePercent(slippagePct: number): number {
  return slippagePct;
}

/** AMM wrappers: 500 means 5%. */
export function ammSlippageBps(slippagePct: number): number {
  return Math.round(slippagePct * 100);
}

function bnStr(value: BN | number | string | null | undefined): string {
  if (value == null) return "0";
  if (BN.isBN(value)) return value.toString();
  return new BN(value.toString()).toString();
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 2,
  delayMs = 500,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        msg.includes("429") ||
        msg.includes("403") ||
        msg.includes("timeout") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ECONNRESET") ||
        msg.toLowerCase().includes("rate limit") ||
        msg.toLowerCase().includes("forbidden");
      if (!transient || attempt >= retries) break;
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function withRetryLabel<T>(fn: () => Promise<T>, label: string, retries = 2): Promise<T> {
  return withRetry(fn, label, retries);
}

export async function fetchCoinOnchain(
  connection: Connection,
  mint: string,
): Promise<CoinOnchain> {
  const sdk = getPumpSdk(connection);
  const mintPk = new PublicKey(mint);
  const [summary, curve] = await Promise.all([
    withRetry(() => sdk.fetchBondingCurveSummary(mintPk), "fetchBondingCurveSummary"),
    withRetry(() => sdk.fetchBondingCurve(mintPk), "fetchBondingCurve"),
  ]);
  const graduated = Boolean(summary.isGraduated || curve.complete);
  return {
    mint,
    graduated,
    complete: Boolean(curve.complete),
    progressBps: Number(summary.progressBps ?? (graduated ? 10_000 : 0)),
    marketCapLamports: bnStr(summary.marketCap),
    buyPriceLamportsPerToken: bnStr(summary.buyPricePerToken),
    sellPriceLamportsPerToken: bnStr(summary.sellPricePerToken),
    realSolReserves: bnStr(summary.realSolReserves ?? curve.realSolReserves),
    realTokenReserves: bnStr(summary.realTokenReserves ?? curve.realTokenReserves),
    tokenTotalSupply: bnStr(curve.tokenTotalSupply),
    creator: curve.creator ? curve.creator.toBase58() : null,
  };
}

export async function quoteTrade(args: {
  connection: Connection;
  mint: string;
  user?: PublicKey | null;
  side: TradeSide;
  solLamports?: BN;
  tokenAmountRaw?: BN;
  slippagePct: number;
}): Promise<QuoteResult> {
  const sdk = getPumpSdk(args.connection);
  const mintPk = new PublicKey(args.mint);
  const user = args.user ?? DUMMY_USER;
  const curve = await withRetry(() => sdk.fetchBondingCurve(mintPk), "fetchBondingCurve");
  const graduated = Boolean(curve.complete);
  const venue: Venue = graduated ? "pump-amm" : "bonding-curve";
  const notes: string[] = [];

  let progressBps: number | null = null;
  let marketCapLamports: string | null = null;
  try {
    const summary = await sdk.fetchBondingCurveSummary(mintPk);
    progressBps = Number(summary.progressBps);
    marketCapLamports = bnStr(summary.marketCap);
  } catch (err) {
    notes.push(
      `summary unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (args.side === "buy") {
    const solAmount = args.solLamports ?? new BN(0);
    if (solAmount.lten(0)) throw new Error("Enter a SOL amount greater than 0.");
    if (!graduated) {
      const quote = await withRetry(
        () => sdk.quoteBuy({ mint: mintPk, user, solAmount }),
        "quoteBuy",
      );
      return {
        side: "buy",
        venue,
        solLamports: solAmount.toString(),
        tokenAmountRaw: bnStr(quote.tokensOut),
        feesLamports: bnStr(quote.feesLamports),
        priceImpactBps: quote.priceImpactBps ?? null,
        slippagePct: args.slippagePct,
        graduated,
        progressBps,
        marketCapLamports,
        notes,
      };
    }
    const quote = await withRetry(
      () => sdk.ammQuoteBuy({ mint: mintPk, user, quoteAmountIn: solAmount }),
      "ammQuoteBuy",
    );
    return {
      side: "buy",
      venue,
      solLamports: bnStr(quote.solSpent ?? solAmount),
      tokenAmountRaw: bnStr(quote.tokensOut),
      feesLamports: bnStr(quote.feesLamports),
      priceImpactBps: null,
      slippagePct: args.slippagePct,
      graduated,
      progressBps,
      marketCapLamports,
      notes,
    };
  }

  const amount = args.tokenAmountRaw ?? new BN(0);
  if (amount.lten(0)) throw new Error("Enter a token amount greater than 0.");

  if (!graduated) {
    const [global, feeConfig] = await Promise.all([
      withRetry(() => sdk.fetchGlobal(), "fetchGlobal"),
      withRetry(() => sdk.fetchFeeConfig(), "fetchFeeConfig"),
    ]);
    const solOut = getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply: curve.tokenTotalSupply,
      bondingCurve: curve,
      amount,
    });
    const impact = calculateSellPriceImpact({
      global,
      feeConfig,
      mintSupply: curve.tokenTotalSupply,
      bondingCurve: curve,
      tokenAmount: amount,
    });
    const feeConfigRecord = feeConfig as unknown as Record<string, unknown>;
    const feeBps =
      typeof feeConfigRecord.feeBps === "number" ? feeConfigRecord.feeBps : 100;
    return {
      side: "sell",
      venue,
      solLamports: bnStr(solOut),
      tokenAmountRaw: amount.toString(),
      feesLamports: bnStr(new BN(solOut).mul(new BN(feeBps)).div(new BN(10_000))),
      priceImpactBps: impact.impactBps ?? null,
      slippagePct: args.slippagePct,
      graduated,
      progressBps,
      marketCapLamports,
      notes,
    };
  }

  const quote = await withRetry(
    () =>
      sdk.ammQuoteSell({
        mint: mintPk,
        user,
        baseAmountIn: amount,
      }),
    "ammQuoteSell",
  );
  return {
    side: "sell",
    venue,
    solLamports: bnStr(quote.solOut),
    tokenAmountRaw: bnStr(quote.tokensSold ?? amount),
    feesLamports: bnStr(quote.feesLamports),
    priceImpactBps: null,
    slippagePct: args.slippagePct,
    graduated,
    progressBps,
    marketCapLamports,
    notes,
  };
}

export async function buildTradeInstructions(args: {
  connection: Connection;
  mint: string;
  user: PublicKey;
  side: TradeSide;
  solLamports?: BN;
  tokenAmountRaw?: BN;
  slippagePct: number;
}): Promise<{
  ixs: TransactionInstruction[];
  venue: Venue;
  graduated: boolean;
}> {
  const sdk = getPumpSdk(args.connection);
  const mintPk = new PublicKey(args.mint);
  const user = args.user;
  const curve = await withRetry(() => sdk.fetchBondingCurve(mintPk), "fetchBondingCurve");
  const graduated = Boolean(curve.complete);
  const venue: Venue = graduated ? "pump-amm" : "bonding-curve";
  const slipPct = curveSlippagePercent(args.slippagePct);
  const slipBps = ammSlippageBps(args.slippagePct);

  if (args.side === "buy") {
    const solAmount = args.solLamports ?? new BN(0);
    if (solAmount.lten(0)) throw new Error("SOL amount must be > 0.");
    if (!graduated) {
      const buyState = await withRetry(() => sdk.fetchBuyState(mintPk, user), "fetchBuyState");
      const quoted = await withRetry(() => sdk.quoteBuy({ mint: mintPk, user, solAmount }), "quoteBuy");
      const ixs = await sdk.buyInstructions({
        ...buyState,
        mint: mintPk,
        user,
        amount: quoted.tokensOut,
        solAmount,
        slippage: slipPct,
      });
      return { ixs, venue, graduated };
    }
    const ixs = await sdk.ammBuyInstructions({
      mint: mintPk,
      user,
      solAmount,
      slippageBps: slipBps,
    });
    return { ixs, venue, graduated };
  }

  const amount = args.tokenAmountRaw ?? new BN(0);
  if (amount.lten(0)) throw new Error("Token amount must be > 0.");
  if (!graduated) {
    const sellState = await withRetry(() => sdk.fetchSellState(mintPk, user), "fetchSellState");
    let solAmount = args.solLamports ?? new BN(0);
    if (solAmount.lten(0)) {
      const [global, feeConfig] = await Promise.all([
        withRetry(() => sdk.fetchGlobal(), "fetchGlobal"),
        withRetry(() => sdk.fetchFeeConfig(), "fetchFeeConfig"),
      ]);
      solAmount = getSellSolAmountFromTokenAmount({
        global,
        feeConfig,
        mintSupply: sellState.bondingCurve.tokenTotalSupply,
        bondingCurve: sellState.bondingCurve,
        amount,
      });
    }
    const ixs = await sdk.sellInstructions({
      ...sellState,
      mint: mintPk,
      user,
      amount,
      solAmount,
      slippage: slipPct,
    });
    return { ixs, venue, graduated };
  }
  const ixs = await sdk.ammSellInstructions({
    mint: mintPk,
    user,
    tokenAmount: amount,
    slippageBps: slipBps,
  });
  return { ixs, venue, graduated };
}
