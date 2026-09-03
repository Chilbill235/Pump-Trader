import {
  PIPELINE_CANDIDATES_KEY,
  PIPELINE_DAILY_KEY,
  PIPELINE_LOG_KEY,
} from "./constants";
import { safeReadScoped, safeWriteScoped } from "./accounts";
import type { PipelineCandidate, PipelineLogEntry, PipelineStage } from "./types";

const LOG_CAP = 400;
const CANDIDATE_CAP = 40;

export type DailyRiskState = {
  date: string;
  realizedLossSol: number;
  spentSol: number;
};

function nyDate(now = Date.now()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

export function loadPipelineLog(accountId: string | null): PipelineLogEntry[] {
  const parsed = safeReadScoped<PipelineLogEntry[]>(accountId, PIPELINE_LOG_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function savePipelineLog(accountId: string | null, entries: PipelineLogEntry[]): void {
  if (!accountId) return;
  safeWriteScoped(accountId, PIPELINE_LOG_KEY, entries.slice(0, LOG_CAP));
}

export function appendPipelineLog(
  accountId: string | null,
  entry: PipelineLogEntry,
): PipelineLogEntry[] {
  if (!accountId) return [];
  const prev = loadPipelineLog(accountId);
  const last = prev.find((e) => e.mint === entry.mint);
  if (
    last &&
    last.stage === entry.stage &&
    last.reason === entry.reason &&
    entry.stage !== "approved" &&
    entry.stage !== "rejected" &&
    entry.stage !== "queued"
  ) {
    return prev;
  }
  const next = [entry, ...prev].slice(0, LOG_CAP);
  savePipelineLog(accountId, next);
  return next;
}

export function lastLogByMint(log: PipelineLogEntry[]): Map<string, PipelineLogEntry> {
  const map = new Map<string, PipelineLogEntry>();
  for (const e of log) {
    if (!map.has(e.mint)) map.set(e.mint, e);
  }
  return map;
}

export function loadCandidates(accountId: string | null): PipelineCandidate[] {
  const parsed = safeReadScoped<PipelineCandidate[]>(accountId, PIPELINE_CANDIDATES_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveCandidates(accountId: string | null, list: PipelineCandidate[]): void {
  if (!accountId) return;
  safeWriteScoped(accountId, PIPELINE_CANDIDATES_KEY, list.slice(0, CANDIDATE_CAP));
}

export function upsertCandidate(
  accountId: string | null,
  candidate: PipelineCandidate,
): PipelineCandidate[] {
  if (!accountId) return [];
  const list = loadCandidates(accountId).filter((c) => c.mint !== candidate.mint);
  const next = [candidate, ...list].slice(0, CANDIDATE_CAP);
  saveCandidates(accountId, next);
  return next;
}

export function removeCandidate(accountId: string | null, mint: string): PipelineCandidate[] {
  if (!accountId) return [];
  const next = loadCandidates(accountId).filter((c) => c.mint !== mint);
  saveCandidates(accountId, next);
  return next;
}

export function loadDailyRisk(accountId: string | null, now = Date.now()): DailyRiskState {
  const today = nyDate(now);
  const parsed = safeReadScoped<DailyRiskState | null>(accountId, PIPELINE_DAILY_KEY, null);
  if (!parsed || parsed.date !== today) {
    const fresh: DailyRiskState = { date: today, realizedLossSol: 0, spentSol: 0 };
    safeWriteScoped(accountId, PIPELINE_DAILY_KEY, fresh);
    return fresh;
  }
  return {
    date: today,
    realizedLossSol: Number(parsed.realizedLossSol) || 0,
    spentSol: Number(parsed.spentSol) || 0,
  };
}

export function recordPipelineSpend(
  accountId: string | null,
  sol: number,
  now = Date.now(),
): DailyRiskState {
  if (!accountId) return { date: nyDate(now), realizedLossSol: 0, spentSol: 0 };
  const cur = loadDailyRisk(accountId, now);
  const next: DailyRiskState = {
    ...cur,
    spentSol: cur.spentSol + Math.max(0, sol),
  };
  safeWriteScoped(accountId, PIPELINE_DAILY_KEY, next);
  return next;
}

export function recordPipelineLoss(
  accountId: string | null,
  sol: number,
  now = Date.now(),
): DailyRiskState {
  if (!accountId) return { date: nyDate(now), realizedLossSol: 0, spentSol: 0 };
  const cur = loadDailyRisk(accountId, now);
  const next: DailyRiskState = {
    ...cur,
    realizedLossSol: cur.realizedLossSol + Math.max(0, sol),
  };
  safeWriteScoped(accountId, PIPELINE_DAILY_KEY, next);
  return next;
}

export function dailyAtRiskSol(accountId: string | null, now = Date.now()): number {
  const d = loadDailyRisk(accountId, now);
  return d.realizedLossSol + d.spentSol;
}

const STICKY: PipelineStage[] = [
  "risk",
  "narrative",
  "score",
  "risk_limit",
  "queued",
  "approved",
  "rejected",
];

export function isStickyStage(stage: PipelineStage, reason: string): boolean {
  if (stage === "filter" && /age .+m ≤/.test(reason)) return false;
  if (stage === "filter" && reason.includes("empty/thin curve") && reason.includes("estimated")) {
    return false;
  }
  if (stage === "queued" || stage === "approved" || stage === "rejected") return true;
  return STICKY.includes(stage);
}