import BN from "bn.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Hard minimum buy size on pump.fun bonding curves.
 * The on-chain program rejects buys below ~0.0011 SOL, and the SDK decimals
 * math round-trips to zero for anything below ~0.0001 SOL.
 * 0.0001 SOL is the lowest the bonding-curve math will accept cleanly.
 */
export const MIN_BUY_SOL = 0.0001;
export const MIN_BUY_LAMPORTS = Math.round(MIN_BUY_SOL * LAMPORTS_PER_SOL);

/**
 * Minimum USD value for any trade on this app — buy or sell, pump or
 * Jupiter. Keeps the bot / panel from quoting and signing tiny dust trades
 * that the wallet will reject or that are not worth the priority fee.
 */
export const MIN_TRADE_USD = 1;

/**
 * Minimum USD value a wallet holding must be worth before the Positions
 * page enables the Trade button on it. Sub-$1 holdings are still shown
 * (so the user sees the complete list of everything in their wallet) but
 * cannot be traded because the on-chain fees + priority fee would eat
 * the entire position.
 */
export const MIN_HOLDING_USD_TO_TRADE = 1;

/**
 * Minimum wallet balance the user must have to start the bot.
 * $1 worth of SOL (USD-equivalent) at current SOL price.
 * This catches zero-balance / dust-wallet mistakes before any trade.
 */
export const MIN_BOT_USD_BALANCE = 1;

export const MIN_SOL_RESERVED_FOR_FEES = 0.0021; // ATA rent + tx fees

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
  // The on-chain pump program enforces a hard minimum (~0.0011 SOL). Below
  // that the math rounds to 0 and the transaction will be rejected. The
  // app's $1 USD minimum is enforced at the quote step, not here, so the
  // user can still see live quotes for tiny amounts.
  if (n < MIN_BUY_SOL) {
    return {
      ok: false,
      error: `On-chain minimum is ${MIN_BUY_SOL} SOL. Below this the pump program rejects the buy.`,
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
 * Like `validateSellAmount` but for any input token (SOL, USDC, BONK, etc.).
 * Used for Jupiter swaps where there is no on-chain minimum — the user can
 * type any number with up to `decimals` fractional digits. Allows arbitrarily
 * large amounts and tiny fractional dust.
 */
export function validateAnyTokenAmount(
  input: string,
  decimals: number,
): {
  ok: boolean;
  raw?: BN;
  error?: string;
} {
  const cleaned = input.trim();
  if (!cleaned) {
    return { ok: false, error: "Enter an amount." };
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
 * Convert a raw token amount to a USD value, given the mint's USD price and
 * the mint's decimals. Returns null if the price is unknown.
 */
export function rawAmountToUsd(
  raw: BN,
  decimals: number,
  usdPrice: number | null,
): number | null {
  if (usdPrice == null || !Number.isFinite(usdPrice) || usdPrice <= 0) return null;
  const base = new BN(10).pow(new BN(decimals));
  const whole = raw.div(base).toString();
  const frac = raw.mod(base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const combined = frac ? `${whole}.${frac}` : whole;
  const ui = Number(combined);
  if (!Number.isFinite(ui)) return null;
  return ui * usdPrice;
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