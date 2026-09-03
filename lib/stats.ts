import BN from "bn.js";

const KEY = "pump-trader:equity:v1";
const MAX_POINTS = 240; // ~2h at 30s tick

export type EquityPoint = {
  ts: number;
  bankrollSol: number; // wallet SOL
  positionsValueSol: number;
  equitySol: number; // bankroll + positionsValue
  realizedPnlSol: number;
};

export type TradeOutcome = {
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  ts: number;
  solIn: number;
  solOut: number;
  pnlSol: number;
  pnlPct: number;
  paper: boolean;
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

const TRADES_KEY = "pump-trader:closed-trades:v1";
const TRADES_MAX = 200;
const PEAK_KEY = "pump-trader:peak-equity:v1";
const START_BANKROLL_KEY = "pump-trader:start-bankroll:v1";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadEquityCurve(): EquityPoint[] {
  return readJson<EquityPoint[]>(KEY, []);
}

export function pushEquityPoint(point: EquityPoint): EquityPoint[] {
  const list = [...loadEquityCurve(), point].slice(-MAX_POINTS);
  writeJson(KEY, list);
  return list;
}

export function clearEquityCurve(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export function loadClosedTrades(): ClosedTrade[] {
  return readJson<ClosedTrade[]>(TRADES_KEY, []);
}

export function appendClosedTrade(t: ClosedTrade): ClosedTrade[] {
  const list = [t, ...loadClosedTrades()].slice(0, TRADES_MAX);
  writeJson(TRADES_KEY, list);
  return list;
}

export function getPeakEquity(): number {
  return readJson<number>(PEAK_KEY, 0);
}

export function updatePeakEquity(equity: number): number {
  const peak = getPeakEquity();
  const next = Math.max(peak, equity);
  writeJson(PEAK_KEY, next);
  return next;
}

export function getStartBankroll(): number {
  return readJson<number>(START_BANKROLL_KEY, 0);
}

export function setStartBankroll(sol: number): void {
  writeJson(START_BANKROLL_KEY, sol);
}

export function resetStatsForNewSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(PEAK_KEY);
  window.localStorage.removeItem(START_BANKROLL_KEY);
  window.localStorage.removeItem(TRADES_KEY);
}

export type Stats = {
  closed: number;
  wins: number;
  losses: number;
  winRate: number; // 0..1
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
    unrealizedPnlSol: args.positionsValueSol - 0, // realized tracked separately
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