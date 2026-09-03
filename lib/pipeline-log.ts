import {
  PIPELINE_CANDIDATES_KEY,
  PIPELINE_DAILY_KEY,
  PIPELINE_LOG_KEY,
} from "./constants";
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

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function loadPipelineLog(): PipelineLogEntry[] {
  const parsed = readJson<PipelineLogEntry[]>(PIPELINE_LOG_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function savePipelineLog(entries: PipelineLogEntry[]): void {
  writeJson(PIPELINE_LOG_KEY, entries.slice(0, LOG_CAP));
}

export function appendPipelineLog(entry: PipelineLogEntry): PipelineLogEntry[] {
  const prev = loadPipelineLog();
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
  savePipelineLog(next);
  return next;
}

export function lastLogByMint(log: PipelineLogEntry[]): Map<string, PipelineLogEntry> {
  const map = new Map<string, PipelineLogEntry>();
  for (const e of log) {
    if (!map.has(e.mint)) map.set(e.mint, e);
  }
  return map;
}

export function loadCandidates(): PipelineCandidate[] {
  const parsed = readJson<PipelineCandidate[]>(PIPELINE_CANDIDATES_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveCandidates(list: PipelineCandidate[]): void {
  writeJson(PIPELINE_CANDIDATES_KEY, list.slice(0, CANDIDATE_CAP));
}

export function upsertCandidate(candidate: PipelineCandidate): PipelineCandidate[] {
  const list = loadCandidates().filter((c) => c.mint !== candidate.mint);
  const next = [candidate, ...list].slice(0, CANDIDATE_CAP);
  saveCandidates(next);
  return next;
}

export function removeCandidate(mint: string): PipelineCandidate[] {
  const next = loadCandidates().filter((c) => c.mint !== mint);
  saveCandidates(next);
  return next;
}

export function loadDailyRisk(now = Date.now()): DailyRiskState {
  const today = nyDate(now);
  const parsed = readJson<DailyRiskState | null>(PIPELINE_DAILY_KEY, null);
  if (!parsed || parsed.date !== today) {
    const fresh: DailyRiskState = { date: today, realizedLossSol: 0, spentSol: 0 };
    writeJson(PIPELINE_DAILY_KEY, fresh);
    return fresh;
  }
  return {
    date: today,
    realizedLossSol: Number(parsed.realizedLossSol) || 0,
    spentSol: Number(parsed.spentSol) || 0,
  };
}

export function recordPipelineSpend(sol: number, now = Date.now()): DailyRiskState {
  const cur = loadDailyRisk(now);
  const next: DailyRiskState = {
    ...cur,
    spentSol: cur.spentSol + Math.max(0, sol),
  };
  writeJson(PIPELINE_DAILY_KEY, next);
  return next;
}

export function recordPipelineLoss(sol: number, now = Date.now()): DailyRiskState {
  const cur = loadDailyRisk(now);
  const next: DailyRiskState = {
    ...cur,
    realizedLossSol: cur.realizedLossSol + Math.max(0, sol),
  };
  writeJson(PIPELINE_DAILY_KEY, next);
  return next;
}

export function dailyAtRiskSol(now = Date.now()): number {
  const d = loadDailyRisk(now);
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

/** Age-filter skips should be retried; later-stage decisions stick. */
export function isStickyStage(stage: PipelineStage, reason: string): boolean {
  if (stage === "filter" && /age .+m ≤/.test(reason)) return false;
  if (stage === "filter" && reason.includes("empty/thin curve") && reason.includes("estimated")) {
    // curve may fill — retry
    return false;
  }
  if (stage === "queued" || stage === "approved" || stage === "rejected") return true;
  return STICKY.includes(stage);
}
