import BN from "bn.js";
import {
  CLOSED_TRADES_KEY,
  EQUITY_KEY,
  PEAK_KEY,
  START_BANKROLL_KEY,
} from "./constants";
import { safeReadScoped, safeWriteScoped, removeScoped } from "./accounts";

export type EquityPoint = {
  ts: number;
  bankrollSol: number;
  positionsValueSol: number;
  equitySol: number;
  realizedPnlSol: number;
};

export type ClosedTrade = {
  mint: string;
  symbol: string;
  ts: number;
  solIn: number;
  solOut: number;
  pnlSol: number;
  pnlPct: number;
  paper: boolean;
  holdingMinutes: number;
};

const MAX_POINTS = 240;
const TRADES_MAX = 200;

export function loadEquityCurve(accountId: string | null): EquityPoint[] {
  return safeReadScoped<EquityPoint[]>(accountId, EQUITY_KEY, []);
}

export function pushEquityPoint(accountId: string | null, point: EquityPoint): EquityPoint[] {
  if (!accountId) return [];
  const list = [...loadEquityCurve(accountId), point].slice(-MAX_POINTS);
  safeWriteScoped(accountId, EQUITY_KEY, list);
  return list;
}

export function clearEquityCurve(accountId: string | null): void {
  removeScoped(accountId, EQUITY_KEY);
}

export function loadClosedTrades(accountId: string | null): ClosedTrade[] {
  return safeReadScoped<ClosedTrade[]>(accountId, CLOSED_TRADES_KEY, []);
}

export function appendClosedTrade(
  accountId: string | null,
  t: ClosedTrade,
): ClosedTrade[] {
  if (!accountId) return [];
  const list = [t, ...loadClosedTrades(accountId)].slice(0, TRADES_MAX);
  safeWriteScoped(accountId, CLOSED_TRADES_KEY, list);
  return list;
}

export function getPeakEquity(accountId: string | null): number {
  return safeReadScoped<number>(accountId, PEAK_KEY, 0);
}

export function updatePeakEquity(accountId: string | null, equity: number): number {
  if (!accountId) return 0;
  const peak = getPeakEquity(accountId);
  const next = Math.max(peak, equity);
  safeWriteScoped(accountId, PEAK_KEY, next);
  return next;
}

export function getStartBankroll(accountId: string | null): number {
  return safeReadScoped<number>(accountId, START_BANKROLL_KEY, 0);
}

export function setStartBankroll(accountId: string | null, sol: number): void {
  safeWriteScoped(accountId, START_BANKROLL_KEY, sol);
}

export function resetStatsForNewSession(accountId: string | null): void {
  if (!accountId) return;
  removeScoped(accountId, EQUITY_KEY);
  removeScoped(accountId, PEAK_KEY);
  removeScoped(accountId, START_BANKROLL_KEY);
  removeScoped(accountId, CLOSED_TRADES_KEY);
}

export type Stats = {
  closed: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnlSol: number;
  realizedPnlPct: number;
  avgWinSol: number;
  avgLossSol: number;
  avgHoldMinutes: number;
  bestTradeSol: number;
  worstTradeSol: number;
  exposureSol: number;
  unrealizedPnlSol: number;
  equitySol: number;
  peakEquitySol: number;
  drawdownSol: number;
  drawdownPct: number;
  killSwitchTripped: boolean;
};

export function computeStats(args: {
  closedTrades: ClosedTrade[];
  bankrollSol: number;
  positionsValueSol: number;
  realizedPnlSol: number;
  startBankrollSol: number;
  peakEquitySol: number;
}): Stats {
  const closed = args.closedTrades;
  const wins = closed.filter((t) => t.pnlSol > 0).length;
  const losses = closed.filter((t) => t.pnlSol < 0).length;
  const winSol = closed.filter((t) => t.pnlSol > 0).reduce((s, t) => s + t.pnlSol, 0);
  const lossSol = closed.filter((t) => t.pnlSol < 0).reduce((s, t) => s + Math.abs(t.pnlSol), 0);
  const avgWinSol = wins ? winSol / wins : 0;
  const avgLossSol = losses ? lossSol / losses : 0;
  const bestTradeSol = closed.reduce((m, t) => Math.max(m, t.pnlSol), 0);
  const worstTradeSol = closed.reduce((m, t) => Math.min(m, t.pnlSol), 0);
  const avgHoldMinutes = closed.length
    ? closed.reduce((s, t) => s + t.holdingMinutes, 0) / closed.length
    : 0;
  const equitySol = args.bankrollSol + args.positionsValueSol;
  const drawdownSol = Math.max(0, args.peakEquitySol - equitySol);
  const drawdownPct = args.peakEquitySol > 0 ? drawdownSol / args.peakEquitySol : 0;
  return {
    closed: closed.length,
    wins,
    losses,
    winRate: closed.length ? wins / closed.length : 0,
    realizedPnlSol: args.realizedPnlSol,
    realizedPnlPct:
      args.startBankrollSol > 0 ? (equitySol - args.startBankrollSol) / args.startBankrollSol : 0,
    avgWinSol,
    avgLossSol,
    avgHoldMinutes,
    bestTradeSol,
    worstTradeSol,
    exposureSol: args.positionsValueSol,
    unrealizedPnlSol: args.positionsValueSol,
    equitySol,
    peakEquitySol: args.peakEquitySol,
    drawdownSol,
    drawdownPct,
    killSwitchTripped: false,
  };
}

export function bnToSol(value: BN): number {
  return Number(value.toString()) / 1e9;
}