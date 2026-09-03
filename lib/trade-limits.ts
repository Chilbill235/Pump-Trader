import BN from "bn.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Hard minimum buy size on pump.fun bonding curves.
 * The on-chain program rejects buys below ~0.0011 SOL, and the SDK decimals
 * math round-trips to zero for anything below ~0.0001 SOL.
 * 0.005 SOL is also a reasonable practical floor (≈$1 at SOL=$200) and leaves
 * plenty of headroom above the program's actual minimum.
 */
export const MIN_BUY_SOL = 0.005;
export const MIN_BUY_LAMPORTS = Math.round(MIN_BUY_SOL * LAMPORTS_PER_SOL);

/**
 * Minimum wallet balance the user must have to start the bot.
 * $5 worth of SOL (USD-equivalent) at current SOL price.
 * This catches zero-balance / dust-wallet mistakes before any trade.
 */
export const MIN_BOT_USD_BALANCE = 5;

export const MIN_SOL_RESERVED_FOR_FEES = 0.01; // ATA rent + tx fees

export class TradeAmountError extends Error {
  readonly code: "too_small" | "invalid" | "below_minimum";
  constructor(code: "too_small" | "invalid" | "below_minimum", message: string) {
    super(message);
    this.code = code;
    this.name = "TradeAmountError";
  }
}

export function validateBuyAmount(input: string): {
  ok: boolean;
  lamports?: BN;
  error?: string;
} {
  const cleaned = input.trim();
  if (!cleaned) {
    return { ok: false, error: "Enter a SOL amount." };
  }
  if (!/^\d*\.?\d+$/.test(cleaned)) {
    return { ok: false, error: "Amount must be a positive number." };
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "Amount must be greater than 0 SOL." };
  }
  if (n < MIN_BUY_SOL) {
    return {
      ok: false,
      error: `Minimum buy is ${MIN_BUY_SOL} SOL (pump.fun rejects smaller buys).`,
    };
  }
  const lamports = new BN(Math.round(n * LAMPORTS_PER_SOL));
  return { ok: true, lamports };
}

export function validateSellAmount(input: string, decimals: number): {
  ok: boolean;
  raw?: BN;
  error?: string;
} {
  const cleaned = input.trim();
  if (!cleaned) {
    return { ok: false, error: "Enter a token amount." };
  }
  if (!/^\d*\.?\d+$/.test(cleaned)) {
    return { ok: false, error: "Amount must be a positive number." };
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "Amount must be greater than 0." };
  }
  const base = new BN(10).pow(new BN(decimals));
  const [wholeRaw, fracRaw = ""] = cleaned.split(".");
  const whole = wholeRaw.replace(/\D/g, "") || "0";
  const frac = (fracRaw.replace(/\D/g, "") + "0".repeat(decimals)).slice(0, decimals);
  const raw = new BN(whole).mul(base).add(new BN(frac || "0"));
  if (raw.lten(0)) {
    return { ok: false, error: "Amount must be greater than 0." };
  }
  return { ok: true, raw };
}

/**
 * Decide whether the user is allowed to start the bot.
 * Returns null if ok, or an error message.
 */
export function validateBotStart(args: {
  walletConnected: boolean;
  balanceLamports: number | null;
  solUsd: number | null;
}): string | null {
  if (!args.walletConnected) {
    return "Connect your Phantom wallet first.";
  }
  if (args.balanceLamports == null) {
    return "Could not read your SOL balance. Check your RPC connection.";
  }
  const sol = args.balanceLamports / LAMPORTS_PER_SOL;
  if (args.solUsd != null && Number.isFinite(args.solUsd) && args.solUsd > 0) {
    const usd = sol * args.solUsd;
    if (usd < MIN_BOT_USD_BALANCE) {
      return (
        `Need at least $${MIN_BOT_USD_BALANCE.toFixed(2)} worth of SOL to start the bot ` +
        `(wallet has ${sol.toFixed(4)} SOL ≈ $${usd.toFixed(2)}). ` +
        `Top up the wallet or lower your RPC/environment costs.`
      );
    }
  } else {
    // Fallback when we don't have a SOL price: gate on absolute SOL ≥ some sane floor.
    if (sol < 0.05) {
      return (
        `Need at least 0.05 SOL to start the bot (wallet has ${sol.toFixed(4)} SOL). ` +
        `Could not fetch SOL price to convert the $5 minimum — set NEXT_PUBLIC_SOLANA_RPC_URL.`
      );
    }
  }
  return null;
}