import BN from "bn.js";
import { SOL_DECIMALS, TOKEN_DECIMALS } from "./constants";

export function clampDecimals(value: string, decimals: number): string {
  const [w, f = ""] = value.replace(/[^\d.]/g, "").split(".");
  if (!f) return w || "0";
  return `${w || "0"}.${f.slice(0, decimals)}`;
}

export function parseUiAmount(input: string, decimals: number): BN {
  const cleaned = input.trim();
  if (!cleaned || cleaned === ".") return new BN(0);
  const [wholeRaw, fracRaw = ""] = cleaned.split(".");
  const whole = wholeRaw.replace(/\D/g, "") || "0";
  const frac = (fracRaw.replace(/\D/g, "") + "0".repeat(decimals)).slice(
    0,
    decimals,
  );
  const base = new BN(10).pow(new BN(decimals));
  return new BN(whole).mul(base).add(new BN(frac || "0"));
}

export function formatUiAmount(
  amount: BN,
  decimals: number,
  maxFrac = 6,
): string {
  if (amount.isNeg()) {
    return `-${formatUiAmount(amount.neg(), decimals, maxFrac)}`;
  }
  const base = new BN(10).pow(new BN(decimals));
  const whole = amount.div(base).toString();
  const frac = amount.mod(base).toString().padStart(decimals, "0");
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function solToLamports(input: string): BN {
  return parseUiAmount(input, SOL_DECIMALS);
}

export function lamportsToSol(lamports: BN, maxFrac = 6): string {
  return formatUiAmount(lamports, SOL_DECIMALS, maxFrac);
}

export function tokensToUi(raw: BN, decimals = TOKEN_DECIMALS, maxFrac = 4): string {
  return formatUiAmount(raw, decimals, maxFrac);
}

export function uiToTokens(input: string, decimals = TOKEN_DECIMALS): BN {
  return parseUiAmount(input, decimals);
}

export function compactNumber(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(digits)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(digits)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(digits)}K`;
  if (abs >= 1) return `${sign}${abs.toFixed(digits)}`;
  if (abs === 0) return "0";
  return `${sign}${abs.toPrecision(3)}`;
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1) {
    return n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  }
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  });
}

export function shortenAddress(addr: string, left = 4, right = 4): string {
  if (addr.length <= left + right + 1) return addr;
  return `${addr.slice(0, left)}…${addr.slice(-right)}`;
}

export function bnToNumberUnsafe(value: BN, decimals: number): number {
  const s = formatUiAmount(value, decimals, decimals);
  return Number(s);
}

export function pct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function timeAgo(ts: number): string {
  const delta = Date.now() - ts;
  const sec = Math.max(0, Math.floor(delta / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
