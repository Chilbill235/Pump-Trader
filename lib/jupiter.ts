"use client";

/**
 * Jupiter aggregator quotes + swap instructions.
 *
 * We use the public Jupiter REST API:
 *   - https://quote-api.jup.ag/v6/quote
 *   - https://quote-api.jup.ag/v6/swap
 *
 * No API key required for read paths, and the swap endpoint returns a
 * fully-built VersionedTransaction that we can sign + send from the wallet.
 *
 * The point of this module: let the user trade *any* SPL token, paying with
 * *any* SPL token they have enough of in the wallet. The pump-sdk only knows
 * about pump.fun bonding curves + pump-amm. Jupiter covers the long tail
 * (USDC, USDT, BONK, JUP, RAY, wBTC, meme coins, etc.).
 *
 * This file is "use client" because it runs in the browser and hits Jupiter
 * directly from the user's session — no server hop needed.
 */

import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { friendlyOnchainError } from "./sdk";

const JUP_API = "https://quote-api.jup.ag/v6";
const JUP_PRICE_API = "https://price.jup.ag/v6";
const DEFAULT_SLIPPAGE_BPS = 500; // 5% — matches settings default

export type JupiterQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string; // raw integer, in input mint decimals
  outAmount: string; // raw integer, in output mint decimals
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
};

export type JupiterSimplePrice = {
  id: string;
  mintSymbol?: string;
  usdPrice: number;
};

const KNOWN_MINTS: Record<string, { symbol: string; name: string; decimals: number }> = {
  So11111111111111111111111111111111111111112: { symbol: "SOL", name: "Wrapped SOL", decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", name: "USD Coin", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", name: "Tether USD", decimals: 6 },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "BONK", name: "Bonk", decimals: 5 },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: "JUP", name: "Jupiter", decimals: 6 },
  "7vfCXYUXx5Q6DYp7DcsTr5wL8d3Jmz1pz2jHkW5DT7E": { symbol: "UXD", name: "UXD Stablecoin", decimals: 6 },
};

const PRICE_CACHE = new Map<string, { usd: number; ts: number }>();
const PRICE_TTL_MS = 60_000;

export function getKnownTokenMeta(mint: string): { symbol: string; name: string; decimals: number } | null {
  return KNOWN_MINTS[mint] ?? null;
}

export function shortTokenLabel(mint: string, fallbackSymbol?: string): string {
  if (fallbackSymbol && fallbackSymbol.length > 0 && fallbackSymbol !== "???") return fallbackSymbol;
  const known = KNOWN_MINTS[mint];
  if (known) return known.symbol;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

async function jupFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${JUP_API}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jupiter HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function fetchJupiterUsdPrice(mints: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  const toFetch: string[] = [];
  const now = Date.now();
  for (const m of mints) {
    const cached = PRICE_CACHE.get(m);
    if (cached && now - cached.ts < PRICE_TTL_MS) {
      out[m] = cached.usd;
    } else {
      toFetch.push(m);
    }
  }
  if (toFetch.length === 0) return out;
  try {
    const ids = toFetch.join(",");
    const res = await fetch(`${JUP_PRICE_API}/price?ids=${ids}`, { cache: "no-store" });
    if (!res.ok) {
      for (const m of toFetch) out[m] = null;
      return out;
    }
    const data = (await res.json()) as Record<string, { usdPrice?: number | null } | null>;
    for (const m of toFetch) {
      const v = data?.[m]?.usdPrice;
      const usd = typeof v === "number" && Number.isFinite(v) ? v : null;
      out[m] = usd;
      if (usd != null) PRICE_CACHE.set(m, { usd, ts: now });
    }
  } catch {
    for (const m of toFetch) out[m] = null;
  }
  return out;
}

export async function fetchJupiterQuote(args: {
  inputMint: string;
  outputMint: string;
  amountRaw: string; // integer in input mint's decimals
  slippageBps?: number;
  swapMode?: "ExactIn" | "ExactOut";
}): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint: args.inputMint,
    outputMint: args.outputMint,
    amount: args.amountRaw,
    slippageBps: String(args.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
    swapMode: args.swapMode ?? "ExactIn",
  });
  try {
    return await jupFetch<JupiterQuote>(`/quote?${params.toString()}`);
  } catch (err) {
    throw new Error(friendlyOnchainError(err, args.outputMint));
  }
}

type JupiterSwapResponse = {
  swapTransaction: string; // base64 VersionedTransaction
  lastLedgerValidTimeHeight?: number;
};

export async function fetchJupiterSwapTransaction(args: {
  quote: JupiterQuote;
  userPublicKey: PublicKey;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: number | "auto";
}): Promise<JupiterSwapResponse> {
  const body = {
    quoteResponse: args.quote,
    userPublicKey: args.userPublicKey.toBase58(),
    wrapAndUnwrapSol: args.wrapAndUnwrapSol ?? true,
    dynamicComputeUnitLimit: args.dynamicComputeUnitLimit ?? true,
    prioritizationFeeLamports: args.prioritizationFeeLamports ?? "auto",
  };
  try {
    return await jupFetch<JupiterSwapResponse>("/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(friendlyOnchainError(err, args.quote.outputMint));
  }
}

function versionedTxFromBase64(b64: string): VersionedTransaction {
  const buf = Buffer.from(b64, "base64");
  return VersionedTransaction.deserialize(buf);
}

/**
 * High-level: simulate + send a Jupiter swap.
 *
 * This intentionally mirrors `simulateAndSend` from lib/trade.ts but routes
 * through Jupiter instead of the pump program. We re-simulate before sending
 * so failures show up as friendly errors before the wallet prompt.
 */
export async function jupiterSimulateAndSend(args: {
  connection: Connection;
  wallet: WalletContextState;
  quote: JupiterQuote;
  paper: boolean;
}): Promise<{ signature: string | null; quote: JupiterQuote }> {
  const user = args.wallet.publicKey;
  if (!user) throw new Error("Connect a Solana wallet first. This app never asks for a private key.");

  if (args.paper) {
    return { signature: null, quote: args.quote };
  }

  const swap = await fetchJupiterSwapTransaction({
    quote: args.quote,
    userPublicKey: user,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  });

  const tx = versionedTxFromBase64(swap.swapTransaction);

  // Prepend our own compute budget in case Jupiter omitted it. Cheap and safe
  // to add even when Jupiter already set dynamic CU.
  try {
    const { blockhash, lastValidBlockHeight } = await args.connection.getLatestBlockhash(
      "confirmed",
    );
    const budget = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
    ];
    const message = TransactionMessage.decompile(tx.message);
    const rebuilt = new TransactionMessage({
      payerKey: message.payerKey,
      recentBlockhash: blockhash,
      instructions: [...budget, ...message.instructions],
    }).compileToV0Message();
    const reTx = new VersionedTransaction(rebuilt);

    const sim = await args.connection.simulateTransaction(reTx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    if (sim.value.err) {
      const logs = sim.value.logs ?? [];
      throw new Error(
        `Simulation failed: ${JSON.stringify(sim.value.err)}\n${logs.slice(-8).join("\n")}`,
      );
    }
    if (!args.wallet.sendTransaction) throw new Error("Wallet does not support sendTransaction.");
    const signature = await args.wallet.sendTransaction(reTx, args.connection, {
      skipPreflight: false,
      maxRetries: 3,
    });
    const conf = await args.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (conf.value.err) {
      throw new Error(`Transaction confirmed but failed: ${JSON.stringify(conf.value.err)}`);
    }
    return { signature, quote: args.quote };
  } catch (err) {
    throw new Error(friendlyOnchainError(err, args.quote.outputMint));
  }
}
