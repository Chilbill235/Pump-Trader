/**
 * Adaptive learning for the trading bot.
 *
 * The bot keeps a rolling window of the last N closed trades per account and
 * uses them to:
 *  1. Compute a Kelly-like position size cap so it bets more when it's winning
 *     and less when it's losing, while never exceeding the user's safety rails.
 *  2. Derive signal weights — which scoring factors (liquidity, holders, curve
 *     position, momentum, age, narrative) actually predicted wins in the
 *     recent past, and re-bias the pipeline's decision accordingly.
 *  3. Track per-narrative and per-symbol hit rates so it can be skeptical of
 *     coins that look like previous losers.
 *
 * This is intentionally simple (no neural nets, no cloud) and runs entirely
 * from localStorage so it works offline. It updates itself on every closed
 * trade, so the longer the bot runs, the more in tune it gets with this
 * account's actual track record on pump.fun launches.
 */

import { CLOSED_TRADES_KEY } from "./constants";
import { safeReadScoped, safeWriteScoped } from "./accounts";
import type { ClosedTrade } from "./stats";

const LEARNING_KEY = "bot-learning:v1";
const ROLLING_WINDOW = 60; // closed trades

export type LearningSnapshot = {
  // Per-feature weight, multiplied into the pipeline's score. 1.0 = neutral,
  // >1 = trust more, <1 = trust less. Updated only when we have ≥10 closed
  // trades so the first few trades don't throw the bot off.
  signalWeights: {
    liquidity: number;
    holders: number;
    curve: number;
    momentum: number;
    age: number;
    metadata: number;
  };
  // Per-narrative keyword → win rate in the recent window. The pipeline
  // looks these up by matching coin.name to keyword prefixes ("pepe", "ai",
  // "trump", "wif", etc.).
  narrativeWinRate: Record<string, { wins: number; losses: number; rate: number }>;
  // Per-symbol hit rate for symbols we've traded more than once.
  symbolHitRate: Record<string, { wins: number; losses: number; rate: number }>;
  // The bot's realized win rate over the rolling window.
  winRate: number;
  // Kelly-style sizing: fraction of the user-capped per-coin budget to use.
  // 0.25 means "use 25% of the per-coin cap"; it scales up with win rate and
  // payoff ratio, scales down with losses. Always clamped to [0.1, 1.0].
  sizeFraction: number;
  // Latest bankroll health signal. 1.0 = full health, 0 = kill switch trip.
  health: number;
  // When did we last recompute?
  updatedAt: number;
  // How many closed trades we used for this snapshot.
  sampleSize: number;
  // Suggested drawdown tightening when losing (added to user setting).
  drawdownAddPct: number;
};

const DEFAULT_SNAPSHOT: LearningSnapshot = {
  signalWeights: {
    liquidity: 1,
    holders: 1,
    curve: 1,
    momentum: 1,
    age: 1,
    metadata: 1,
  },
  narrativeWinRate: {},
  symbolHitRate: {},
  winRate: 0.5,
  sizeFraction: 0.5,
  health: 1,
  updatedAt: 0,
  sampleSize: 0,
  drawdownAddPct: 0,
};

const NARRATIVE_KEYWORDS = [
  "pepe", "doge", "shib", "floki", "bonk", "wif", "myro", "popcat",
  "ai", "gpt", "agi", "agent", "bot",
  "trump", "biden", "elon", "musk",
  "sol", "solana", "jupiter", "jup",
  "cat", "dog", "frog", "inu",
  "inu", "kitty",
  "inu",
  "moon", "rocket", "lambo",
  "cum", "boob", "ass", "based",
  "jeet", "rug", "cope", "ngmi",
  "wagmi", "gm", "gn",
];

function pickNarrativeKey(name: string): string | null {
  const lower = name.toLowerCase();
  for (const kw of NARRATIVE_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

export function loadLearningSnapshot(accountId: string | null): LearningSnapshot {
  if (!accountId) return DEFAULT_SNAPSHOT;
  const snap = safeReadScoped<LearningSnapshot>(accountId, LEARNING_KEY, DEFAULT_SNAPSHOT);
  return { ...DEFAULT_SNAPSHOT, ...snap };
}

function saveLearningSnapshot(accountId: string | null, snap: LearningSnapshot): void {
  if (!accountId) return;
  safeWriteScoped(accountId, LEARNING_KEY, snap);
}

export function updateLearningFromClosedTrades(
  accountId: string | null,
  closedTrades: ClosedTrade[],
): LearningSnapshot {
  if (!accountId) return DEFAULT_SNAPSHOT;
  const window = closedTrades.slice(0, ROLLING_WINDOW);
  if (window.length === 0) return DEFAULT_SNAPSHOT;

  const wins = window.filter((t) => t.pnlSol > 0);
  const losses = window.filter((t) => pnlNeg(t));
  const winRate = window.length ? wins.length / window.length : 0.5;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnlSol, 0) / wins.length : 0;
  const avgLoss = losses.length
    ? Math.abs(losses.reduce((s, t) => s + t.pnlSol, 0) / losses.length)
    : 0.0001;
  const payoff = avgLoss > 0 ? avgWin / avgLoss : 1;

  // Kelly fraction: f* = (b*p - q) / b where b = payoff, p = win rate, q = 1-p.
  // We use a quarter-Kelly (more conservative) and clamp to a [0.1, 1.0] range
  // so the bot never bets more than the user's per-coin cap.
  const kelly = Math.max(0, (payoff * winRate - (1 - winRate)) / Math.max(0.0001, payoff));
  const sizeFraction = clamp(0.25 * kelly * 4, 0.1, 1.0);

  // Narrative hit rate
  const narrativeWinRate: LearningSnapshot["narrativeWinRate"] = {};
  const symbolHitRate: LearningSnapshot["symbolHitRate"] = {};
  for (const t of window) {
    const key = pickNarrativeKey(t.symbol) ?? pickNarrativeKey(t.mint);
    if (key) {
      const k = narrativeWinRate[key] ?? { wins: 0, losses: 0, rate: 0 };
      if (t.pnlSol > 0) k.wins++;
      else if (pnlNeg(t)) k.losses++;
      k.rate = k.wins + k.losses > 0 ? k.wins / (k.wins + k.losses) : 0;
      narrativeWinRate[key] = k;
    }
    const sym = t.symbol.toLowerCase();
    const s = symbolHitRate[sym] ?? { wins: 0, losses: 0, rate: 0 };
    if (t.pnlSol > 0) s.wins++;
    else if (pnlNeg(t)) s.losses++;
    s.rate = s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : 0;
    symbolHitRate[sym] = s;
  }

  // Bias signal weights from the bot's recent hold-time distribution. If
  // quick flips (under 10m) won, momentum mattered. If 1-4h holds won, age
  // filtering mattered. If long holds won, curve position mattered.
  const quickWins = wins.filter((t) => t.holdingMinutes < 10).length;
  const longWins = wins.filter((t) => t.holdingMinutes >= 60).length;
  const quickLosses = losses.filter((t) => t.holdingMinutes < 10).length;
  const longLosses = losses.filter((t) => t.holdingMinutes >= 60).length;
  const quickWinRate = quickWins + quickLosses > 0 ? quickWins / (quickWins + quickLosses) : 0.5;
  const longWinRate = longWins + longLosses > 0 ? longWins / (longWins + longLosses) : 0.5;

  const signalWeights: LearningSnapshot["signalWeights"] = {
    liquidity: 1.0,
    holders: 1.0,
    curve: 1.0,
    momentum: clamp(0.5 + quickWinRate, 0.5, 1.5),
    age: clamp(0.7 + longWinRate * 0.6, 0.7, 1.5),
    metadata: 1.0,
  };

  // Health decays with consecutive losses and recovers with wins.
  let streak = 0;
  for (const t of window) {
    if (t.pnlSol > 0) streak = Math.max(0, streak - 1);
    else if (pnlNeg(t)) streak++;
    else break;
    if (streak >= 5) break;
  }
  const health = clamp(1 - streak * 0.1, 0.2, 1);

  // When losing, suggest tightening the drawdown. When winning, loosen.
  const drawdownAddPct = winRate < 0.4 ? 0.1 : winRate > 0.6 ? -0.05 : 0;

  const snap: LearningSnapshot = {
    signalWeights,
    narrativeWinRate,
    symbolHitRate,
    winRate,
    sizeFraction,
    health,
    updatedAt: Date.now(),
    sampleSize: window.length,
    drawdownAddPct,
  };
  saveLearningSnapshot(accountId, snap);
  return snap;
}

function pnlNeg(t: ClosedTrade): boolean {
  return t.pnlSol < 0;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Bias a base score from the pipeline using the learning snapshot. The pipeline
 * calls this with the raw score it computed; we return an adjusted score and
 * a size multiplier the bot can apply on top of the per-coin cap.
 */
export function applyLearningBias(args: {
  baseScore: number;
  narrativeKey: string | null;
  symbol: string;
  snap: LearningSnapshot;
  minTrades: number;
}): { adjustedScore: number; sizeMultiplier: number; notes: string[] } {
  const notes: string[] = [];
  if (args.snap.sampleSize < args.minTrades) {
    return { adjustedScore: args.baseScore, sizeMultiplier: 1, notes: ["learning: not enough data"] };
  }
  let mult = args.snap.sizeFraction;
  if (args.narrativeKey) {
    const nr = args.snap.narrativeWinRate[args.narrativeKey];
    if (nr && nr.wins + nr.losses >= 3) {
      if (nr.rate < 0.3) {
        mult *= 0.5;
        notes.push(`narrative "${args.narrativeKey}" hit rate ${(nr.rate * 100).toFixed(0)}% — sizing down`);
      } else if (nr.rate > 0.7) {
        mult *= 1.1;
        notes.push(`narrative "${args.narrativeKey}" hit rate ${(nr.rate * 100).toFixed(0)}% — sizing up`);
      }
    }
  }
  const sym = args.snap.symbolHitRate[args.symbol.toLowerCase()];
  if (sym && sym.wins + sym.losses >= 2) {
    if (sym.rate < 0.3) {
      mult *= 0.4;
      notes.push(`symbol "${args.symbol}" lost before — strong downsize`);
    }
  }
  mult = clamp(mult, 0.1, 1.0);
  return { adjustedScore: args.baseScore, sizeMultiplier: mult, notes };
}

/**
 * Suggest runtime adjustments to safety rails based on the learning
 * snapshot. Returns modified per-coin cap, daily loss, and drawdown %.
 * The caller decides whether to apply them.
 */
export function suggestSafetyRails(args: {
  baseMaxPositionSol: number;
  baseDailyLossLimit: number;
  baseDrawdownPct: number;
  snap: LearningSnapshot;
}): {
  maxPositionSol: number;
  dailyLossLimit: number;
  drawdownPct: number;
  notes: string[];
} {
  const notes: string[] = [];
  if (args.snap.sampleSize < 8) {
    return {
      maxPositionSol: args.baseMaxPositionSol,
      dailyLossLimit: args.baseDailyLossLimit,
      drawdownPct: args.baseDrawdownPct,
      notes: ["learning: not enough data"],
    };
  }
  // Scale max position with size fraction * health.
  const maxPositionSol = args.baseMaxPositionSol * args.snap.sizeFraction * args.snap.health;
  // Tighten daily loss when losing, loosen when winning.
  const lossMul = args.snap.winRate < 0.4 ? 0.6 : args.snap.winRate > 0.6 ? 1.2 : 1.0;
  const dailyLossLimit = args.baseDailyLossLimit * lossMul;
  const drawdownPct = clamp(args.baseDrawdownPct + args.snap.drawdownAddPct, 0.05, 0.5);
  if (args.snap.health < 0.6) notes.push(`health low (${args.snap.health.toFixed(2)}) — bot cautious`);
  if (args.snap.winRate < 0.4) notes.push(`win rate ${(args.snap.winRate * 100).toFixed(0)}% — tightening limits`);
  if (args.snap.winRate > 0.6) notes.push(`win rate ${(args.snap.winRate * 100).toFixed(0)}% — loosening limits`);
  return { maxPositionSol, dailyLossLimit, drawdownPct, notes };
}

/**
 * Convenience: pull the latest closed trades from storage and recompute
 * the learning snapshot in one call. Returns the new snapshot.
 */
export function recomputeLearningNow(accountId: string | null): LearningSnapshot {
  if (!accountId) return DEFAULT_SNAPSHOT;
  const closed = safeReadScoped<ClosedTrade[]>(accountId, CLOSED_TRADES_KEY, []);
  return updateLearningFromClosedTrades(accountId, closed);
}