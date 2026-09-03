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

const KEY = "pump-trader:bot-log:v1";

function safeRead(): BotLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BotLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(list: BotLogEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, 500)));
  } catch {
    // ignore quota
  }
}

export function loadBotLog(): BotLogEntry[] {
  return safeRead();
}

export function appendBotLog(entry: Omit<BotLogEntry, "id" | "ts">): BotLogEntry[] {
  const next: BotLogEntry[] = [
    {
      ...entry,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
    },
    ...safeRead(),
  ];
  safeWrite(next);
  return next;
}

export function clearBotLog(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
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