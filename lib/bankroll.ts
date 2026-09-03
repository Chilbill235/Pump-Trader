import {
  appendBotLog,
  type BotLogKind,
} from "./bot-log";
import { getStartBankroll, updatePeakEquity, getPeakEquity } from "./stats";

export type BankrollConfig = {
  enabled: boolean;
  equityFloorSol: number; // hard floor; stop bot when equity drops below
  drawdownPct: number; // 0.10 = 10% from peak → stop
  maxLossPerSessionSol: number; // stop after losing this much realized in current session
};

export const DEFAULT_BANKROLL_CONFIG: BankrollConfig = {
  enabled: true,
  equityFloorSol: 0.05,
  drawdownPct: 0.25,
  maxLossPerSessionSol: 0.5,
};

const KEY = "pump-trader:bankroll-config:v1";

export function loadBankrollConfig(): BankrollConfig {
  if (typeof window === "undefined") return DEFAULT_BANKROLL_CONFIG;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_BANKROLL_CONFIG;
    return { ...DEFAULT_BANKROLL_CONFIG, ...(JSON.parse(raw) as Partial<BankrollConfig>) };
  } catch {
    return DEFAULT_BANKROLL_CONFIG;
  }
}

export function saveBankrollConfig(cfg: BankrollConfig) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

export type BankrollCheck = {
  ok: boolean;
  reasons: string[];
  killSwitch: boolean;
  killSwitchReason: string | null;
};

export function evaluateBankroll(args: {
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
    const peak = getPeakEquity();
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

export function noteEquityForStats(equitySol: number): void {
  updatePeakEquity(equitySol);
}

export function startBankrollTrackingIfNeeded(currentSol: number): void {
  const start = getStartBankroll();
  if (start <= 0) {
    try {
      window.localStorage.setItem("pump-trader:start-bankroll:v1", JSON.stringify(currentSol));
    } catch {
      // ignore
    }
  }
}

export function tripKillSwitchFromBot(cfg: BankrollConfig, args: {
  bankrollSol: number;
  positionsValueSol: number;
  realizedLossSessionSol: number;
}, stopFn: () => void) {
  const result = evaluateBankroll({ ...args, cfg });
  if (result.killSwitch && result.killSwitchReason) {
    appendBotLog({ kind: "error", message: `KILL SWITCH: ${result.killSwitchReason}` } as unknown as {
      kind: BotLogKind;
      message: string;
    });
    stopFn();
  }
}