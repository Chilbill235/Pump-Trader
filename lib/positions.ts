import BN from "bn.js";
import { POSITIONS_KEY, TOKEN_DECIMALS } from "./constants";
import { safeReadScoped, safeWriteScoped } from "./accounts";
import type { Position, TradeSide } from "./types";

export function loadPositions(accountId: string | null): Position[] {
  if (typeof window === "undefined" || !accountId) return [];
  return safeReadScoped<Position[]>(accountId, POSITIONS_KEY, []);
}

export function savePositions(accountId: string | null, positions: Position[]): void {
  if (typeof window === "undefined" || !accountId) return;
  safeWriteScoped(accountId, POSITIONS_KEY, positions);
}

export function upsertPositionFromFill(args: {
  accountId: string | null;
  mint: string;
  name: string;
  symbol: string;
  decimals?: number;
  side: TradeSide;
  tokenAmountRaw: BN;
  solLamports: BN;
  signature: string | null;
  paper: boolean;
}): Position[] {
  const list = loadPositions(args.accountId);
  const decimals = args.decimals ?? TOKEN_DECIMALS;
  if (args.tokenAmountRaw.ltn(0) || args.solLamports.ltn(0)) {
    throw new Error(
      `Invalid fill amounts: tokenAmountRaw=${args.tokenAmountRaw.toString()}, solLamports=${args.solLamports.toString()}`,
    );
  }
  const idx = list.findIndex((p) => p.mint === args.mint);
  const existing = idx >= 0 ? list[idx] : null;
  const prevTokens = new BN(existing?.tokenAmountRaw ?? "0");
  const prevCost = new BN(existing?.costLamports ?? "0");

  let nextTokens: BN;
  let nextCost: BN;

  if (args.side === "buy") {
    nextTokens = prevTokens.add(args.tokenAmountRaw);
    nextCost = prevCost.add(args.solLamports);
  } else {
    if (prevTokens.isZero()) {
      nextTokens = new BN(0);
      nextCost = new BN(0);
    } else {
      const sellAmt = BN.min(args.tokenAmountRaw, prevTokens);
      nextTokens = prevTokens.sub(sellAmt);
      if (nextTokens.isZero()) {
        nextCost = new BN(0);
      } else {
        nextCost = prevCost.mul(nextTokens).div(prevTokens);
      }
    }
  }

  const next: Position = {
    mint: args.mint,
    name: args.name,
    symbol: args.symbol,
    decimals,
    tokenAmountRaw: nextTokens.toString(),
    costLamports: nextCost.toString(),
    takeProfitPct: existing?.takeProfitPct ?? null,
    stopLossPct: existing?.stopLossPct ?? null,
    lastSignature: args.signature ?? existing?.lastSignature,
    paper: existing ? existing.paper && args.paper : args.paper,
    updatedAt: Date.now(),
  };

  const out = list.slice();
  if (idx >= 0) out[idx] = next;
  else out.unshift(next);
  const filtered = out.filter((p) => p.tokenAmountRaw !== "0");
  savePositions(args.accountId, filtered);
  return filtered;
}

export function updatePositionMeta(
  accountId: string | null,
  mint: string,
  patch: Partial<Pick<Position, "takeProfitPct" | "stopLossPct" | "name" | "symbol">>,
): Position[] {
  const list = loadPositions(accountId).map((p) =>
    p.mint === mint ? { ...p, ...patch, updatedAt: Date.now() } : p,
  );
  savePositions(accountId, list);
  return list;
}

export function removePosition(accountId: string | null, mint: string): Position[] {
  const list = loadPositions(accountId).filter((p) => p.mint !== mint);
  savePositions(accountId, list);
  return list;
}

export function pnlPct(costLamports: BN, currentLamports: BN): number {
  if (costLamports.isZero()) return 0;
  const cost = Number(costLamports.toString());
  const cur = Number(currentLamports.toString());
  if (!Number.isFinite(cost) || cost === 0) return 0;
  return ((cur - cost) / cost) * 100;
}