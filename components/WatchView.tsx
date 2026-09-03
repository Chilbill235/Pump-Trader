"use client";

import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { CoinImage } from "./CoinImage";
import { CopyButton } from "./CopyButton";
import { useSettings } from "./SettingsProvider";
import { SOLSCAN_TX, TOKEN_DECIMALS } from "@/lib/constants";
import { appendBotLog } from "@/lib/bot-log";
import { evaluateBankroll, loadBankrollConfig } from "@/lib/bankroll";
import {
  MIN_BUY_SOL,
  MIN_SOL_RESERVED_FOR_FEES,
  validateBuyAmount,
} from "@/lib/trade-limits";
import { shortenAddress, solToLamports, timeAgo } from "@/lib/format";
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
import { DUMMY_USER, quoteTrade } from "@/lib/sdk";
import { simulateAndSend } from "@/lib/trade";
import type { PipelineCandidate, PipelineLogEntry, PumpCoin } from "@/lib/types";

const POLL_MS = 20_000;

function formatAge(minutes: number): string {
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function openCostByMint(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of loadPositions()) {
    out[p.mint] = Number(p.costLamports) / 1e9;
  }
  return out;
}

export function WatchView() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { settings, hydrated } = useSettings();
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
  const seenRef = useRef<Map<string, PipelineLogEntry>>(new Map());

  useEffect(() => {
    const existing = loadPipelineLog();
    setLog(existing);
    seenRef.current = lastLogByMint(existing);
    setCandidates(loadCandidates());
  }, []);

  const runPipeline = useCallback(
    (list: PumpCoin[]) => {
      if (!settings.pipelineEnabled) return;
      const now = Date.now();
      const log = loadPipelineLog();
      seenRef.current = lastLogByMint(log);
      const pending = loadCandidates();
      const pendingSol = pending.reduce((s, c) => s + c.sizeSol, 0);
      const positions = loadPositions();
      const decisions = evaluateLaunchBatch(list, settings, {
        dailyAtRiskSol: dailyAtRiskSol(now) + pendingSol,
        openCostByMint: openCostByMint(),
        openPositionsCount: positions.length,
        now,
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
          nextLog = appendPipelineLog(entry);
          seenRef.current.set(coin.mint, entry);
        }
        if (decision.action === "queue") {
          const cand = decisionToCandidate(coin, decision, now);
          if (cand) {
            nextCandidates = upsertCandidate(cand);
            queuedMints.add(cand.mint);
            appendBotLog({
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
            appendBotLog({
              kind: skipKind,
              mint: coin.mint,
              symbol: coin.symbol,
              message: entry.reason,
            });
          }
        }
      });
      saveCandidates(nextCandidates);
      setLog(nextLog);
      setCandidates(nextCandidates);
    },
    [settings],
  );

  const poll = useCallback(async () => {
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
    if (!hydrated) return;
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [hydrated, poll]);

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
      const cfg = loadBankrollConfig();
      if (cfg.enabled && settings.autoTrade) {
        const bankrollSol = wallet.publicKey
          ? (await connection.getBalance(wallet.publicKey, "confirmed")) / 1e9
          : 0;
        const closedTrades = (() => {
          try {
            const raw = window.localStorage.getItem("pump-trader:closed-trades:v1");
            return raw ? (JSON.parse(raw) as { pnlSol: number }[]) : [];
          } catch {
            return [];
          }
        })();
        const realizedLoss = Math.max(
          0,
          closedTrades.filter((t) => t.pnlSol < 0).reduce((s, t) => s + t.pnlSol, 0) * -1,
        );
        const result = evaluateBankroll({
          bankrollSol,
          positionsValueSol: 0,
          realizedLossSessionSol: realizedLoss,
          cfg,
        });
        if (result.killSwitch && result.killSwitchReason) {
          appendBotLog({ kind: "error", message: `KILL SWITCH: ${result.killSwitchReason}` });
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
        recordPipelineSpend(candidate.sizeSol);
        const entry: PipelineLogEntry = {
          mint: candidate.mint,
          name: candidate.name,
          symbol: candidate.symbol,
          stage: "approved",
          reason: `paper fill ${candidate.sizeSol} SOL (simulate mode)`,
          scores: candidate.scores,
          timestamp: Date.now(),
        };
        appendBotLog({
          kind: "buy_paper",
          mint: candidate.mint,
          symbol: candidate.symbol,
          sizeSol: candidate.sizeSol,
          message: `paper fill ${candidate.sizeSol} SOL (simulate mode)`,
        });
        setLog(appendPipelineLog(entry));
        seenRef.current.set(candidate.mint, entry);
        setCandidates(removeCandidate(candidate.mint));
        setReceiptNote(`Paper fill recorded for ${candidate.symbol}. No transaction was sent.`);
        return;
      }

      if (!wallet.publicKey) {
        throw new Error("Connect a Solana wallet first. This app never asks for a private key.");
      }
      const bal = await connection.getBalance(wallet.publicKey, "confirmed");
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
      recordPipelineSpend(candidate.sizeSol);
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
      appendBotLog({
        kind: receipt.signature ? "buy_live" : "buy_paper",
        mint: candidate.mint,
        symbol: candidate.symbol,
        sizeSol: candidate.sizeSol,
        signature: receipt.signature ?? undefined,
        message: receipt.signature
          ? `live buy ${candidate.sizeSol} SOL`
          : `paper buy ${candidate.sizeSol} SOL`,
      });
      setLog(appendPipelineLog(entry));
      seenRef.current.set(candidate.mint, entry);
      setCandidates(removeCandidate(candidate.mint));
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
    const entry: PipelineLogEntry = {
      mint: candidate.mint,
      name: candidate.name,
      symbol: candidate.symbol,
      stage: "rejected",
      reason: "human rejected",
      scores: candidate.scores,
      timestamp: Date.now(),
    };
    appendBotLog({
      kind: "candidate_rejected",
      mint: candidate.mint,
      symbol: candidate.symbol,
      message: "human rejected",
    });
    setLog(appendPipelineLog(entry));
    seenRef.current.set(candidate.mint, entry);
    setCandidates(removeCandidate(candidate.mint));
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
          <h1 className="font-mono text-lg tracking-wide">Watch</h1>
          <p className="text-xs text-mute">
            {settings.autoTrade
              ? "AUTO-TRADE ON. Pipeline auto-buys scoring candidates. Keep wallet open."
              : "MONITOR → AUDITOR → NARRATIVE → TIMING → CHECKER → you approve → EXECUTOR. Default stance is NO."}
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-mute">
          <span
            className={`rounded border px-2 py-0.5 ${
              settings.pipelineEnabled
                ? "border-neon/40 text-neon"
                : "border-line text-mute"
            }`}
          >
            {settings.pipelineEnabled ? "PIPELINE ON" : "PIPELINE OFF"}
          </span>
          <span>{lastPoll ? `poll ${timeAgo(lastPoll)}` : "waiting"}</span>
          <span>
            {coins.length} launches · {candidates.length} queued · {skipped.length} skipped
          </span>
        </div>
      </div>

      {source ? (
        <p className="truncate font-mono text-[11px] text-mute">source: {source}</p>
      ) : null}
      {error ? (
        <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <div className="font-medium">Launch stream error</div>
          <p className="mt-1 font-mono text-xs">{error}</p>
        </div>
      ) : null}
      {actionError ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-danger/10 p-2 font-mono text-[11px] text-danger">
          {actionError}
        </pre>
      ) : null}
      {receiptNote ? <p className="text-xs text-neon">{receiptNote}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded border border-line bg-ink-800">
          <header className="border-b border-line px-3 py-2">
            <h2 className="font-mono text-xs uppercase tracking-wide text-mute">
              Launch stream (newest)
            </h2>
          </header>
          {loading && coins.length === 0 ? (
            <p className="p-6 text-center text-sm text-mute">Polling newest launches…</p>
          ) : (
            <ul className="max-h-[70vh] overflow-auto scroll-thin divide-y divide-line">
              {coins.map((c) => {
                const age = ageMinutesOf(c);
                const pct = bondingCurvePctOf(c);
                return (
                  <li key={c.mint} className="flex items-center gap-2 px-3 py-2">
                    {c.imageUri ? (
                      <CoinImage src={c.imageUri} alt={c.symbol} size={28} />
                    ) : (
                      <div className="h-7 w-7 rounded bg-ink-700" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">
                        {c.name}{" "}
                        <span className="font-mono text-[11px] text-mute">{c.symbol}</span>
                      </div>
                      <div className="font-mono text-[11px] text-mute">
                        {formatAge(age)} · curve {pct.toFixed(1)}%
                        {c.complete ? " · graduated" : ""}
                      </div>
                    </div>
                    <Link
                      href={`/coin/${c.mint}`}
                      className="font-mono text-[11px] text-mute hover:text-neon"
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
            <h2 className="font-mono text-xs uppercase tracking-wide text-mute">
              Candidates — human approval required
            </h2>
            <p className="text-[11px] text-mute">
              Checker speaks first. Score clearing the bar is not a buy signal.
            </p>
          </header>
          {candidates.length === 0 ? (
            <div className="rounded border border-line bg-ink-800 p-6 text-center text-sm text-mute">
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

      <section className="rounded border border-line bg-ink-800">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 font-mono text-xs uppercase text-mute"
          onClick={() => setSkippedOpen((v) => !v)}
        >
          <span>Skipped ({skipped.length})</span>
          <span>{skippedOpen ? "hide" : "show"}</span>
        </button>
        {skippedOpen ? (
          <ul className="max-h-72 overflow-auto scroll-thin divide-y divide-line border-t border-line">
            {skipped.slice(0, 80).map((e, i) => (
              <li key={`${e.mint}-${e.timestamp}-${i}`} className="px-3 py-2 text-xs">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{e.name}</span>
                  <span className="font-mono text-mute">{e.symbol}</span>
                  <span className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[10px] uppercase text-warn">
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

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={props.busy}
          onClick={props.onApprove}
          className="rounded bg-neon px-3 py-1.5 font-mono text-xs text-ink-950 disabled:opacity-40"
        >
          {props.busy ? "Working…" : props.simulate ? "Approve paper" : "Approve live…"}
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={props.onReject}
          className="rounded border border-line px-3 py-1.5 font-mono text-xs text-mute hover:border-danger hover:text-danger"
        >
          Reject
        </button>
      </div>
    </article>
  );
}
