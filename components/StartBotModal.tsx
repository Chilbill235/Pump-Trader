"use client";

import { useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { appendBotLog } from "@/lib/bot-log";
import { useSettings } from "./SettingsProvider";
import { useActiveAccountId } from "./AccountsProvider";
import { validateBotStart } from "@/lib/trade-limits";
import { BOT_SESSION_KEY } from "@/lib/constants";
import { safeWriteScoped } from "@/lib/accounts";

type Props = {
  open: boolean;
  onClose: () => void;
};

const HOURS = [1, 4, 8, 24];

export function StartBotModal({ open, onClose }: Props) {
  const { settings, update } = useSettings();
  const wallet = useWallet();
  const { connection } = useConnection();
  const accountId = useActiveAccountId();
  const [durationH, setDurationH] = useState<number>(4);
  const [maxTrades, setMaxTrades] = useState<number>(10);
  const [perCoinCapSol, setPerCoinCapSol] = useState<number>(settings.maxPositionSol);
  const [maxOpenPos, setMaxOpenPos] = useState<number>(settings.maxOpenPositions);
  const [dailyLossSol, setDailyLossSol] = useState<number>(settings.dailyLossLimit);
  const [slippage, setSlippage] = useState<number>(settings.slippagePct);
  const [tpPct, setTpPct] = useState<number>(20);
  const [slPct, setSlPct] = useState<number>(15);
  const [simulate, setSimulate] = useState<boolean>(settings.simulateMode);
  const [confirmAck, setConfirmAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [balanceLamports, setBalanceLamports] = useState<number | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !wallet.publicKey) {
      setBalanceLamports(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const lamports = await connection.getBalance(wallet.publicKey!, "confirmed");
        if (!cancelled) setBalanceLamports(lamports);
      } catch {
        if (!cancelled) setBalanceLamports(null);
      }
    })();
    fetch("/api/sol-price", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { usd?: number | null }) => {
        if (!cancelled) setSolUsd(j.usd ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, wallet.publicKey, connection]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const live = !simulate;
  const gateError = validateBotStart({
    walletConnected: wallet.connected,
    balanceLamports,
    solUsd,
  });
  const walletMissing = !wallet.connected;
  const canStart = !!wallet.connected && !gateError && confirmAck;

  async function start() {
    setBusy(true);
    try {
      update({
        simulateMode: simulate,
        autoTrade: true,
        autoSell: true,
        pipelineEnabled: true,
        slippagePct: slippage,
        maxPositionSol: perCoinCapSol,
        maxOpenPositions: maxOpenPos,
        dailyLossLimit: dailyLossSol,
        takeProfitPct: tpPct,
        stopLossPct: slPct,
        requireMetadata: true,
      });
      appendBotLog(accountId, {
        kind: "start",
        simulate,
        message: `started (${simulate ? "paper" : "LIVE"}) — ${durationH}h window · cap ${maxTrades} trades · ${perCoinCapSol} SOL/coin · TP ${tpPct}% / SL ${slPct}% · daily loss ${dailyLossSol} SOL · slip ${slippage}%`,
      });
      safeWriteScoped(accountId, BOT_SESSION_KEY, {
        startedAt: Date.now(),
        durationHours: durationH,
        maxTrades,
        perCoinCapSol,
        maxOpenPos,
        dailyLossSol,
        slippage,
        tpPct,
        slPct,
        simulate,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const balanceSol = balanceLamports != null ? balanceLamports / LAMPORTS_PER_SOL : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center overflow-hidden bg-black/70 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-bot-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-lg flex-col rounded-t-xl border border-line bg-ink-900 shadow-2xl sm:rounded-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-ink-800 px-4 py-3">
          <div>
            <h2 id="start-bot-title" className="font-mono text-sm tracking-wide text-neon">
              START AUTO-TRADE BOT
            </h2>
            <p className="mt-0.5 text-[11px] text-mute">
              Configure your run, then confirm. The bot watches new launches and auto-buys scoring
              candidates. It will not exceed any of the limits below.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded border border-line px-2 py-1 font-mono text-xs text-mute hover:border-danger hover:text-danger"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div
          ref={panelRef}
          tabIndex={-1}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 scroll-thin"
        >
          <section className="rounded border border-line bg-ink-800 p-3">
            <header className="flex items-center justify-between">
              <h3 className="font-mono text-[11px] uppercase tracking-wide text-mute">
                Wallet balance
              </h3>
              {solUsd != null ? (
                <span className="font-mono text-[11px] text-mute">SOL ≈ ${solUsd.toFixed(2)}</span>
              ) : (
                <span className="font-mono text-[11px] text-mute">SOL price …</span>
              )}
            </header>
            <p className="mt-1 break-all font-mono text-base">
              {walletMissing ? (
                <span className="text-warn">Wallet not connected — connect to start.</span>
              ) : balanceSol == null ? (
                "—"
              ) : (
                <>
                  {balanceSol.toFixed(4)} SOL
                  {solUsd != null ? ` ≈ $${(balanceSol * solUsd).toFixed(2)}` : null}
                </>
              )}
            </p>
            {gateError ? (
              <p className="mt-2 rounded border border-danger/40 bg-danger/5 p-2 text-[11px] text-danger">
                {gateError}
              </p>
            ) : balanceSol != null && solUsd != null && !walletMissing ? (
              <p className="mt-2 rounded border border-neon/40 bg-neon/5 p-2 text-[11px] text-neon">
                Balance OK. Bot can start.
              </p>
            ) : null}
          </section>

          <Section title="Run length">
            <div className="flex flex-wrap gap-2">
              {HOURS.map((h) => (
                <button
                  type="button"
                  key={h}
                  onClick={() => setDurationH(h)}
                  className={`rounded border px-3 py-1 font-mono text-xs ${
                    durationH === h
                      ? "border-neon text-neon"
                      : "border-line text-mute hover:border-neon/60"
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-mute">
              Bot runs continuously until you STOP. This is just a suggested duration — no auto-stop.
            </p>
          </Section>

          <Section title="Risk caps">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Max trades this run"
                value={maxTrades}
                step={1}
                min={1}
                max={500}
                onChange={(v) => setMaxTrades(Math.max(1, Math.round(v)))}
              />
              <Field
                label="SOL per coin"
                value={perCoinCapSol}
                step={0.01}
                min={0.001}
                max={5}
                onChange={(v) => setPerCoinCapSol(Math.max(0.001, v))}
              />
              <Field
                label="Max open positions"
                value={maxOpenPos}
                step={1}
                min={1}
                max={50}
                onChange={(v) => setMaxOpenPos(Math.max(1, Math.round(v)))}
              />
              <Field
                label="Daily loss limit SOL"
                value={dailyLossSol}
                step={0.05}
                min={0}
                max={50}
                onChange={(v) => setDailyLossSol(Math.max(0, v))}
              />
              <Field
                label="Slippage %"
                value={slippage}
                step={0.1}
                min={0.1}
                max={50}
                onChange={(v) => setSlippage(Math.max(0.1, v))}
              />
              <Field
                label="Take profit %"
                value={tpPct}
                step={1}
                min={1}
                max={1000}
                onChange={(v) => setTpPct(Math.max(1, v))}
              />
              <Field
                label="Stop loss %"
                value={slPct}
                step={1}
                min={1}
                max={99}
                onChange={(v) => setSlPct(Math.max(1, Math.min(99, v)))}
              />
            </div>
          </Section>

          <Section title="Mode">
            <label className="flex items-start gap-3 rounded border border-line bg-ink-800 p-3">
              <input
                type="checkbox"
                checked={simulate}
                onChange={(e) => setSimulate(e.target.checked)}
                className="mt-1 h-4 w-4 accent-neon"
              />
              <span>
                <span className="block text-sm">Simulate / paper mode</span>
                <span className="block text-xs text-mute">
                  OFF → bot trades REAL SOL on mainnet using your connected wallet.
                </span>
              </span>
            </label>
            {live ? (
              <p className="mt-2 rounded border border-danger/40 bg-danger/10 p-2 text-[11px] text-danger">
                LIVE mode. Real SOL will be spent. The wallet still has to sign every transaction —
                keep Phantom open.
              </p>
            ) : (
              <p className="mt-2 rounded border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">
                SIMULATE mode. No transaction is broadcast. Use this for tuning.
              </p>
            )}
          </Section>

          <label className="flex items-start gap-3 rounded border border-line bg-ink-800 p-3">
            <input
              type="checkbox"
              checked={confirmAck}
              onChange={(e) => setConfirmAck(e.target.checked)}
              className="mt-1 h-4 w-4 accent-danger"
            />
            <span className="text-xs text-mute">
              I understand: most pump.fun coins go to zero. The default checker stance is NO. This
              bot will still skip coins that fail filters, but it WILL buy any candidate that passes
              the score bar (&ge; {settings.minScore.toFixed(2)}). I am responsible for any loss.
            </span>
          </label>
        </div>

        <div className="sticky bottom-0 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-ink-800 px-4 py-3">
          <p className="mr-auto max-w-[60%] font-mono text-[11px] text-mute">
            {!wallet.connected
              ? "Connect wallet to start."
              : gateError
                ? "Top up balance to start."
                : !confirmAck
                  ? "Tick the acknowledgement to enable start."
                  : simulate
                    ? "Paper trade. No SOL at risk."
                    : "LIVE mainnet. Wallet will sign."}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line px-3 py-1.5 font-mono text-xs text-mute hover:border-danger hover:text-danger"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || !canStart}
            className="rounded bg-neon px-4 py-1.5 font-mono text-xs text-ink-950 disabled:opacity-40"
          >
            {busy
              ? "Starting…"
              : !wallet.connected
                ? "CONNECT WALLET"
                : gateError
                  ? "BALANCE TOO LOW"
                  : live
                    ? "START LIVE BOT"
                    : "START PAPER BOT"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-mute">{title}</h3>
      {children}
    </div>
  );
}

function Field({
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
        className="w-full rounded border border-line bg-ink-800 px-3 py-1.5 font-mono text-sm"
      />
    </label>
  );
}