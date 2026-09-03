"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BN from "bn.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  appendBotLog,
  botLogKindLabel,
  loadBotLog,
  type BotLogEntry,
} from "@/lib/bot-log";
import {
  computeStats,
  loadClosedTrades,
  loadEquityCurve,
  pushEquityPoint,
  bnToSol,
  getPeakEquity,
  updatePeakEquity,
  appendClosedTrade,
  getStartBankroll,
  setStartBankroll,
  resetStatsForNewSession,
  type EquityPoint,
  type ClosedTrade,
  type Stats,
} from "@/lib/stats";
import { BOT_SESSION_KEY } from "@/lib/constants";
import { safeReadScoped, removeScoped } from "@/lib/accounts";
import { loadPositions, pnlPct } from "@/lib/positions";
import { quoteTrade } from "@/lib/sdk";
import {
  DEFAULT_BANKROLL_CONFIG,
  evaluateBankroll,
  loadBankrollConfig,
  saveBankrollConfig,
  type BankrollConfig,
} from "@/lib/bankroll";
import { CoinImage } from "./CoinImage";
import { useSettings } from "./SettingsProvider";
import { useActiveAccountId } from "./AccountsProvider";

const POLL_MS = 12_000;

type BotSession = {
  startedAt: number;
  durationHours: number;
  simulate: boolean;
  maxTrades?: number;
  perCoinCapSol?: number;
  maxOpenPos?: number;
  dailyLossSol?: number;
  slippage?: number;
  tpPct?: number;
  slPct?: number;
};

export function BotView() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { settings } = useSettings();
  const accountId = useActiveAccountId();
  const [log, setLog] = useState<BotLogEntry[]>([]);
  const [session, setSession] = useState<BotSession | null>(null);
  const [positionsPnl, setPositionsPnl] = useState<
    Array<{ mint: string; symbol: string; name: string; pnlPct: number | null; valueSol: number | null; costSol: number }>
  >([]);
  const [bankrollSol, setBankrollSol] = useState<number | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [bankrollCfg, setBankrollCfg] = useState<BankrollConfig>(DEFAULT_BANKROLL_CONFIG);
  const realizedLossRef = useRef<number>(0);
  const lastEquitiesRef = useRef<{ mint: string; qty: number; cost: number }[]>([]);

  const reload = useCallback(() => {
    if (!accountId) return;
    setLog(loadBotLog(accountId));
    try {
      const raw = safeReadScoped<BotSession | null>(accountId, BOT_SESSION_KEY, null);
      setSession(raw);
    } catch {
      setSession(null);
    }
    setClosedTrades(loadClosedTrades(accountId));
    setEquityCurve(loadEquityCurve(accountId));
    setBankrollCfg(loadBankrollConfig(accountId));
  }, [accountId]);

  useEffect(() => {
    reload();
    const onStorage = () => reload();
    window.addEventListener("storage", onStorage);
    const t = setInterval(reload, 3000);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(t);
    };
  }, [reload]);

  const refreshLive = useCallback(async () => {
    try {
      if (wallet.publicKey) {
        const lamports = await connection.getBalance(wallet.publicKey, "confirmed");
        setBankrollSol(lamports / LAMPORTS_PER_SOL);
      } else {
        setBankrollSol(null);
      }
    } catch {
      // ignore
    }
    try {
      const res = await fetch("/api/sol-price", { cache: "no-store" });
      const j = (await res.json()) as { usd?: number | null };
      setSolUsd(j.usd ?? null);
    } catch {
      // ignore
    }
  }, [connection, wallet.publicKey]);

  useEffect(() => {
    void refreshLive();
    const id = setInterval(() => void refreshLive(), POLL_MS);
    return () => clearInterval(id);
  }, [refreshLive]);

  const refreshPositions = useCallback(async () => {
    if (!accountId) return;
    const positions = loadPositions(accountId);
    const enriched = await Promise.all(
      positions.map(async (p) => {
        const costSol = bnToSol(new BN(p.costLamports));
        try {
          const q = await quoteTrade({
            connection,
            mint: p.mint,
            user: wallet.publicKey,
            side: "sell",
            tokenAmountRaw: new BN(p.tokenAmountRaw),
            slippagePct: settings.slippagePct,
          });
          const valueSol = bnToSol(new BN(q.solLamports));
          const pct = pnlPct(new BN(p.costLamports), new BN(q.solLamports));
          return {
            mint: p.mint,
            symbol: p.symbol,
            name: p.name,
            pnlPct: pct,
            valueSol,
            costSol,
          };
        } catch {
          return { mint: p.mint, symbol: p.symbol, name: p.name, pnlPct: null, valueSol: null, costSol };
        }
      }),
    );
    setPositionsPnl(enriched);

    const previous = new Map(lastEquitiesRef.current.map((e) => [e.mint, e]));
    const current = enriched.map((e) => ({ mint: e.mint, qty: 0, cost: e.costSol }));
    current.forEach((c) => {
      const prev = previous.get(c.mint);
      if (prev && prev.cost > 0 && c.cost === 0) {
        // realized PnL is recomputed in the closed-trade effect below
      }
    });
    lastEquitiesRef.current = current;
  }, [connection, wallet.publicKey, settings.slippagePct, accountId]);

  useEffect(() => {
    void refreshPositions();
    const id = setInterval(() => void refreshPositions(), POLL_MS);
    return () => clearInterval(id);
  }, [refreshPositions]);

  useEffect(() => {
    if (!accountId) return;
    if (bankrollSol == null) return;
    const positionsValueSol = positionsPnl.reduce((s, p) => s + (p.valueSol ?? 0), 0);
    const equity = bankrollSol + positionsValueSol;
    const realizedPnlSol = closedTrades.reduce((s, t) => s + t.pnlSol, 0);
    const last = equityCurve[equityCurve.length - 1];
    if (!last || Date.now() - last.ts > POLL_MS - 1000) {
      const point: EquityPoint = {
        ts: Date.now(),
        bankrollSol,
        positionsValueSol,
        equitySol: equity,
        realizedPnlSol,
      };
      const next = pushEquityPoint(accountId, point);
      setEquityCurve(next);
      updatePeakEquity(accountId, equity);
      const start = getStartBankroll(accountId);
      if (start <= 0) setStartBankroll(accountId, bankrollSol);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankrollSol, positionsPnl, accountId]);

  const realizedPnlSol = useMemo(
    () => closedTrades.reduce((s, t) => s + t.pnlSol, 0),
    [closedTrades],
  );
  realizedLossRef.current = useMemo(
    () => Math.max(0, closedTrades.filter((t) => t.pnlSol < 0).reduce((s, t) => s + t.pnlSol, 0) * -1),
    [closedTrades],
  );

  const stats: Stats = useMemo(() => {
    const positionsValueSol = positionsPnl.reduce((s, p) => s + (p.valueSol ?? 0), 0);
    const startBankrollSol = getStartBankroll(accountId) || bankrollSol || 0;
    return computeStats({
      closedTrades,
      bankrollSol: bankrollSol ?? 0,
      positionsValueSol,
      realizedPnlSol,
      startBankrollSol,
      peakEquitySol: getPeakEquity(accountId),
    });
  }, [closedTrades, bankrollSol, positionsPnl, realizedPnlSol, accountId]);

  // Kill-switch check.
  const realizedLossRefValue = realizedLossRef.current;
  useEffect(() => {
    if (!session || !accountId) return;
    const result = evaluateBankroll({
      accountId,
      bankrollSol: bankrollSol ?? 0,
      positionsValueSol: positionsPnl.reduce((s, p) => s + (p.valueSol ?? 0), 0),
      realizedLossSessionSol: realizedLossRefValue,
      cfg: bankrollCfg,
    });
    if (result.killSwitch && result.killSwitchReason) {
      appendBotLog(accountId, {
        kind: "error",
        message: `KILL SWITCH: ${result.killSwitchReason}`,
      });
      try {
        // Only disable this account's settings.
        const key = `pump-trader:acct:${accountId}:settings:v1`;
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        window.localStorage.setItem(
          key,
          JSON.stringify({ ...parsed, autoTrade: false, autoSell: false, pipelineEnabled: false }),
        );
        removeScoped(accountId, BOT_SESSION_KEY);
      } catch {
        // ignore
      }
      setSession(null);
      reload();
    }
  }, [bankrollSol, positionsPnl, realizedLossRefValue, bankrollCfg, session, accountId, reload]);

  const seenTradeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!accountId) return;
    const sells = log.filter(
      (e) =>
        e.kind === "sell_live" ||
        e.kind === "sell_paper" ||
        e.kind === "auto_sell_paper" ||
        e.kind === "auto_sell_live",
    );
    for (const e of sells) {
      if (!e.mint) continue;
      if (seenTradeIdsRef.current.has(e.id)) continue;
      seenTradeIdsRef.current.add(e.id);
      const pos = loadPositions(accountId).find((p) => p.mint === e.mint);
      if (!pos) continue;
      const costSol = bnToSol(new BN(pos.costLamports));
      const solOut = e.sizeSol ?? 0;
      const pnlSol = solOut - costSol;
      const pnlPct = costSol > 0 ? (pnlSol / costSol) * 100 : 0;
      appendClosedTrade(accountId, {
        mint: e.mint,
        symbol: pos.symbol,
        ts: e.ts,
        solIn: costSol,
        solOut,
        pnlSol,
        pnlPct,
        paper: e.kind === "sell_paper" || e.kind === "auto_sell_paper",
        holdingMinutes: Math.max(0, (e.ts - pos.updatedAt) / 60000),
      });
    }
    setClosedTrades(loadClosedTrades(accountId));
  }, [log, accountId]);

  function exportLog() {
    if (!accountId) return;
    const blob = new Blob([JSON.stringify({ log, closedTrades, equityCurve }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pump-trader-bot-${accountId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetSessionStats() {
    if (!accountId) return;
    resetStatsForNewSession(accountId);
    setClosedTrades([]);
    setEquityCurve([]);
    reload();
    appendBotLog(accountId, { kind: "stop", message: "stats reset (new session)" });
  }

  function updateCfg(patch: Partial<BankrollConfig>) {
    if (!accountId) return;
    const next = { ...bankrollCfg, ...patch };
    setBankrollCfg(next);
    saveBankrollConfig(accountId, next);
  }

  const walletOk = wallet.connected;
  const sessionActive = !!session;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg tracking-wide">Bot</h1>
          <p className="text-xs text-mute">
            Real-time P&amp;L, equity curve, kill-switch, and full activity stream. Bankroll
            protection auto-stops the bot on drawdown or session loss. Scoped to this account only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportLog}
            className="rounded border border-line px-3 py-1.5 font-mono text-[11px] text-mute hover:border-neon hover:text-neon"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => {
              if (!confirm("Clear stats, log, and equity curve? This is a new session.")) return;
              resetSessionStats();
            }}
            className="rounded border border-line px-3 py-1.5 font-mono text-[11px] text-mute hover:border-danger hover:text-danger"
          >
            Reset session
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Session"
          value={
            sessionActive
              ? `running ${humanizeAge(Date.now() - session!.startedAt)}`
              : walletOk
                ? "idle"
                : "connect wallet"
          }
          tone={sessionActive ? "neon" : "mute"}
          sub={sessionActive ? (session.simulate ? "SIMULATE" : "LIVE MAINNET") : undefined}
        />
        <StatCard
          label="Equity"
          value={`${stats.equitySol.toFixed(4)} SOL`}
          sub={
            solUsd != null
              ? `≈ $${(stats.equitySol * solUsd).toFixed(2)} · SOL $${solUsd.toFixed(2)}`
              : bankrollSol != null
                ? `${bankrollSol.toFixed(4)} SOL bankroll`
                : undefined
          }
          tone={stats.equitySol >= (getStartBankroll(accountId) || 0) ? "neon" : "danger"}
        />
        <StatCard
          label="Realized PnL"
          value={`${stats.realizedPnlSol >= 0 ? "+" : ""}${stats.realizedPnlSol.toFixed(4)} SOL`}
          sub={`${(stats.realizedPnlPct * 100).toFixed(2)}% from start · drawdown ${(stats.drawdownPct * 100).toFixed(1)}%`}
          tone={stats.realizedPnlSol > 0 ? "neon" : stats.realizedPnlSol < 0 ? "danger" : "mute"}
        />
        <StatCard
          label="Win rate"
          value={
            stats.closed > 0
              ? `${(stats.winRate * 100).toFixed(0)}% (${stats.wins}W / ${stats.losses}L)`
              : "—"
          }
          sub={`avg win ${stats.avgWinSol.toFixed(3)} SOL · avg loss ${stats.avgLossSol.toFixed(3)} SOL`}
          tone={stats.winRate >= 0.5 && stats.closed > 4 ? "neon" : stats.closed > 0 ? "warn" : "mute"}
        />
      </div>

      <section className="rounded border border-line bg-ink-800 p-3">
        <header className="mb-2 flex items-center justify-between">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-mute">
            Bankroll protection
          </h2>
          <label className="flex items-center gap-2 font-mono text-[11px] text-mute">
            <input
              type="checkbox"
              checked={bankrollCfg.enabled}
              onChange={(e) => updateCfg({ enabled: e.target.checked })}
              className="accent-neon"
            />
            enabled
          </label>
        </header>
        <div className="grid gap-3 sm:grid-cols-3">
          <CfgField
            label="Equity floor (SOL)"
            value={bankrollCfg.equityFloorSol}
            step={0.01}
            min={0}
            max={50}
            onChange={(v) => updateCfg({ equityFloorSol: v })}
          />
          <CfgField
            label="Max drawdown (%)"
            value={bankrollCfg.drawdownPct * 100}
            step={1}
            min={1}
            max={95}
            onChange={(v) => updateCfg({ drawdownPct: v / 100 })}
          />
          <CfgField
            label="Session loss cap (SOL)"
            value={bankrollCfg.maxLossPerSessionSol}
            step={0.05}
            min={0}
            max={50}
            onChange={(v) => updateCfg({ maxLossPerSessionSol: v })}
          />
        </div>
        <p className="mt-2 text-[11px] text-mute">
          When the bot is running, equity dropping below the floor, drawdown exceeding the cap, or
          session realized loss exceeding the cap → bot auto-stops and logs the reason. You still
          control TP/SL per position in the Positions view.
        </p>
      </section>

      {session ? (
        <div className="rounded border border-line bg-ink-800 p-3 font-mono text-[11px]">
          <p className="text-mute">SESSION</p>
          <p>
            Started {new Date(session.startedAt).toLocaleString()} · {session.simulate ? "SIMULATE" : "LIVE"} ·{" "}
            {session.maxTrades ?? "∞"} trades cap · {session.perCoinCapSol ?? "?"} SOL per coin · slippage{" "}
            {session.slippage ?? "?"}% · TP {session.tpPct ?? "?"}% · SL {session.slPct ?? "?"}% · daily loss cap{" "}
            {session.dailyLossSol ?? "?"} SOL
          </p>
        </div>
      ) : null}

      {equityCurve.length > 1 ? (
        <EquityCurve points={equityCurve} />
      ) : (
        <div className="rounded border border-line bg-ink-800 p-6 text-center text-sm text-mute">
          Equity curve will appear after ~30 seconds of bot activity. Run the bot to populate it.
        </div>
      )}

      <section className="rounded border border-line bg-ink-800">
        <header className="border-b border-line px-3 py-2">
          <h2 className="font-mono text-xs uppercase tracking-wide text-mute">
            Open positions · {positionsPnl.length}
          </h2>
        </header>
        {positionsPnl.length === 0 ? (
          <p className="p-6 text-center text-sm text-mute">No local positions.</p>
        ) : (
          <ul className="divide-y divide-line">
            {positionsPnl.map((p) => (
              <li key={p.mint} className="flex items-center gap-3 px-3 py-2">
                <CoinImage src={undefined} alt={p.symbol} size={28} />
                <div className="min-w-0 flex-1">
                  <Link href={`/coin/${p.mint}`} className="hover:text-neon">
                    {p.name} <span className="font-mono text-xs text-mute">{p.symbol}</span>
                  </Link>
                  <div className="font-mono text-[11px] text-mute">
                    cost {p.costSol.toFixed(4)} SOL · value {p.valueSol == null ? "…" : `${p.valueSol.toFixed(4)} SOL`}
                  </div>
                </div>
                <span
                  className={`font-mono text-xs ${
                    p.pnlPct == null
                      ? "text-mute"
                      : p.pnlPct > 0
                        ? "text-neon"
                        : p.pnlPct < 0
                          ? "text-danger"
                          : "text-mute"
                  }`}
                >
                  {p.pnlPct == null ? "—" : `${p.pnlPct.toFixed(2)}%`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {closedTrades.length > 0 ? (
        <section className="rounded border border-line bg-ink-800">
          <header className="border-b border-line px-3 py-2">
            <h2 className="font-mono text-xs uppercase tracking-wide text-mute">
              Closed trades · {closedTrades.length}
            </h2>
            <p className="mt-0.5 text-[11px] text-mute">
              Best {stats.bestTradeSol.toFixed(3)} SOL · Worst {stats.worstTradeSol.toFixed(3)} SOL
            </p>
          </header>
          <ul className="max-h-72 divide-y divide-line overflow-auto scroll-thin">
            {closedTrades.slice(0, 50).map((t, i) => (
              <li key={`${t.mint}-${t.ts}-${i}`} className="flex items-baseline gap-3 px-3 py-2 text-xs">
                <span className="font-mono text-[11px] text-mute">
                  {new Date(t.ts).toLocaleTimeString()}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <Link href={`/coin/${t.mint}`} className="hover:text-neon">
                    {t.symbol}
                  </Link>
                </span>
                <span className="font-mono text-[11px] text-mute">
                  in {t.solIn.toFixed(3)} · out {t.solOut.toFixed(3)} · {Math.round(t.holdingMinutes)}m
                </span>
                <span
                  className={`font-mono text-[11px] ${
                    t.pnlSol > 0 ? "text-neon" : t.pnlSol < 0 ? "text-danger" : "text-mute"
                  }`}
                >
                  {t.pnlSol >= 0 ? "+" : ""}
                  {t.pnlSol.toFixed(4)} ({t.pnlPct.toFixed(1)}%)
                </span>
                {t.paper ? (
                  <span className="rounded bg-warn/10 px-1 py-0.5 text-[10px] text-warn">paper</span>
                ) : (
                  <span className="rounded bg-neon/10 px-1 py-0.5 text-[10px] text-neon">live</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded border border-line bg-ink-800">
        <header className="border-b border-line px-3 py-2">
          <h2 className="font-mono text-xs uppercase tracking-wide text-mute">
            Activity stream · {log.length}
          </h2>
        </header>
        {log.length === 0 ? (
          <p className="p-6 text-center text-sm text-mute">No events yet.</p>
        ) : (
          <ul className="max-h-[70vh] divide-y divide-line overflow-auto scroll-thin">
            {log.map((e) => {
              const tone = botLogKindLabel(e.kind);
              const toneClass =
                tone.tone === "ok"
                  ? "border-neon/40 text-neon"
                  : tone.tone === "warn"
                    ? "border-warn/40 text-warn"
                    : tone.tone === "danger"
                      ? "border-danger/40 text-danger"
                      : "border-line text-mute";
              return (
                <li key={e.id} className="flex items-baseline gap-3 px-3 py-2 text-sm">
                  <span
                    className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${toneClass}`}
                  >
                    {tone.label}
                  </span>
                  <span className="font-mono text-[11px] text-mute">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {e.mint ? (
                      <Link href={`/coin/${e.mint}`} className="hover:text-neon">
                        {e.symbol ?? e.mint.slice(0, 6)}
                      </Link>
                    ) : (
                      e.symbol
                    )}{" "}
                    {e.message}
                  </span>
                  {e.sizeSol != null ? (
                    <span className="font-mono text-[11px] text-mute">{e.sizeSol} SOL</span>
                  ) : null}
                  {e.pnlPct != null ? (
                    <span
                      className={`font-mono text-[11px] ${
                        e.pnlPct > 0 ? "text-neon" : e.pnlPct < 0 ? "text-danger" : "text-mute"
                      }`}
                    >
                      {e.pnlPct.toFixed(2)}%
                    </span>
                  ) : null}
                  {e.signature ? (
                    <a
                      className="font-mono text-[11px] text-mute underline hover:text-neon"
                      href={`https://solscan.io/tx/${e.signature}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      tx
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "neon" | "danger" | "warn" | "mute";
}) {
  const toneClass =
    tone === "neon"
      ? "border-neon/30 bg-neon/5 text-neon"
      : tone === "danger"
        ? "border-danger/30 bg-danger/5 text-danger"
        : tone === "warn"
          ? "border-warn/30 bg-warn/5 text-warn"
          : "border-line bg-ink-800 text-zinc-100";
  return (
    <div className={`rounded border p-3 ${toneClass}`}>
      <p className="font-mono text-[10px] uppercase text-mute">{label}</p>
      <p className="mt-1 font-mono text-base">{value}</p>
      {sub ? <p className="text-[11px] text-mute">{sub}</p> : null}
    </div>
  );
}

function CfgField({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[11px] uppercase text-mute">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          onChange(Math.min(max, Math.max(min, n)));
        }}
        className="w-full rounded border border-line bg-ink-900 px-3 py-1.5 font-mono text-sm"
      />
    </label>
  );
}

function EquityCurve({ points }: { points: EquityPoint[] }) {
  const w = 720;
  const h = 120;
  const padding = 8;
  const min = Math.min(...points.map((p) => p.equitySol));
  const max = Math.max(...points.map((p) => p.equitySol));
  const span = Math.max(0.0001, max - min);
  const xStep = (w - padding * 2) / Math.max(1, points.length - 1);
  const path = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = h - padding - ((p.equitySol - min) / span) * (h - padding * 2);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath =
    path +
    ` L ${(padding + (points.length - 1) * xStep).toFixed(1)} ${h - padding}` +
    ` L ${padding} ${h - padding} Z`;
  const start = points[0].equitySol;
  const end = points[points.length - 1].equitySol;
  const delta = end - start;
  const deltaPct = start > 0 ? (delta / start) * 100 : 0;
  const tone = delta >= 0 ? "text-neon" : "text-danger";
  return (
    <section className="rounded border border-line bg-ink-800 p-3">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-wide text-mute">Equity curve</h2>
        <span className={`font-mono text-xs ${tone}`}>
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(4)} SOL ({deltaPct.toFixed(2)}%) · {points.length} pts
        </span>
      </header>
      <svg viewBox={`0 0 ${w} ${h}`} className="block h-32 w-full">
        <defs>
          <linearGradient id="eq-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className={tone}>
          <path d={areaPath} fill="url(#eq-grad)" />
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>
        <text x={padding} y={h - 1} fontSize="9" fill="currentColor" opacity="0.5" className="font-mono">
          {start.toFixed(4)} SOL
        </text>
        <text
          x={w - padding}
          y={12}
          fontSize="9"
          fill="currentColor"
          opacity="0.5"
          className="font-mono"
          textAnchor="end"
        >
          {end.toFixed(4)} SOL
        </text>
      </svg>
    </section>
  );
}

function humanizeAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}