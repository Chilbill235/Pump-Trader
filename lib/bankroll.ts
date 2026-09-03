import { BANKROLL_KEY } from "./constants";
import { safeReadScoped, safeWriteScoped } from "./accounts";
import { getPeakEquity, updatePeakEquity, getStartBankroll } from "./stats";

export type BankrollConfig = {
  enabled: boolean;
  equityFloorSol: number;
  drawdownPct: number;
  maxLossPerSessionSol: number;
};

export const DEFAULT_BANKROLL_CONFIG: BankrollConfig = {
  enabled: true,
  equityFloorSol: 0.05,
  drawdownPct: 0.25,
  maxLossPerSessionSol: 0.5,
};

export function loadBankrollConfig(accountId: string | null): BankrollConfig {
  if (typeof window === "undefined" || !accountId) return DEFAULT_BANKROLL_CONFIG;
  try {
    const parsed = safeReadScoped<Partial<BankrollConfig>>(accountId, BANKROLL_KEY, {});
    return { ...DEFAULT_BANKROLL_CONFIG, ...parsed };
  } catch {
    return DEFAULT_BANKROLL_CONFIG;
  }
}

export function saveBankrollConfig(accountId: string | null, cfg: BankrollConfig) {
  if (typeof window === "undefined" || !accountId) return;
  safeWriteScoped(accountId, BANKROLL_KEY, cfg);
}

export type BankrollCheck = {
  ok: boolean;
  reasons: string[];
  killSwitch: boolean;
  killSwitchReason: string | null;
};

export function evaluateBankroll(args: {
  accountId: string | null;
  bankrollSol: number;
  positionsValueSol: number;
  realizedLossSessionSol: number;
  cfg: BankrollConfig;
}): BankrollCheck {
  const reasons: string[] = [];
  let killSwitch = false;
  let killSwitchReason: string | null = null;
  const equity = args.bankrollSol + args.positionsValueSol;
  if (args.cfg.enabled) {
    if (equity < args.cfg.equityFloorSol) {
      killSwitch = true;
      killSwitchReason = `Equity floor ${args.cfg.equityFloorSol.toFixed(3)} SOL breached (current ${equity.toFixed(4)} SOL). Bot stopped.`;
      reasons.push(killSwitchReason);
    }
    const peak = getPeakEquity(args.accountId);
    if (peak > 0) {
      const dd = (peak - equity) / peak;
      if (dd >= args.cfg.drawdownPct) {
        killSwitch = true;
        killSwitchReason = `Drawdown ${(dd * 100).toFixed(1)}% exceeded limit (${(args.cfg.drawdownPct * 100).toFixed(0)}%). Bot stopped.`;
        reasons.push(killSwitchReason);
      }
    }
    if (args.realizedLossSessionSol >= args.cfg.maxLossPerSessionSol) {
      killSwitch = true;
      killSwitchReason = `Session loss ${args.realizedLossSessionSol.toFixed(3)} SOL exceeded limit ${args.cfg.maxLossPerSessionSol} SOL. Bot stopped.`;
      reasons.push(killSwitchReason);
    }
  }
  return { ok: !killSwitch, reasons, killSwitch, killSwitchReason };
}

export function noteEquityForStats(accountId: string | null, equitySol: number): void {
  updatePeakEquity(accountId, equitySol);
}

export function startBankrollTrackingIfNeeded(accountId: string | null, currentSol: number): void {
  if (!accountId) return;
  const start = getStartBankroll(accountId);
  if (start <= 0) {
    safeWriteScoped(accountId, "start-bankroll:v1", currentSol);
  }
}