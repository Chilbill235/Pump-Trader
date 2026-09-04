"use client";

import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { CoinImage } from "./CoinImage";
import { CopyButton } from "./CopyButton";
import { useSettings } from "./SettingsProvider";
import { useActiveAccountId } from "./AccountsProvider";
import { SOLSCAN_TX, TOKEN_DECIMALS } from "@/lib/constants";
import { appendBotLog } from "@/lib/bot-log";
import { evaluateBankroll, loadBankrollConfig } from "@/lib/bankroll";
import {
  MIN_BUY_SOL,
  MIN_SOL_RESERVED_FOR_FEES,
  validateBuyAmount,
} from "@/lib/trade-limits";
import { shortenAddress, timeAgo } from "@/lib/format";
import {
  appendPipelineLog,
  dailyAtRiskSol,
  isStickyStage,
  lastLogByMint,
  loadCandidates,
  loadPipelineLog,
  recordPipelineSpend,
  removeCandidate,
  saveCandidates,
  upsertCandidate,
} from "@/lib/pipeline-log";
import {
  ageMinutesOf,
  bondingCurvePctOf,
  decisionToCandidate,
  decisionToLog,
  evaluateLaunchBatch,
} from "@/lib/pipeline";
import { loadPositions, upsertPositionFromFill } from "@/lib/positions";
import { loadClosedTrades } from "@/lib/stats";
import { recordMomentumSample, type CoinMomentum } from "@/lib/momentum";
import { DUMMY_USER, quoteTrade } from "@/lib/sdk";
import { simulateAndSend } from "@/lib/trade";
import { getBalanceWithFallback } from "@/lib/connection";
import { loadLearningSnapshot } from "@/lib/learning";
import type { PipelineCandidate, PipelineLogEntry, PumpCoin } from "@/lib/types";

const POLL_MS = 20_000;

function formatAge(minutes: number): string {
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function openCostByMint(accountId: string | null): Record<string, number> {
  if (!accountId) return {};
  const out: Record<string, number> = {};
  for (const p of loadPositions(accountId)) {
    out[p.mint] = Number(p.costLamports) / 1e9;
  }
  return out;
}

export function WatchView() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { settings, hydrated } = useSettings();
  const accountId = useActiveAccountId();
  const [coins, setCoins] = useState<PumpCoin[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastPoll, setLastPoll] = useState<number | null>(null);
  const [log, setLog] = useState<PipelineLogEntry[]>([]);
  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [busyMint, setBusyMint] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [receiptNote, setReceiptNote] = useState<string | null>(null);
  const [liveConfirm, setLiveConfirm] = useState<PipelineCandidate | null>(null);
  const [popping, setPopping] = useState<CoinMomentum[]>([]);
  const seenRef = useRef<Map<string, PipelineLogEntry>>(new Map());

  useEffect(() => {
    if (!accountId) {
      setLog([]);
      setCandidates([]);
      return;
    }
    const existing = loadPipelineLog(accountId);
    setLog(existing);
    seenRef.current = lastLogByMint(existing);
    setCandidates(loadCandidates(accountId));
  }, [accountId]);

  const runPipeline = useCallback(
    (list: PumpCoin[]) => {
      if (!settings.pipelineEnabled || !accountId) return;
      const now = Date.now();
      const log = loadPipelineLog(accountId);
      seenRef.current = lastLogByMint(log);
      const pending = loadCandidates(accountId);
      const pendingSol = pending.reduce((s, c) => s + c.sizeSol, 0);
      const positions = loadPositions(accountId);
      const freshPopping = recordMomentumSample(list);
      setPopping(freshPopping);
      const momentumByMint: Record<string, number> = {};
      for (const m of freshPopping) momentumByMint[m.mint] = m.score;
      const decisions = evaluateLaunchBatch(list, settings, {
        dailyAtRiskSol: dailyAtRiskSol(accountId, now) + pendingSol,
        openCostByMint: openCostByMint(accountId),
        openPositionsCount: positions.length,
        now,
        momentumByMint,
        learning: loadLearningSnapshot(accountId),
      });
      let nextLog = log;
      let nextCandidates = pending;
      const queuedMints = new Set(nextCandidates.map((c) => c.mint));

      list.forEach((coin, i) => {
        const decision = decisions[i];
        const prev = seenRef.current.get(coin.mint);
        if (prev && (prev.stage === "approved" || prev.stage === "rejected")) return;
        if (prev && prev.stage === "queued" && queuedMints.has(coin.mint)) {
          nextCandidates = nextCandidates.map((c) =>
            c.mint === coin.mint
              ? { ...c, ageMinutes: ageMinutesOf(coin, now), bondingCurvePct: bondingCurvePctOf(coin) }
              : c,
          );
          return;
        }
        if (prev && isStickyStage(prev.stage, prev.reason) && prev.stage !== "queued") return;

        const entry = decisionToLog(coin, decision, now);
        const shouldWrite =
          !prev ||
          prev.stage !== entry.stage ||
          prev.reason !== entry.reason ||
          entry.stage === "queued";
        if (shouldWrite) {
          nextLog = appendPipelineLog(accountId, entry);
          seenRef.current.set(coin.mint, entry);
        }
        if (decision.action === "queue") {
          const cand = decisionToCandidate(coin, decision, now);
          if (cand) {
            nextCandidates = upsertCandidate(accountId, cand);
            queuedMints.add(cand.mint);
            appendBotLog(accountId, {
              kind: "candidate_queued",
              mint: coin.mint,
              symbol: coin.symbol,
              sizeSol: cand.sizeSol,
              message: `queued at score ${cand.totalScore.toFixed(3)} / size ${cand.sizeSol} SOL`,
            });
          }
        } else if (shouldWrite) {
          const skipKind =
            entry.stage === "filter"
              ? "filter_skip"
              : entry.stage === "risk"
                ? "risk_skip"
                : entry.stage === "score"
                  ? "score_skip"
                  : entry.stage === "risk_limit"
                    ? "daily_limit_skip"
                    : null;
          if (skipKind) {
            appendBotLog(accountId, {
              kind: skipKind,
              mint: coin.mint,
              symbol: coin.symbol,
              message: entry.reason,
            });
          }
        }
      });
      saveCandidates(accountId, nextCandidates);
      setLog(nextLog);
      setCandidates(nextCandidates);
    },
    [settings, accountId],
  );

  const pollLaunches = useCallback(async () => {
    try {
      const res = await fetch("/api/coins?sort=created_timestamp", { cache: "no-store" });
      const json = (await res.json()) as {
        coins?: PumpCoin[];
        source?: string | null;
        error?: string;
      };
      if (!res.ok || json.error) {
        setError(json.error || `HTTP ${res.status}`);
        if (json.coins?.length) {
          setCoins(json.coins);
        }
        return;
      }
      const list = json.coins ?? [];
      setCoins(list);
      setSource(json.source ?? null);
      setError(null);
      setLastPoll(Date.now());
      runPipeline(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [runPipeline]);

  useEffect(() => {
    if (!hydrated || !accountId) return;
    void pollLaunches();
    const id = setInterval(() => void pollLaunches(), POLL_MS);
    return () => clearInterval(id);
  }, [hydrated, accountId, pollLaunches]);

  const skipped = useMemo(
    () =>
      log.filter(
        (e) =>
          e.stage === "filter" ||
          e.stage === "risk" ||
          e.stage === "narrative" ||
          e.stage === "score" ||
          e.stage === "risk_limit",
      ),
    [log],
  );

  async function paperOrLiveBuy(candidate: PipelineCandidate, paper: boolean) {
    if (!accountId) return;
    setBusyMint(candidate.mint);
    setActionError(null);
    setReceiptNote(null);
    try {
      const validated = validateBuyAmount(String(candidate.sizeSol));
      if (!validated.ok || !validated.lamports) {
        throw new Error(
          validated.error ?? `Invalid buy size ${candidate.sizeSol} SOL.`,
        );
      }
      if (Number(candidate.sizeSol) < MIN_BUY_SOL) {
        throw new Error(
          `Candidate size ${candidate.sizeSol} SOL is below pump.fun minimum ${MIN_BUY_SOL} SOL. Raise max_position_sol in Settings.`,
        );
      }
      const solLamports = validated.lamports;
      if (solLamports.lten(0)) throw new Error("Buy size is 0.");

      // Bankroll protection: stop the bot if equity / drawdown / session loss are breached.
      const cfg = loadBankrollConfig(accountId);
      if (cfg.enabled && settings.autoTrade) {
        const bankrollSol = wallet.publicKey
          ? (await getBalanceWithFallback(connection, wallet.publicKey)).lamports / 1e9
          : 0;
        const closedTrades = loadClosedTrades(accountId);
        const realizedLoss = Math.max(
          0,
          closedTrades.filter((t) => t.pnlSol < 0).reduce((s, t) => s + t.pnlSol, 0) * -1,
        );
        const result = evaluateBankroll({
          accountId,
          bankrollSol,
          positionsValueSol: 0,
          realizedLossSessionSol: realizedLoss,
          cfg,
        });
        if (result.killSwitch && result.killSwitchReason) {
          appendBotLog(accountId, { kind: "error", message: `KILL SWITCH: ${result.killSwitchReason}` });
          throw new Error(result.killSwitchReason);
        }
      }

      const preQuote = await quoteTrade({
        connection,
        mint: candidate.mint,
        user: wallet.publicKey ?? DUMMY_USER,
        side: "buy",
        solLamports,
        slippagePct: settings.slippagePct,
      });
      if (preQuote.graduated || preQuote.venue !== "bonding-curve") {
        throw new Error("Coin graduated off the curve — pipeline will not buy.");
      }

      if (paper) {
        if (wallet.publicKey) {
          const { receipt } = await simulateAndSend({
            connection,
            wallet,
            mint: candidate.mint,
            side: "buy",
            solLamports,
            slippagePct: settings.slippagePct,
            paper: true,
            preQuote,
          });
          upsertPositionFromFill({
            accountId,
            mint: candidate.mint,
            name: candidate.name,
            symbol: candidate.symbol,
            decimals: TOKEN_DECIMALS,
            side: "buy",
            tokenAmountRaw: new BN(receipt.tokenAmountRaw),
            solLamports: new BN(receipt.solLamports),
            signature: receipt.signature,
            paper: true,
          });
        } else {
          upsertPositionFromFill({
            accountId,
            mint: candidate.mint,
            name: candidate.name,
            symbol: candidate.symbol,
            decimals: TOKEN_DECIMALS,
            side: "buy",
            tokenAmountRaw: new BN(preQuote.tokenAmountRaw),
            solLamports: new BN(preQuote.solLamports),
            signature: null,
            paper: true,
          });
        }
        recordPipelineSpend(accountId, candidate.sizeSol);
        const entry: PipelineLogEntry = {
          mint: candidate.mint,
          name: candidate.name,
          symbol: candidate.symbol,
          stage: "approved",
          reason: `paper fill ${candidate.sizeSol} SOL (simulate mode)`,
          scores: candidate.scores,
          timestamp: Date.now(),
        };
        appendBotLog(accountId, {
          kind: "buy_paper",
          mint: candidate.mint,
          symbol: candidate.symbol,
          sizeSol: candidate.sizeSol,
          message: `paper fill ${candidate.sizeSol} SOL (simulate mode)`,
        });
        setLog(appendPipelineLog(accountId, entry));
        seenRef.current.set(candidate.mint, entry);
        setCandidates(removeCandidate(accountId, candidate.mint));
        setReceiptNote(`Paper fill recorded for ${candidate.symbol}. No transaction was sent.`);
        return;
      }

      if (!wallet.publicKey) {
        throw new Error("Connect a Solana wallet first. This app never asks for a private key.");
      }
      const { lamports: bal } = await getBalanceWithFallback(connection, wallet.publicKey);
      const bufferLamports = Math.round(MIN_SOL_RESERVED_FOR_FEES * 1e9);
      const need = solLamports.toNumber() + bufferLamports;
      if (bal < need) {
        const have = (bal / 1e9).toFixed(4);
        const want = (need / 1e9).toFixed(4);
        throw new Error(
          `Insufficient SOL: wallet ${have} SOL, need ~${want} SOL (size + ~${MIN_SOL_RESERVED_FOR_FEES} SOL for ATA rent + fees).`,
        );
      }
      const { receipt } = await simulateAndSend({
        connection,
        wallet,
        mint: candidate.mint,
        side: "buy",
        solLamports,
        slippagePct: settings.slippagePct,
        paper: false,
        preQuote,
      });
      upsertPositionFromFill({
        accountId,
        mint: candidate.mint,
        name: candidate.name,
        symbol: candidate.symbol,
        decimals: TOKEN_DECIMALS,
        side: "buy",
        tokenAmountRaw: new BN(receipt.tokenAmountRaw),
        solLamports: new BN(receipt.solLamports),
        signature: receipt.signature,
        paper: false,
      });
      recordPipelineSpend(accountId, candidate.sizeSol);
      const entry: PipelineLogEntry = {
        mint: candidate.mint,
        name: candidate.name,
        symbol: candidate.symbol,
        stage: "approved",
        reason: receipt.signature
          ? `live buy ${candidate.sizeSol} SOL sig ${receipt.signature}`
          : `live buy ${candidate.sizeSol} SOL`,
        scores: candidate.scores,
        timestamp: Date.now(),
      };
      appendBotLog(accountId, {
        kind: receipt.signature ? "buy_live" : "buy_paper",
        mint: candidate.mint,
        symbol: candidate.symbol,
        sizeSol: candidate.sizeSol,
        signature: receipt.signature ?? undefined,
        message: receipt.signature
          ? `live buy ${candidate.sizeSol} SOL`
          : `paper buy ${candidate.sizeSol} SOL`,
      });
      setLog(appendPipelineLog(accountId, entry));
      seenRef.current.set(candidate.mint, entry);
      setCandidates(removeCandidate(accountId, candidate.mint));
      setReceiptNote(
        receipt.signature
          ? `Confirmed on-chain. ${SOLSCAN_TX}${receipt.signature}`
          : "Live buy submitted.",
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMint(null);
      setLiveConfirm(null);
    }
  }

  function reject(candidate: PipelineCandidate) {
    if (!accountId) return;
    const entry: PipelineLogEntry = {
      mint: candidate.mint,
      name: candidate.name,
      symbol: candidate.symbol,
      stage: "rejected",
      reason: "human rejected",
      scores: candidate.scores,
      timestamp: Date.now(),
    };
    appendBotLog(accountId, {
      kind: "candidate_rejected",
      mint: candidate.mint,
      symbol: candidate.symbol,
      message: "human rejected",
    });
    setLog(appendPipelineLog(accountId, entry));
    seenRef.current.set(candidate.mint, entry);
    setCandidates(removeCandidate(accountId, candidate.mint));
  }

  function onApprove(candidate: PipelineCandidate) {
    if (settings.simulateMode || settings.autoTrade) {
      void paperOrLiveBuy(candidate, settings.simulateMode);
      return;
    }
    setLiveConfirm(candidate);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            <span className="text-gradient-cool">Watch</span>
          </h1>
          <p className="max-w-xl text-xs text-mute sm:text-sm">
            {settings.autoTrade
              ? "AUTO-TRADE ON. Pipeline auto-buys scoring candidates. Keep wallet open."
              : "MONITOR → AUDITOR → NARRATIVE → TIMING → CHECKER → you approve → EXECUTOR. Default stance is NO."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-mute">
          <span
            className={`rounded-md border px-2 py-0.5 ${
              settings.pipelineEnabled
                ? "border-neon/40 bg-neon/10 text-neon"
                : "border-line bg-ink-850 text-mute"
            }`}
          >
            {settings.pipelineEnabled ? "PIPELINE ON" : "PIPELINE OFF"}
          </span>
          <span className="rounded-md border border-line bg-ink-850 px-2 py-0.5">
            {lastPoll ? `poll ${timeAgo(lastPoll)}` : "waiting"}
          </span>
          <span className="rounded-md border border-line bg-ink-850 px-2 py-0.5">
            {coins.length} launches · <span className="text-neon">{candidates.length}</span> queued · {skipped.length} skipped
          </span>
        </div>
      </div>

      {source ? (
        <p className="truncate rounded-md border border-line bg-ink-850 px-2 py-1 font-mono text-[11px] text-mute">source: {source}</p>
      ) : null}
      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          <div className="font-medium">Launch stream error</div>
          <p className="mt-1 font-mono text-xs">{error}</p>
        </div>
      ) : null}
      {actionError ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/5 p-2 font-mono text-[11px] text-danger">
          {actionError}
        </pre>
      ) : null}
      {receiptNote ? <p className="rounded-md border border-neon/30 bg-neon/5 px-2 py-1 text-xs text-neon">{receiptNote}</p> : null}

      {popping.length > 0 ? (
        <section className="relative overflow-hidden rounded-xl border border-warn/40 bg-ink-900 p-3">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-warn/10 blur-3xl"
          />
          <div className="relative">
            <header className="mb-2 flex items-center justify-between">
              <h2 className="font-mono text-xs uppercase tracking-widest text-warn">
                Popping right now · {popping.length}
              </h2>
              <p className="font-mono text-[11px] text-mute">
                Largest mc / trade density gain in the last ~90s. Click to inspect.
              </p>
            </header>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {popping.map((m) => (
                <li
                  key={m.mint}
                  className="press flex items-center gap-2 rounded-md border border-warn/30 bg-ink-850 p-2 transition-colors hover:border-warn hover:bg-ink-800"
                >
                  <CoinImage src={m.imageUri ?? null} alt={m.symbol} size={28} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/coin/${m.mint}`}
                      className="block truncate text-sm hover:text-neon"
                    >
                      {m.name}{" "}
                      <span className="font-mono text-[11px] text-mute">{m.symbol}</span>
                    </Link>
                    <p className="font-mono text-[11px] text-mute">
                      <span className="text-warn">+{m.deltaPct.toFixed(1)}%</span> mc · {m.recentTrades} trades · score {(m.score * 100).toFixed(0)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="overflow-hidden rounded-xl border border-line bg-ink-900">
          <header className="border-b border-line-soft bg-ink-850/80 px-3 py-2 backdrop-blur">
            <h2 className="font-mono text-xs uppercase tracking-widest text-mute">
              Launch stream (newest)
            </h2>
          </header>
          {loading && coins.length === 0 ? (
            <p className="p-6 text-center text-sm text-mute">Polling newest launches…</p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line-soft overflow-auto scroll-thin">
              {coins.map((c) => {
                const age = ageMinutesOf(c);
                const pct = bondingCurvePctOf(c);
                return (
                  <li key={c.mint} className="group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-ink-850/60">
                    {c.imageUri ? (
                      <CoinImage src={c.imageUri} alt={c.symbol} size={28} className="shadow-neon-sm" />
                    ) : (
                      <div className="h-7 w-7 rounded bg-ink-700" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">
                        {c.name}{" "}
                        <span className="font-mono text-[11px] text-mute">${c.symbol}</span>
                      </div>
                      <div className="font-mono text-[11px] text-mute">
                        {formatAge(age)} · curve <span className="text-neon">{pct.toFixed(1)}%</span>
                        {c.complete ? " · graduated" : ""}
                      </div>
                    </div>
                    <Link
                      href={`/coin/${c.mint}`}
                      className="press rounded-md border border-line bg-ink-850 px-2 py-1 font-mono text-[11px] text-mute opacity-0 transition-colors group-hover:border-neon group-hover:text-neon group-hover:opacity-100 sm:opacity-100"
                    >
                      open
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <header>
            <h2 className="font-mono text-xs uppercase tracking-widest text-mute">
              Candidates — <span className="text-warn">human approval required</span>
            </h2>
            <p className="text-[11px] text-mute">
              Checker speaks first. Score clearing the bar is not a buy signal.
            </p>
          </header>
          {candidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-ink-850 p-6 text-center text-sm text-mute">
              No candidates. The watcher is skipping until something clears the filter and the
              score bar — and even then you have to approve.
            </div>
          ) : (
            candidates.map((c) => (
              <CandidateCard
                key={c.mint}
                candidate={c}
                busy={busyMint === c.mint}
                simulate={settings.simulateMode}
                onApprove={() => onApprove(c)}
                onReject={() => reject(c)}
              />
            ))
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-line bg-ink-900">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 font-mono text-xs uppercase tracking-widest text-mute transition-colors hover:bg-ink-850"
          onClick={() => setSkippedOpen((v) => !v)}
        >
          <span>Skipped ({skipped.length})</span>
          <span className="rounded border border-line bg-ink-850 px-1.5 py-0.5 text-mute">{skippedOpen ? "hide" : "show"}</span>
        </button>
        {skippedOpen ? (
          <ul className="max-h-72 divide-y divide-line-soft overflow-auto scroll-thin border-t border-line-soft">
            {skipped.slice(0, 80).map((e, i) => (
              <li key={`${e.mint}-${e.timestamp}-${i}`} className="px-3 py-2 text-xs">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{e.name}</span>
                  <span className="font-mono text-mute">${e.symbol}</span>
                  <span className="rounded-md border border-warn/30 bg-warn/5 px-1.5 py-0.5 font-mono text-[10px] uppercase text-warn">
                    {e.stage}
                  </span>
                  <span className="font-mono text-[10px] text-mute">{timeAgo(e.timestamp)}</span>
                </div>
                <p className="mt-0.5 text-mute">{e.reason}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <ConfirmDialog
        open={liveConfirm != null}
        title="Confirm LIVE curve buy"
        danger
        busy={busyMint != null}
        confirmLabel="Buy on mainnet"
        onCancel={() => setLiveConfirm(null)}
        onConfirm={() => {
          if (liveConfirm) void paperOrLiveBuy(liveConfirm, false);
        }}
        body={
          liveConfirm ? (
            <div className="space-y-2 font-mono text-xs">
              <p>
                Simulate is OFF. This spends real SOL on Solana mainnet. Simulation still runs
                first; the wallet must sign. This app never asks for a private key.
              </p>
              <p>
                BUY {liveConfirm.symbol} for {liveConfirm.sizeSol} SOL @ slippage{" "}
                {settings.slippagePct}%
              </p>
              <p>Mint {liveConfirm.mint}</p>
              <p>Checker still says no — you are overriding the default skip.</p>
            </div>
          ) : null
        }
      />
    </div>
  );
}

function CandidateCard(props: {
  candidate: PipelineCandidate;
  busy: boolean;
  simulate: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const c = props.candidate;
  const reasons = c.reasonsNotToBuy.length
    ? c.reasonsNotToBuy
    : ["Most pump.fun coins go to zero. Default stance is NO."];
  return (
    <article className="rounded border border-warn/30 bg-ink-800 p-3">
      <div className="flex items-start gap-3">
        {c.imageUri ? (
          <CoinImage src={c.imageUri} alt={c.symbol} size={40} />
        ) : (
          <div className="h-10 w-10 rounded bg-ink-700" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/coin/${c.mint}`} className="font-medium hover:text-neon">
              {c.name}
            </Link>
            <span className="font-mono text-xs text-mute">{c.symbol}</span>
            <CopyButton value={c.mint} label={shortenAddress(c.mint, 4, 4)} />
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] sm:grid-cols-3">
            <div>
              <dt className="text-mute">Age</dt>
              <dd>{formatAge(c.ageMinutes)}</dd>
            </div>
            <div>
              <dt className="text-mute">Unique buyers</dt>
              <dd>
                {c.uniqueBuyers}
                {c.uniqueBuyersEstimated ? " est." : ""}
              </dd>
            </div>
            <div>
              <dt className="text-mute">Curve</dt>
              <dd>{c.bondingCurvePct.toFixed(1)}%</dd>
            </div>
            <div>
              <dt className="text-mute">Risk</dt>
              <dd className="text-warn">{c.riskScore}/10</dd>
            </div>
            <div>
              <dt className="text-mute">Score</dt>
              <dd className="text-neon">{c.totalScore.toFixed(3)}</dd>
            </div>
            <div>
              <dt className="text-mute">Size</dt>
              <dd>{c.sizeSol} SOL</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-3 rounded border border-danger/30 bg-danger/5 p-2">
        <p className="font-mono text-[11px] uppercase tracking-wide text-danger">
          Why I would skip
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-mute">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="mt-2 font-mono text-[11px] text-neon">
          Score cleared the bar ({c.totalScore.toFixed(3)}). That is not permission to buy.
        </p>
        <p className="mt-1 text-[11px] text-mute">{c.narrativeNote}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={props.busy}
          onClick={props.onApprove}
          className="press inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-neon/40 bg-gradient-to-r from-neon to-emerald-400 px-3 py-2.5 font-mono text-xs font-semibold text-ink-950 shadow-[0_0_12px_-4px_rgba(57,255,136,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon disabled:opacity-40 sm:flex-none"
        >
          {props.busy ? "Working…" : props.simulate ? "Approve paper" : "Approve live…"}
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={props.onReject}
          className="press inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-line bg-ink-850 px-3 py-2.5 font-mono text-xs text-mute hover:border-danger hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-40 sm:flex-none"
        >
          Reject
        </button>
      </div>
    </article>
  );
}
