"use client";

/**
 * Jupiter aggregator quotes + swap execution.
 *
 * We use the current Jupiter Swap API V2 (https://api.jup.ag/swap/v2):
 *   - GET  /swap/v2/order   - quote + assembled transaction (needs `taker`)
 *   - POST /swap/v2/execute - managed transaction landing after in-wallet signing
 *
 * Keyless access works at 0.5 RPS; set NEXT_PUBLIC_JUPITER_API_KEY for higher
 * limits. All Jupiter traffic goes through the app's own proxy routes
 * (/api/jupiter/quote, /api/jupiter/swap, /api/jupiter/price) so the API key
 * stays server-side and CORS is never an issue.
 *
 * The point of this module: let the user trade *any* SPL token, paying with
 * *any* SPL token they have enough of in the wallet. The pump-sdk only knows
 * about pump.fun bonding curves + pump-amm. Jupiter covers the long tail
 * (USDC, USDT, BONK, JUP, RAY, wBTC, meme coins, etc.).
 *
 * This file is "use client" because it runs in the browser and orchestrates
 * wallet signing locally - no private keys ever leave the wallet.
 */

import {
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { friendlyOnchainError } from "./sdk";

const DEFAULT_SLIPPAGE_BPS = 500;

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
  /** Swap API V2: base64 assembled transaction from GET /order. Null when the quote came from a legacy quote-only fallback. */
  transaction?: string | null;
  /** Swap API V2: order id required by POST /execute. */
  requestId?: string | null;
  /** Present when /order could not assemble a transaction (see transaction === "" / null). */
  errorMessage?: string;
};

export type JupiterSimplePrice = {
  id: string;
  mintSymbol?: string;
  usdPrice: number;
};

const KNOWN_MINTS: Record<string, { symbol: string; name: string; decimals: number; usd?: number }> = {
  So11111111111111111111111111111111111111112: { symbol: "SOL", name: "Wrapped SOL", decimals: 9, usd: 101 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", name: "USD Coin", decimals: 6, usd: 1 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", name: "Tether USD", decimals: 6, usd: 1 },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "BONK", name: "Bonk", decimals: 5, usd: 0.000025 },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: "JUP", name: "Jupiter", decimals: 6, usd: 0.5 },
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
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

async function jupFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // All Jupiter traffic goes through the app's own proxy routes.
  const localBase = "/api/jupiter";
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${localBase}${path}`, {
        ...init,
        headers: { Accept: "application/json", ...(init?.headers ?? {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Jupiter HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isNetwork = /failed to fetch/i.test(msg) || /networkerror/i.test(msg) || /all_jupiter_endpoints_failed/i.test(msg) || err instanceof TypeError;
      if (!isNetwork || attempt >= 2) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
    const res = await fetch(`/api/jupiter/price?ids=${ids}`, { cache: "no-store" });
    if (!res.ok) {
      for (const m of toFetch) out[m] = null;
      return out;
    }
    const data = (await res.json()) as Record<string, { usdPrice?: number | null } | null>;
    for (const m of toFetch) {
      const v = data?.[m]?.usdPrice;
      const usd = typeof v === "number" && Number.isFinite(v) ? v : null;
      if (usd != null) PRICE_CACHE.set(m, { usd, ts: Date.now() });
      out[m] = usd;
    }
  } catch {
    for (const m of toFetch) out[m] = null;
  }
  for (const m of toFetch) {
    if (out[m] == null) {
      const known = KNOWN_MINTS[m];
      if (known?.usd != null) {
        out[m] = known.usd;
        PRICE_CACHE.set(m, { usd: known.usd, ts: Date.now() });
      }
    }
  }
  return out;
}

export async function fetchJupiterQuote(args: {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  slippageBps?: number;
  swapMode?: "ExactIn" | "ExactOut";
  /** Wallet pubkey (base58). Required for Swap API V2 /order to assemble a transaction. */
  taker?: string;
}): Promise<JupiterQuote> {
  if (args.inputMint === args.outputMint) {
    return {
      inputMint: args.inputMint,
      outputMint: args.outputMint,
      inAmount: args.amountRaw,
      outAmount: args.amountRaw,
      otherAmountThreshold: args.amountRaw,
      swapMode: args.swapMode ?? "ExactIn",
      slippageBps: 0,
      priceImpactPct: "0",
      routePlan: [],
      transaction: null,
      requestId: null,
    };
  }
  const params = new URLSearchParams({
    inputMint: args.inputMint,
    outputMint: args.outputMint,
    amount: args.amountRaw,
    slippageBps: String(args.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
    swapMode: args.swapMode ?? "ExactIn",
    restrictIntermediateTokens: "false",
  });
  if (args.taker) params.set("taker", args.taker);
  try {
    return await jupFetch<JupiterQuote>(`/quote?${params.toString()}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/all_jupiter_endpoints_failed/i.test(msg) || /failed to fetch/i.test(msg) || /networkerror/i.test(msg)) {
      throw new Error(`Jupiter aggregator unreachable. ${msg}. Use VPN or switch to SIMULATE mode.`);
    }
    throw new Error(msg);
  }
}

type ExecuteResponse = {
  status: "Success" | "Failed";
  signature: string;
  error?: string;
};

type LegacySwapResponse = {
  swapTransaction: string; // base64 VersionedTransaction
  lastLedgerValidTimeHeight?: number;
};

function versionedTxFromBase64(b64: string): VersionedTransaction {
  const buf = Buffer.from(b64, "base64");
  return VersionedTransaction.deserialize(buf);
}

/** Local simulation purely to surface clear errors before the wallet prompt. */
async function simulateForFriendlyErrors(connection: Connection, tx: VersionedTransaction): Promise<void> {
  try {
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    if (sim.value.err) {
      const logs = sim.value.logs ?? [];
      throw new Error(
        `Swap simulation failed: ${JSON.stringify(sim.value.err)}\n${logs.slice(-8).join("\n")}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Simulation is a convenience - if the RPC itself is down, don't block a
    // legitimate swap; the on-chain execution will report the real error.
    if (msg.startsWith("Swap simulation failed")) throw err;
  }
}

async function signWithWallet(wallet: WalletContextState, tx: VersionedTransaction): Promise<VersionedTransaction> {
  if (!wallet.signTransaction) {
    throw new Error("Wallet does not support signTransaction. Update the wallet extension and reconnect.");
  }
  try {
    return await wallet.signTransaction(tx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Wallet rejected the swap: ${msg}`);
  }
}

async function broadcastAndConfirm(
  connection: Connection,
  wallet: WalletContextState,
  tx: VersionedTransaction,
): Promise<string> {
  let signature: string;
  try {
    if (wallet.sendTransaction) {
      signature = await wallet.sendTransaction(tx, connection, {
        skipPreflight: false,
        maxRetries: 3,
      });
    } else {
      signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
    }
  } catch (err) {
    throw new Error(friendlyOnchainError(err, ""));
  }
  const conf = await connection.confirmTransaction(signature, "confirmed");
  if (conf.value.err) {
    throw new Error(`Transaction confirmed but failed: ${JSON.stringify(conf.value.err)}`);
  }
  return signature;
}

/**
 * High-level: sign + land a Jupiter swap.
 *
 * This intentionally mirrors `simulateAndSend` from lib/trade.ts but routes
 * through Jupiter. Two flows, picked from what the quote carries:
 *
 *  - Swap API V2 (preferred): the quote already contains an assembled
 *    `transaction` (from GET /order). We simulate it locally for friendly
 *    pre-flight errors, ask the wallet to sign, then hand the signed tx to
 *    Jupiter's /execute for managed landing. If /execute is unreachable we
 *    broadcast the signed transaction ourselves via the RPC connection.
 *  - Legacy fallback: the quote has no transaction (quote-only upstream), so
 *    we ask the proxy to build a swapTransaction from the quote, then sign +
 *    send it via the wallet/RPC as before.
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

  if (!args.quote.transaction) {
    // ---------- Legacy flow: quote - swapTransaction - sign - send ----------
    if (args.quote.errorMessage) {
      throw new Error(`Jupiter could not route this swap: ${args.quote.errorMessage}`);
    }
    const swap = await jupFetch<LegacySwapResponse>("/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: args.quote,
        userPublicKey: user.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });
    if (!swap.swapTransaction) {
      throw new Error("Jupiter returned an empty swap transaction. Try again or adjust the amount.");
    }
    const tx = versionedTxFromBase64(swap.swapTransaction);
    await simulateForFriendlyErrors(args.connection, tx);
    const signed = await signWithWallet(args.wallet, tx);
    const signature = await broadcastAndConfirm(args.connection, args.wallet, signed);
    return { signature, quote: args.quote };
  }

  // ---------- Swap API V2 flow: order - sign - execute ----------
  if (args.quote.errorMessage) {
    throw new Error(`Jupiter could not route this swap: ${args.quote.errorMessage}`);
  }

  const tx = versionedTxFromBase64(args.quote.transaction);
  await simulateForFriendlyErrors(args.connection, tx);
  const signed = await signWithWallet(args.wallet, tx);
  const signedB64 = Buffer.from(signed.serialize()).toString("base64");

  const errors: string[] = [];
  let signature: string | null = null;

  try {
    const exec = await jupFetch<ExecuteResponse>("/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signedTransaction: signedB64,
        ...(args.quote.requestId ? { requestId: args.quote.requestId } : {}),
      }),
    });
    if (exec.signature) signature = exec.signature;
    if (exec.status === "Failed") {
      errors.push(`execute: ${exec.error ?? "transaction failed on-chain"}`);
      // The signature exists even on failure - confirmTransaction below will
      // surface the on-chain error. If Jupiter didn't hand one back, fall
      // through to broadcasting the signed tx via our own RPC.
      if (!signature) {
        try {
          signature = await args.connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
          });
        } catch (sendErr) {
          errors.push(`rpc sendRawTransaction: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
        }
      }
    }
  } catch (err) {
    errors.push(`execute: ${err instanceof Error ? err.message : String(err)}`);
    // Managed landing unreachable - broadcast the already-signed tx ourselves.
    try {
      signature = await args.connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
    } catch (sendErr) {
      errors.push(`rpc sendRawTransaction: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
    }
  }

  if (!signature) {
    throw new Error(`All broadcast methods failed: ${errors.join(", ")}`);
  }

  try {
    const conf = await args.connection.confirmTransaction(signature, "confirmed");
    if (conf.value.err) {
      throw new Error(`Transaction confirmed but failed: ${JSON.stringify(conf.value.err)}`);
    }
  } catch (err) {
    throw new Error(friendlyOnchainError(err, args.quote.outputMint));
  }

  return { signature, quote: args.quote };
}
