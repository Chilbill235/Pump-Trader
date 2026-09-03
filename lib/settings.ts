import {
  DEFAULT_DAILY_LOSS_LIMIT,
  DEFAULT_MAX_BONDING_CURVE_PCT,
  DEFAULT_MAX_OPEN_POSITIONS,
  DEFAULT_MAX_POSITION_SOL,
  DEFAULT_MIN_AGE_MINUTES,
  DEFAULT_MIN_SCORE,
  DEFAULT_MIN_UNIQUE_BUYERS,
  DEFAULT_RPC,
  DEFAULT_SLIPPAGE_PCT,
  SETTINGS_KEY,
} from "./constants";
import { safeReadScoped, safeWriteScoped } from "./accounts";

export type AppSettings = {
  rpcUrl: string;
  slippagePct: number;
  simulateMode: boolean;
  autoSell: boolean;
  autoTrade: boolean;
  pipelineEnabled: boolean;
  minScore: number;
  maxPositionSol: number;
  maxOpenPositions: number;
  dailyLossLimit: number;
  minUniqueBuyers: number;
  maxBondingCurvePct: number;
  minAgeMinutes: number;
  requireMetadata: boolean;
  takeProfitPct: number;
  stopLossPct: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  rpcUrl: DEFAULT_RPC,
  slippagePct: DEFAULT_SLIPPAGE_PCT,
  simulateMode: true,
  autoSell: false,
  autoTrade: false,
  pipelineEnabled: true,
  minScore: DEFAULT_MIN_SCORE,
  maxPositionSol: DEFAULT_MAX_POSITION_SOL,
  maxOpenPositions: DEFAULT_MAX_OPEN_POSITIONS,
  dailyLossLimit: DEFAULT_DAILY_LOSS_LIMIT,
  minUniqueBuyers: DEFAULT_MIN_UNIQUE_BUYERS,
  maxBondingCurvePct: DEFAULT_MAX_BONDING_CURVE_PCT,
  minAgeMinutes: DEFAULT_MIN_AGE_MINUTES,
  requireMetadata: true,
  takeProfitPct: 20,
  stopLossPct: 15,
};

export function isPublicRpc(url: string): boolean {
  return /api\.mainnet-beta\.solana\.com/i.test(url);
}

function numInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min || value > max) return fallback;
  return value;
}

export function loadSettings(accountId: string | null): AppSettings {
  if (typeof window === "undefined" || !accountId) return DEFAULT_SETTINGS;
  try {
    const parsed = safeReadScoped<Partial<AppSettings>>(accountId, SETTINGS_KEY, {});
    const slippage = numInRange(parsed.slippagePct, DEFAULT_SLIPPAGE_PCT, 0.1, 50);
    return {
      rpcUrl:
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
        (typeof parsed.rpcUrl === "string" && parsed.rpcUrl.trim()
          ? parsed.rpcUrl.trim()
          : DEFAULT_RPC),
      slippagePct: slippage,
      simulateMode:
        typeof parsed.simulateMode === "boolean" ? parsed.simulateMode : true,
      autoSell: parsed.autoSell === true,
      autoTrade: parsed.autoTrade === true,
      pipelineEnabled:
        typeof parsed.pipelineEnabled === "boolean"
          ? parsed.pipelineEnabled
          : true,
      minScore: numInRange(parsed.minScore, DEFAULT_MIN_SCORE, 0, 1),
      maxPositionSol: numInRange(
        parsed.maxPositionSol,
        DEFAULT_MAX_POSITION_SOL,
        0.001,
        100,
      ),
      maxOpenPositions: Math.round(
        numInRange(
          parsed.maxOpenPositions,
          DEFAULT_MAX_OPEN_POSITIONS,
          1,
          100,
        ),
      ),
      dailyLossLimit: numInRange(
        parsed.dailyLossLimit,
        DEFAULT_DAILY_LOSS_LIMIT,
        0,
        1000,
      ),
      minUniqueBuyers: Math.round(
        numInRange(parsed.minUniqueBuyers, DEFAULT_MIN_UNIQUE_BUYERS, 0, 1000),
      ),
      maxBondingCurvePct: numInRange(
        parsed.maxBondingCurvePct,
        DEFAULT_MAX_BONDING_CURVE_PCT,
        0,
        100,
      ),
      minAgeMinutes: numInRange(
        parsed.minAgeMinutes,
        DEFAULT_MIN_AGE_MINUTES,
        0,
        24 * 60,
      ),
      requireMetadata:
        typeof parsed.requireMetadata === "boolean"
          ? parsed.requireMetadata
          : true,
      takeProfitPct: numInRange(parsed.takeProfitPct, 20, 1, 1000),
      stopLossPct: numInRange(parsed.stopLossPct, 15, 1, 99),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(accountId: string | null, next: AppSettings): void {
  if (typeof window === "undefined" || !accountId) return;
  safeWriteScoped(accountId, SETTINGS_KEY, next);
}