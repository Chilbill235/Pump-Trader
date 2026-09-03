"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BN from "bn.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  appendBotLog,
  botLogKindLabel,
  clearBotLog,
  loadBotLog,
  type BotLogEntry,
} from "@/lib/bot-log";
import { loadPositions, pnlPct } from "@/lib/positions";
import { quoteTrade } from "@/lib/sdk";
import { CoinImage } from "./CoinImage";
import { useSettings } from "./SettingsProvider";

const BOT_SESSION_KEY = "pump-trader:bot-session:v1";

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

function loadSession(): BotSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BOT_SESSION_KEY);
    return raw ? (JSON.parse(raw) as BotSession) : null;
  } catch {
    return null;
  }
}

function pnlToneClass(pnlPct: number): string {
  if (!Number.isFinite(pnlPct)) return "text-mute";
  if (pnlPct > 0) return "text-neon";
  if (pnlPct < 0) return "text-danger";
  return "text-mute";
}

export function BotView() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { settings } = useSettings();
  const [log, setLog] = useState<BotLogEntry[]>([]);
  const [session, setSession] = useState<BotSession | null>(null);
  const [positionsPnl, setPositionsPnl] = useState<
    Array<{ mint: string; symbol: string; name: string; imageUri?: string; pnlPct: number | null; valueSol: number | null; costSol: number }>
  >([]);

  useEffect(() => {
    setLog(loadBotLog());
    setSession(loadSession());
    const onStorage = () => {
      setLog(loadBotLog());
      setSession(loadSession());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const positions = loadPositions();
      const enriched = await Promise.all(
        positions.map(async (p) => {
          const costSol = Number(new BN(p.costLamports).toString()) / 1e9;
          try {
            const q = await quoteTrade({
              connection,
              mint: p.mint,
              user: wallet.publicKey,
              side: "sell",
              tokenAmountRaw: new BN(p.tokenAmountRaw),
              slippagePct: settings.slippagePct,
            });
            if (cancelled) return null;
            const valueSol = Number(new BN(q.solLamports).toString()) / 1e9;
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
            if (cancelled) return null;
            return { mint: p.mint, symbol: p.symbol, name: p.name, pnlPct: null, valueSol: null, costSol };
          }
        }),
      );
      if (cancelled) return;
      setPositionsPnl(enriched.filter((x): x is NonNullable<typeof x> => x !== null));
    }
    void refresh();
    const id = setInterval(() => void refresh(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [connection, wallet.publicKey, settings.slippagePct, log]);

  const totals = useMemo(() => {
    const buys = log.filter((e) => e.kind === "buy_live" || e.kind === "buy_paper").length;
    const sells = log.filter((e) => e.kind === "sell_live" || e.kind === "sell_paper").length;
    const tps = log.filter((e) => e.kind === "tp_hit").length;
    const sls = log.filter((e) => e.kind === "sl_hit").length;
    const errors = log.filter((e) => e.kind === "error").length;
    const liveBuys = log.filter((e) => e.kind === "buy_live").length;
    const paperBuys = log.filter((e) => e.kind === "buy_paper").length;
    const liveSolIn = log
      .filter((e) => e.kind === "buy_live" || e.kind === "auto_sell_live")
      .reduce((s, e) => s + (e.sizeSol ?? 0), 0);
    const paperSolIn = log
      .filter((e) => e.kind === "buy_paper" || e.kind === "auto_sell_paper")
      .reduce((s, e) => s + (e.sizeSol ?? 0), 0);
    const realizedPnl = positionsPnl.reduce(
      (s, p) => s + (p.pnlPct == null ? 0 : (p.valueSol ?? 0) - p.costSol),
      0,
    );
    return { buys, sells, tps, sls, errors, liveBuys, paperBuys, liveSolIn, paperSolIn, realizedPnl };
  }, [log, positionsPnl]);

  const walletOk = wallet.connected;
  const sessionActive = !!session;
  const sessionAgeMs = session ? Date.now() - session.startedAt : 0;

  function exportLog() {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pump-trader-bot-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg tracking-wide">Bot</h1>
          <p className="text-xs text-mute">
            Live activity stream from the auto-trade pipeline, TP/SL watcher, and your local
            positions. Use this to verify the bot is actually doing what you think it is.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportLog}
            className="rounded border border-line px-3 py-1.5 font-mono text-[11px] text-mute hover:border-neon hover:text-neon"
          >
            Export log
          </button>
          <button
            type="button"
            onClick={() => {
              clearBotLog();
              setLog([]);
            }}
            className="rounded border border-line px-3 py-1.5 font-mono text-[11px] text-mute hover:border-danger hover:text-danger"
          >
            Clear log
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Bot session"
          value={
            sessionActive
              ? `running ${humanizeAge(sessionAgeMs)}`
              : walletOk
                ? "idle"
                : "connect wallet"
          }
          tone={sessionActive ? "neon" : "mute"}
        />
        <StatCard
          label="Buys / sells"
          value={`${totals.buys} / ${totals.sells}`}
          sub={`live ${totals.liveBuys} · paper ${totals.paperBuys}`}
          tone="mute"
        />
        <StatCard
          label="Take-profit / stop-loss"
          value={`${totals.tps} / ${totals.sls}`}
          tone={totals.sls > totals.tps ? "danger" : totals.tps > 0 ? "neon" : "mute"}
        />
        <StatCard
          label="Realized PnL"
          value={`${totals.realizedPnl.toFixed(4)} SOL`}
          sub={`live SOL in ${totals.liveSolIn.toFixed(3)} · paper ${totals.paperSolIn.toFixed(3)}`}
          tone={pnlToneClass(totals.realizedPnl).replace("text-", "") as "neon" | "danger" | "mute"}
        />
      </div>

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

      <section className="rounded border border-line bg-ink-800">
        <header className="border-b border-line px-3 py-2">
          <h2 className="font-mono text-xs uppercase tracking-wide text-mute">
            Open positions · {positionsPnl.length}
          </h2>
        </header>
        {positionsPnl.length === 0 ? (
          <p className="p-6 text-center text-sm text-mute">No local positions. Start the bot to open some.</p>
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
                <span className={`font-mono text-xs ${pnlToneClass(p.pnlPct ?? 0)}`}>
                  {p.pnlPct == null ? "—" : `${p.pnlPct.toFixed(2)}%`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-line bg-ink-800">
        <header className="border-b border-line px-3 py-2">
          <h2 className="font-mono text-xs uppercase tracking-wide text-mute">
            Activity stream · {log.length}
          </h2>
          <p className="mt-0.5 text-[11px] text-mute">
            Most recent first. Use Export log to save. Most pump.fun coins go to zero.
          </p>
        </header>
        {log.length === 0 ? (
          <p className="p-6 text-center text-sm text-mute">
            No events yet. Click START BOT in the header to begin.
          </p>
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
                  <span className="font-mono text-[11px] text-mute">{new Date(e.ts).toLocaleTimeString()}</span>
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
                    <span className={`font-mono text-[11px] ${pnlToneClass(e.pnlPct)}`}>
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
  tone: "neon" | "danger" | "mute";
}) {
  const toneClass =
    tone === "neon" ? "border-neon/30 bg-neon/5 text-neon" : tone === "danger" ? "border-danger/30 bg-danger/5 text-danger" : "border-line bg-ink-800 text-zinc-100";
  return (
    <div className={`rounded border p-3 ${toneClass}`}>
      <p className="font-mono text-[10px] uppercase text-mute">{label}</p>
      <p className="mt-1 font-mono text-base">{value}</p>
      {sub ? <p className="text-[11px] text-mute">{sub}</p> : null}
    </div>
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

// helper for other components
export { appendBotLog };