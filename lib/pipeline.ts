import {
  PUMP_GRADUATION_SOL,
  PUMP_INITIAL_VIRTUAL_SOL,
} from "./constants";
import type { AppSettings } from "./settings";
import type {
  PipelineCandidate,
  PipelineLogEntry,
  PipelineScores,
  PipelineStage,
  PumpCoin,
} from "./types";

/** Weighted mix used by compute_score. Must sum to 1. */
export const SCORE_WEIGHTS = {
  risk_inverse: 0.22,
  social_signal: 0.15,
  narrative_fit: 0.18,
  curve_health: 0.15,
  wallet_diversity: 0.15,
  momentum: 0.15,
} as const;

const GENERIC_TICKERS = new Set([
  "pepe",
  "wojak",
  "elon",
  "trump",
  "doge",
  "bonk",
  "inu",
  "cat",
  "dog",
  "moon",
  "ai",
  "gpt",
  "wif",
  "popcat",
  "mog",
  "spx",
  "fartcoin",
  "goat",
]);

export type UniqueBuyerEstimate = {
  count: number;
  estimated: boolean;
  method: string;
};

export type LaunchMetrics = {
  ageMinutes: number;
  bondingCurvePct: number;
  solInCurve: number;
  uniqueBuyers: UniqueBuyerEstimate;
  hasMetadata: boolean;
  replyCount: number;
  complete: boolean;
};

export type RiskAnalysis = {
  riskScore: number;
  flags: string[];
};

export type PipelineDecision = {
  action: "skip" | "queue";
  stage: PipelineStage;
  reason: string;
  analysis?: LaunchMetrics & {
    risk: RiskAnalysis;
    narrativeNote: string;
    reasonsNotToBuy: string[];
  };
  scores?: PipelineScores;
  sizeSol?: number;
};

export type PipelineContext = {
  recentTickers: string[];
  newestListCount: number;
  launchesLastHour: number;
  now: number;
  dailyAtRiskSol: number;
  openCostByMint: Record<string, number>;
  openPositionsCount: number;
  momentumByMint?: Record<string, number>;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function alphanum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function createdAtMs(coin: PumpCoin): number | null {
  if (coin.createdAt == null || !Number.isFinite(coin.createdAt)) return null;
  return coin.createdAt < 1e12 ? coin.createdAt * 1000 : coin.createdAt;
}

export function ageMinutesOf(coin: PumpCoin, now = Date.now()): number {
  const ts = createdAtMs(coin);
  if (ts == null) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - ts) / 60_000);
}

/** Bonding progress 0–100 from reserves. Complete coins are 100. */
export function bondingCurvePctOf(coin: PumpCoin): number {
  if (coin.complete) return 100;
  const realSol =
    coin.realSolReserves != null && Number.isFinite(coin.realSolReserves)
      ? coin.realSolReserves / 1e9
      : null;
  const virtSol =
    coin.virtualSolReserves != null && Number.isFinite(coin.virtualSolReserves)
      ? coin.virtualSolReserves / 1e9
      : null;
  let pct: number | null = null;
  if (realSol != null && realSol > 0) {
    pct = (realSol / PUMP_GRADUATION_SOL) * 100;
  } else if (virtSol != null && virtSol > PUMP_INITIAL_VIRTUAL_SOL) {
    pct = ((virtSol - PUMP_INITIAL_VIRTUAL_SOL) / PUMP_GRADUATION_SOL) * 100;
  } else {
    pct = 0;
  }
  return clamp(pct, 0, 100);
}

export function solInCurveOf(coin: PumpCoin): number {
  if (coin.realSolReserves != null && Number.isFinite(coin.realSolReserves)) {
    const v = coin.realSolReserves / 1e9;
    if (v > 0) return v;
  }
  if (coin.virtualSolReserves != null && Number.isFinite(coin.virtualSolReserves)) {
    return Math.max(0, coin.virtualSolReserves / 1e9 - PUMP_INITIAL_VIRTUAL_SOL);
  }
  return 0;
}

export function hasMetadataOf(coin: PumpCoin): boolean {
  const name = coin.name.trim();
  const symbol = coin.symbol.trim();
  const named = Boolean(name && name !== "Unknown" && symbol && symbol !== "???");
  const image = Boolean(coin.imageUri);
  const desc = Boolean(coin.description && coin.description.trim().length >= 8);
  const uri = Boolean(coin.metadataUri);
  return named && (image || desc || uri);
}

/**
 * Unique buyer count. Pump list/detail APIs do not currently expose holders.
 * If unique_buyers / num_holders is missing, estimate from SOL in the curve
 * (conservative ~0.12 SOL per unique buy so a whale does not look like a crowd)
 * plus reply_count as a small boost, capped at 40.
 */
export function uniqueBuyersOf(coin: PumpCoin): UniqueBuyerEstimate {
  const raw = coin.uniqueBuyers;
  if (raw != null && Number.isFinite(raw) && raw >= 0) {
    return { count: Math.round(raw), estimated: false, method: "api" };
  }
  const rec = coin.raw ?? {};
  for (const key of ["unique_buyers", "uniqueBuyers", "num_holders", "holder_count", "holders"]) {
    const v = rec[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      return { count: Math.round(v), estimated: false, method: key };
    }
  }
  const solIn = solInCurveOf(coin);
  const replies = coin.replyCount ?? 0;
  if (solIn <= 0 && replies <= 0 && !coin.lastTradeAt) {
    return { count: 0, estimated: true, method: "empty-curve" };
  }
  // Larger assumed buy size → fewer wallets. A 0.4 SOL dump should not clear unique >= 5.
  const fromSol = solIn > 0 ? Math.max(1, Math.floor(solIn / 0.12)) : 0;
  const fromReplies = replies > 0 && solIn > 0 ? Math.min(replies, fromSol + 4) : 0;
  const fromTrade = coin.lastTradeAt && solIn > 0 ? 1 : 0;
  const count = Math.min(40, Math.max(fromSol, fromReplies, fromTrade));
  return { count, estimated: true, method: "sol-in-curve+replies" };
}

export function extractMetrics(coin: PumpCoin, now = Date.now()): LaunchMetrics {
  return {
    ageMinutes: ageMinutesOf(coin, now),
    bondingCurvePct: bondingCurvePctOf(coin),
    solInCurve: solInCurveOf(coin),
    uniqueBuyers: uniqueBuyersOf(coin),
    hasMetadata: hasMetadataOf(coin),
    replyCount: coin.replyCount ?? 0,
    complete: Boolean(coin.complete),
  };
}

export function passesBasicFilter(
  coin: PumpCoin,
  settings: AppSettings,
  metrics: LaunchMetrics,
): { ok: true } | { ok: false; reason: string } {
  if (metrics.complete) {
    return { ok: false, reason: "already graduated — pipeline only buys on the curve" };
  }
  if (coin.isBanned) {
    return { ok: false, reason: "token flagged is_banned on pump.fun" };
  }
  if (metrics.ageMinutes <= settings.minAgeMinutes) {
    const age = Number.isFinite(metrics.ageMinutes) ? metrics.ageMinutes.toFixed(1) : "?";
    return {
      ok: false,
      reason: `age ${age}m ≤ ${settings.minAgeMinutes}m — has not survived the first minutes`,
    };
  }
  if (metrics.uniqueBuyers.count < settings.minUniqueBuyers) {
    const src = metrics.uniqueBuyers.estimated ? "estimated" : "api";
    return {
      ok: false,
      reason: `${src} unique buyers ${metrics.uniqueBuyers.count} < ${settings.minUniqueBuyers} (empty/thin curve)`,
    };
  }
  if (metrics.bondingCurvePct >= settings.maxBondingCurvePct) {
    return {
      ok: false,
      reason: `bonding curve ${metrics.bondingCurvePct.toFixed(1)}% ≥ ${settings.maxBondingCurvePct}% — not early`,
    };
  }
  if (settings.requireMetadata && !metrics.hasMetadata) {
    return { ok: false, reason: "missing metadata (need name/symbol plus image or description)" };
  }
  return { ok: true };
}

function creatorNameCollision(coin: PumpCoin): boolean {
  const uname = alphanum(coin.username ?? "");
  const name = alphanum(coin.name);
  const symbol = alphanum(coin.symbol);
  if (uname.length >= 3 && (name.includes(uname) || uname.includes(name) || symbol === uname)) {
    return true;
  }
  return false;
}

/** AUDITOR: heuristic risk 1–10 (higher = more dangerous). */
export function analyzeRisk(coin: PumpCoin, metrics: LaunchMetrics): RiskAnalysis {
  const flags: string[] = [];
  let risk = 4;
  if (metrics.complete) {
    risk += 3;
    flags.push("curve already complete");
  }
  if (!metrics.hasMetadata) {
    risk += 2;
    flags.push("thin or missing metadata");
  }
  if (metrics.uniqueBuyers.count < 8) {
    risk += 2;
    flags.push("very low unique buyers");
  } else if (metrics.uniqueBuyers.count < 12) {
    risk += 1;
    flags.push("low unique buyers");
  }
  if (metrics.uniqueBuyers.estimated) {
    risk += 1;
    flags.push("unique buyers estimated (API has no holder count)");
  }
  if (coin.nsfw) {
    risk += 1;
    flags.push("nsfw flag");
  }
  if (creatorNameCollision(coin)) {
    risk += 2;
    flags.push("creator username collides with name/ticker");
  }
  if (metrics.solInCurve >= 2 && metrics.replyCount === 0) {
    risk += 2;
    flags.push("SOL in curve with zero replies — possible sniper/bot fill");
  }
  if (metrics.bondingCurvePct > 25) {
    risk += 1;
    flags.push("curve already past 25%");
  }
  if (!coin.twitter && !coin.telegram && !coin.website) {
    risk += 1;
    flags.push("no twitter/telegram/website");
  }
  if (coin.isBanned) {
    risk += 4;
    flags.push("banned");
  }
  // Holder concentration unknown → treat estimated-few + size as concentrated.
  if (metrics.uniqueBuyers.estimated && metrics.uniqueBuyers.count < 10 && metrics.solInCurve >= 1) {
    risk += 1;
    flags.push("holder concentration unknown; curve may be a few wallets");
  }
  return { riskScore: clamp(Math.round(risk), 1, 10), flags };
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

function tickerCollision(symbol: string, recentTickers: string[]): string | null {
  const me = alphanum(symbol);
  if (!me) return null;
  for (const other of recentTickers) {
    const you = alphanum(other);
    if (!you || you === me && other === symbol) continue;
    if (you === me) return other;
    if (me.length >= 3 && you.length >= 3 && (me.includes(you) || you.includes(me))) return other;
    if (me.length <= 8 && you.length <= 8 && levenshtein(me, you) <= 1) return other;
  }
  return null;
}

/** NARRATIVE: 0–1 meme-potential from name/symbol/description/image/uniqueness. */
export function scoreNarrative(
  coin: PumpCoin,
  recentTickers: string[],
): { score: number; note: string; collision: string | null } {
  let score = 0.35;
  const name = coin.name.trim();
  const symbol = coin.symbol.trim();
  const desc = (coin.description ?? "").trim();
  const bits: string[] = [];

  if (name.length >= 3 && name.length <= 24) {
    score += 0.12;
    bits.push("name length is readable");
  } else if (name.length > 40) {
    score -= 0.1;
    bits.push("name is long/spammy");
  }
  if (symbol.length >= 2 && symbol.length <= 8) {
    score += 0.1;
    bits.push("ticker length is typical");
  } else {
    score -= 0.08;
    bits.push("ticker is awkward length");
  }
  if (coin.imageUri) {
    score += 0.15;
    bits.push("image present");
  } else {
    bits.push("no image");
  }
  if (desc.length >= 20 && desc.length <= 280) {
    score += 0.15;
    bits.push("description looks written");
  } else if (desc.length > 0 && desc.length < 20) {
    score += 0.04;
    bits.push("description is a stub");
  } else if (!desc) {
    bits.push("no description");
  } else {
    score -= 0.05;
    bits.push("description is very long");
  }

  const collision = tickerCollision(symbol, recentTickers.filter((t) => t !== symbol));
  if (collision) {
    score -= 0.18;
    bits.push(`ticker collides with recent ${collision}`);
  } else {
    score += 0.08;
    bits.push("ticker is unique vs this newest batch");
  }

  const gen = alphanum(symbol);
  if (GENERIC_TICKERS.has(gen)) {
    score -= 0.12;
    bits.push("generic meme ticker");
  }

  const note = bits.join("; ");
  return { score: clamp(score, 0, 1), note, collision };
}

export function scoreSocial(coin: PumpCoin, metrics: LaunchMetrics): number {
  let s = 0;
  if (coin.twitter) s += 0.25;
  if (coin.telegram) s += 0.15;
  if (coin.website) s += 0.15;
  if (coin.imageUri) s += 0.1;
  s += Math.min(1, metrics.replyCount / 20) * 0.25;
  if (coin.isCurrentlyLive) s += 0.1;
  return clamp(s, 0, 1);
}

export function scoreCurveHealth(metrics: LaunchMetrics): number {
  const pct = metrics.bondingCurvePct;
  let sweet: number;
  if (pct < 2) sweet = 0.25;
  else if (pct < 5) sweet = 0.7;
  else if (pct <= 25) sweet = 1;
  else if (pct <= 40) sweet = 0.55;
  else sweet = 0.2;
  const ratio =
    metrics.uniqueBuyers.count > 0
      ? clamp(metrics.replyCount / metrics.uniqueBuyers.count, 0, 2) / 2
      : 0;
  const mix = sweet * 0.75 + ratio * 0.25;
  return clamp(metrics.complete ? mix * 0.2 : mix, 0, 1);
}

export function scoreWalletDiversity(metrics: LaunchMetrics): number {
  const n = metrics.uniqueBuyers.count;
  let base: number;
  if (n <= 0) base = 0;
  else if (n < 5) base = 0.15;
  else if (n < 10) base = 0.4;
  else if (n < 20) base = 0.7;
  else base = 1;
  if (metrics.uniqueBuyers.estimated) base *= 0.6;
  if (metrics.solInCurve >= 2 && n < 8) base *= 0.5;
  return clamp(base, 0, 1);
}

/** TIMING: hour-of-day (America/New_York) and how crowded the newest list is. */
export function scoreTiming(ctx: PipelineContext): { score: number; note: string } {
  let hour = 12;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    });
    hour = Number(fmt.format(new Date(ctx.now)));
  } catch {
    hour = new Date(ctx.now).getUTCHours();
  }
  let clock = 0.75;
  if (hour >= 0 && hour < 8) clock = 0.55;
  else if (hour >= 17 && hour <= 23) clock = 0.6;
  else clock = 0.85;

  const crowding = ctx.launchesLastHour;
  let crowd = 1;
  if (crowding >= 40) crowd = 0.35;
  else if (crowding >= 25) crowd = 0.5;
  else if (crowding >= 15) crowd = 0.7;
  else if (crowding >= 8) crowd = 0.85;
  const score = clamp(clock * 0.5 + crowd * 0.5, 0, 1);
  const note = `ET hour ${hour}, ${crowding} launches in the last hour on this newest list`;
  return { score, note };
}

export function computeScore(parts: {
  riskScore: number;
  social: number;
  narrative: number;
  curve: number;
  wallets: number;
  timing?: number;
  momentum?: number;
}): { scores: PipelineScores; riskInverse: number } {
  const riskInverse = clamp(1 - parts.riskScore / 10, 0, 1);
  const timing = parts.timing ?? 0;
  const momentum = clamp(parts.momentum ?? 0, 0, 1);
  const total =
    riskInverse * SCORE_WEIGHTS.risk_inverse +
    parts.social * SCORE_WEIGHTS.social_signal +
    parts.narrative * SCORE_WEIGHTS.narrative_fit +
    parts.curve * SCORE_WEIGHTS.curve_health +
    parts.wallets * SCORE_WEIGHTS.wallet_diversity +
    momentum * SCORE_WEIGHTS.momentum;
  return {
    riskInverse,
    scores: {
      risk_score: parts.riskScore,
      risk_inverse: round4(riskInverse),
      social_signal: round4(parts.social),
      narrative_fit: round4(parts.narrative),
      curve_health: round4(parts.curve),
      wallet_diversity: round4(parts.wallets),
      timing: round4(timing),
      momentum: round4(momentum),
      total: round4(total),
    },
  };
}

/** CHECKER: default stance is NO. Always at least one caution. */
export function reasonsNotToBuy(args: {
  coin: PumpCoin;
  metrics: LaunchMetrics;
  risk: RiskAnalysis;
  narrativeNote: string;
  collision: string | null;
  timingNote: string;
  timingScore: number;
  scores: PipelineScores;
}): string[] {
  const reasons: string[] = [
    "Most pump.fun coins go to zero. Default stance is NO.",
  ];
  for (const f of args.risk.flags) reasons.push(f);
  if (args.metrics.uniqueBuyers.estimated) {
    reasons.push(
      `Unique buyer count ${args.metrics.uniqueBuyers.count} is estimated from ${args.metrics.uniqueBuyers.method}, not on-chain holders.`,
    );
  }
  if (args.collision) {
    reasons.push(`Ticker looks like a copy of recent ${args.collision}.`);
  }
  if (!args.coin.twitter && !args.coin.telegram && !args.coin.website) {
    reasons.push("No social links — easy to fade.");
  }
  if (args.metrics.bondingCurvePct < 3) {
    reasons.push("Curve is still almost empty even if it cleared the buyer floor.");
  }
  if (args.metrics.ageMinutes < 8) {
    reasons.push(`Only ${args.metrics.ageMinutes.toFixed(1)} minutes old — still in the lottery window.`);
  }
  if (args.timingScore < 0.65) {
    reasons.push(`Crowded/off-hours tape: ${args.timingNote}.`);
  }
  if (args.coin.complete) {
    reasons.push("Not on the bonding curve.");
  }
  // de-dupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of reasons) {
    const k = r.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/**
 * MONITOR → filter → AUDITOR (risk) → NARRATIVE → TIMING → score → CHECKER
 * → risk brake → queue for human approval. Never auto-executes a live buy.
 */
export function evaluateCoin(
  coin: PumpCoin,
  settings: AppSettings,
  ctx: PipelineContext,
): PipelineDecision {
  const metrics = extractMetrics(coin, ctx.now);

  const basic = passesBasicFilter(coin, settings, metrics);
  if (!basic.ok) {
    return { action: "skip", stage: "filter", reason: basic.reason };
  }

  const risk = analyzeRisk(coin, metrics);
  if (risk.riskScore > 7) {
    return {
      action: "skip",
      stage: "risk",
      reason: `risk_score ${risk.riskScore} > 7 (${risk.flags.join("; ") || "too dangerous"})`,
      analysis: {
        ...metrics,
        risk,
        narrativeNote: "",
        reasonsNotToBuy: risk.flags.length ? risk.flags : ["risk_score above hard cap"],
      },
      scores: {
        risk_score: risk.riskScore,
        risk_inverse: round4(1 - risk.riskScore / 10),
        social_signal: 0,
        narrative_fit: 0,
        curve_health: 0,
        wallet_diversity: 0,
        timing: 0,
        momentum: 0,
        total: 0,
      },
    };
  }

  const narrative = scoreNarrative(coin, ctx.recentTickers);
  const social = scoreSocial(coin, metrics);
  const curve = scoreCurveHealth(metrics);
  const wallets = scoreWalletDiversity(metrics);
  const timing = scoreTiming(ctx);
  const momentum = ctx.momentumByMint?.[coin.mint] ?? 0;
  const { scores } = computeScore({
    riskScore: risk.riskScore,
    social,
    narrative: narrative.score,
    curve,
    wallets,
    timing: timing.score,
    momentum,
  });

  const reasons = reasonsNotToBuy({
    coin,
    metrics,
    risk,
    narrativeNote: narrative.note,
    collision: narrative.collision,
    timingNote: timing.note,
    timingScore: timing.score,
    scores,
  });

  const analysis = {
    ...metrics,
    risk,
    narrativeNote: `${narrative.note}. Timing: ${timing.note}.`,
    reasonsNotToBuy: reasons,
  };

  if (narrative.score < 0.22) {
    return {
      action: "skip",
      stage: "narrative",
      reason: `narrative_fit ${narrative.score.toFixed(3)} is junk/generic/copy (${narrative.note})`,
      analysis,
      scores,
    };
  }

  if (scores.total < settings.minScore) {
    return {
      action: "skip",
      stage: "score",
      reason: `score ${scores.total.toFixed(3)} < min_score ${settings.minScore}`,
      analysis,
      scores,
    };
  }

  const open = ctx.openCostByMint[coin.mint] ?? 0;
  const sizeSol = Math.max(0, settings.maxPositionSol - open);
  if (settings.maxPositionSol <= 0 || sizeSol <= 0) {
    return {
      action: "skip",
      stage: "risk_limit",
      reason:
        open > 0
          ? `already at max_position_sol (${open.toFixed(4)} ≥ ${settings.maxPositionSol})`
          : "max_position_sol is 0",
      analysis,
      scores,
    };
  }
  if (ctx.dailyAtRiskSol >= settings.dailyLossLimit) {
    return {
      action: "skip",
      stage: "risk_limit",
      reason: `daily at-risk/loss ${ctx.dailyAtRiskSol.toFixed(3)} SOL ≥ limit ${settings.dailyLossLimit}`,
      analysis,
      scores,
    };
  }
  if (ctx.dailyAtRiskSol + sizeSol > settings.dailyLossLimit + 1e-9) {
    return {
      action: "skip",
      stage: "risk_limit",
      reason: `this ${sizeSol} SOL buy would push daily at-risk ${ctx.dailyAtRiskSol.toFixed(3)} over ${settings.dailyLossLimit}`,
      analysis,
      scores,
    };
  }
  if (ctx.openPositionsCount >= settings.maxOpenPositions) {
    return {
      action: "skip",
      stage: "risk_limit",
      reason: `already at max open positions (${ctx.openPositionsCount} ≥ ${settings.maxOpenPositions})`,
      analysis,
      scores,
    };
  }

  return {
    action: "queue",
    stage: "queued",
    reason: `score ${scores.total.toFixed(3)} cleared min_score ${settings.minScore}; human must approve`,
    analysis,
    scores,
    sizeSol,
  };
}

export function crowdingStats(coins: PumpCoin[], now: number): {
  recentTickers: string[];
  launchesLastHour: number;
} {
  const recentTickers = coins.map((c) => c.symbol);
  const launchesLastHour = coins.filter((c) => ageMinutesOf(c, now) <= 60).length;
  return { recentTickers, launchesLastHour };
}

export function evaluateLaunchBatch(
  coins: PumpCoin[],
  settings: AppSettings,
  extras: {
    dailyAtRiskSol: number;
    openCostByMint: Record<string, number>;
    openPositionsCount: number;
    now?: number;
    momentumByMint?: Record<string, number>;
    learning?: {
      narrativeWinRate: Record<string, { wins: number; losses: number; rate: number }>;
      symbolHitRate: Record<string, { wins: number; losses: number; rate: number }>;
      sizeFraction: number;
      health: number;
      sampleSize: number;
    };
  },
): PipelineDecision[] {
  const now = extras.now ?? Date.now();
  const { recentTickers, launchesLastHour } = crowdingStats(coins, now);
  const ctx: PipelineContext = {
    recentTickers,
    newestListCount: coins.length,
    launchesLastHour,
    now,
    dailyAtRiskSol: extras.dailyAtRiskSol,
    openCostByMint: extras.openCostByMint,
    openPositionsCount: extras.openPositionsCount,
    momentumByMint: extras.momentumByMint ?? {},
  };
  const learning = extras.learning;
  const out: PipelineDecision[] = [];
  for (const coin of coins) {
    const decision = evaluateCoin(coin, settings, ctx);
    // Adaptive learning: bias the queued size based on the bot's recent
    // performance on this narrative / symbol. We never OVERSIZE beyond the
    // user's per-coin cap, but we can downsize when the bot is cold.
      if (learning && decision.action === "queue" && decision.sizeSol != null) {
        if (learning.sampleSize >= 8) {
          const narKey = pickNarrativeKey(coin.name) ?? pickNarrativeKey(coin.symbol);
          let mult = learning.sizeFraction * learning.health;
          const why: string[] = [];
        if (narKey) {
          const nr = learning.narrativeWinRate[narKey];
          if (nr && nr.wins + nr.losses >= 3) {
            if (nr.rate < 0.3) {
              mult *= 0.5;
              why.push(`narrative ${narKey} ${(nr.rate * 100).toFixed(0)}% win`);
            } else if (nr.rate > 0.7) {
              mult *= 1.1;
              why.push(`narrative ${narKey} ${(nr.rate * 100).toFixed(0)}% win`);
            }
          }
        }
        const sym = learning.symbolHitRate[coin.symbol.toLowerCase()];
        if (sym && sym.wins + sym.losses >= 2 && sym.rate < 0.3) {
          mult *= 0.4;
          why.push(`symbol ${coin.symbol} lost before`);
        }
        mult = Math.max(0.1, Math.min(1, mult));
        const newSize = Math.max(0.0001, decision.sizeSol * mult);
        if (newSize < decision.sizeSol - 1e-9) {
          decision.sizeSol = newSize;
          decision.reason = `${decision.reason} · learned sizing ×${mult.toFixed(2)} (${why.join(", ") || "robot health"})`;
        }
      }
    }
    out.push(decision);
    if (decision.action === "queue" && decision.sizeSol) {
      ctx.dailyAtRiskSol += decision.sizeSol;
    }
  }
  return out;
}

function pickNarrativeKey(name: string): string | null {
  const lower = name.toLowerCase();
  const keys = [
    "pepe", "doge", "shib", "floki", "bonk", "wif", "myro", "popcat",
    "ai", "gpt", "agent",
    "trump", "elon", "musk",
    "sol", "solana", "jupiter",
    "cat", "dog", "frog", "inu",
    "moon", "rocket",
  ];
  for (const k of keys) {
    if (lower.includes(k)) return k;
  }
  return null;
}

export function decisionToLog(
  coin: PumpCoin,
  decision: PipelineDecision,
  timestamp = Date.now(),
): PipelineLogEntry {
  return {
    mint: coin.mint,
    name: coin.name,
    symbol: coin.symbol,
    stage: decision.stage,
    reason: decision.reason,
    scores: decision.scores ?? null,
    timestamp,
  };
}

export function decisionToCandidate(
  coin: PumpCoin,
  decision: PipelineDecision,
  queuedAt = Date.now(),
): PipelineCandidate | null {
  if (decision.action !== "queue" || !decision.analysis || !decision.scores) return null;
  return {
    mint: coin.mint,
    name: coin.name,
    symbol: coin.symbol,
    imageUri: coin.imageUri,
    ageMinutes: decision.analysis.ageMinutes,
    uniqueBuyers: decision.analysis.uniqueBuyers.count,
    uniqueBuyersEstimated: decision.analysis.uniqueBuyers.estimated,
    bondingCurvePct: decision.analysis.bondingCurvePct,
    riskScore: decision.analysis.risk.riskScore,
    narrativeNote: decision.analysis.narrativeNote,
    totalScore: decision.scores.total,
    scores: decision.scores,
    reasonsNotToBuy: decision.analysis.reasonsNotToBuy,
    sizeSol: decision.sizeSol ?? 0,
    queuedAt,
    coin,
  };
}
