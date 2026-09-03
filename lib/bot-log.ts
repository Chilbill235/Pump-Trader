import { BOT_LOG_KEY } from "./constants";
import { safeReadScoped, safeWriteScoped } from "./accounts";

export type BotLogKind =
  | "start"
  | "stop"
  | "candidate_queued"
  | "candidate_rejected"
  | "buy_paper"
  | "buy_live"
  | "sell_paper"
  | "sell_live"
  | "tp_hit"
  | "sl_hit"
  | "auto_sell_paper"
  | "auto_sell_live"
  | "filter_skip"
  | "risk_skip"
  | "score_skip"
  | "daily_limit_skip"
  | "error";

export type BotLogEntry = {
  id: string;
  ts: number;
  kind: BotLogKind;
  mint?: string;
  symbol?: string;
  sizeSol?: number;
  pnlPct?: number;
  signature?: string;
  message: string;
  simulate?: boolean;
};

function safeRead(accountId: string | null): BotLogEntry[] {
  if (typeof window === "undefined" || !accountId) return [];
  return safeReadScoped<BotLogEntry[]>(accountId, BOT_LOG_KEY, []);
}

function safeWrite(accountId: string | null, list: BotLogEntry[]) {
  if (typeof window === "undefined" || !accountId) return;
  safeWriteScoped(accountId, BOT_LOG_KEY, list.slice(0, 500));
}

export function loadBotLog(accountId: string | null): BotLogEntry[] {
  return safeRead(accountId);
}

export function appendBotLog(
  accountId: string | null,
  entry: Omit<BotLogEntry, "id" | "ts">,
): BotLogEntry[] {
  if (!accountId) return [];
  const next: BotLogEntry[] = [
    {
      ...entry,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
    },
    ...safeRead(accountId),
  ];
  safeWrite(accountId, next);
  return next;
}

export function clearBotLog(accountId: string | null): void {
  if (typeof window === "undefined" || !accountId) return;
  safeWriteScoped(accountId, BOT_LOG_KEY, []);
}

export function botLogKindLabel(kind: BotLogKind): { label: string; tone: "ok" | "warn" | "danger" | "mute" } {
  switch (kind) {
    case "start":
      return { label: "BOT START", tone: "ok" };
    case "stop":
      return { label: "BOT STOP", tone: "danger" };
    case "candidate_queued":
      return { label: "CANDIDATE", tone: "ok" };
    case "candidate_rejected":
      return { label: "REJECTED", tone: "warn" };
    case "buy_paper":
      return { label: "PAPER BUY", tone: "ok" };
    case "buy_live":
      return { label: "LIVE BUY", tone: "ok" };
    case "sell_paper":
      return { label: "PAPER SELL", tone: "ok" };
    case "sell_live":
      return { label: "LIVE SELL", tone: "ok" };
    case "tp_hit":
      return { label: "TAKE-PROFIT", tone: "ok" };
    case "sl_hit":
      return { label: "STOP-LOSS", tone: "danger" };
    case "auto_sell_paper":
      return { label: "AUTO SELL (PAPER)", tone: "ok" };
    case "auto_sell_live":
      return { label: "AUTO SELL (LIVE)", tone: "ok" };
    case "filter_skip":
      return { label: "FILTERED", tone: "mute" };
    case "risk_skip":
      return { label: "RISK SKIP", tone: "warn" };
    case "score_skip":
      return { label: "SCORE SKIP", tone: "warn" };
    case "daily_limit_skip":
      return { label: "DAILY LIMIT", tone: "danger" };
    case "error":
      return { label: "ERROR", tone: "danger" };
  }
}