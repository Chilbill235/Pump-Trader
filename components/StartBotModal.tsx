"use client";

import { useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { appendBotLog } from "@/lib/bot-log";
import { useSettings } from "./SettingsProvider";
import { useActiveAccountId } from "./AccountsProvider";
import { validateBotStart } from "@/lib/trade-limits";
import { BOT_DRAFT_KEY, BOT_SESSION_KEY } from "@/lib/constants";
import { safeReadScoped, safeWriteScoped } from "@/lib/accounts";
import { getBalanceWithFallback } from "@/lib/connection";

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

  // Rehydrate the user's previous bot config when the modal opens. We pull
  // from a per-account draft so the modal "remembers" what they typed last
  // time (and across bot starts/stops) instead of resetting to defaults.
  useEffect(() => {
    if (!open || !accountId) return;
    const draft = safeReadScoped<{
      durationH?: number;
      maxTrades?: number;
      perCoinCapSol?: number;
      maxOpenPos?: number;
      dailyLossSol?: number;
      slippage?: number;
      tpPct?: number;
      slPct?: number;
      simulate?: boolean;
    } | null>(accountId, BOT_DRAFT_KEY, null);
    if (draft) {
      if (typeof draft.durationH === "number") setDurationH(draft.durationH);
      if (typeof draft.maxTrades === "number") setMaxTrades(draft.maxTrades);
      if (typeof draft.perCoinCapSol === "number") setPerCoinCapSol(draft.perCoinCapSol);
      if (typeof draft.maxOpenPos === "number") setMaxOpenPos(draft.maxOpenPos);
      if (typeof draft.dailyLossSol === "number") setDailyLossSol(draft.dailyLossSol);
      if (typeof draft.slippage === "number") setSlippage(draft.slippage);
      if (typeof draft.tpPct === "number") setTpPct(draft.tpPct);
      if (typeof draft.slPct === "number") setSlPct(draft.slPct);
      if (typeof draft.simulate === "boolean") setSimulate(draft.simulate);
    } else {
      setPerCoinCapSol(settings.maxPositionSol);
      setMaxOpenPos(settings.maxOpenPositions);
      setDailyLossSol(settings.dailyLossLimit);
      setSlippage(settings.slippagePct);
      setSimulate(settings.simulateMode);
    }
    setConfirmAck(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  // Autosave every field the user changes so closing/cancelling still keeps
  // their choices for next time. This fires after the first rehydrate too.
  useEffect(() => {
    if (!accountId || !open) return;
    safeWriteScoped(accountId, BOT_DRAFT_KEY, {
      durationH,
      maxTrades,
      perCoinCapSol,
      maxOpenPos,
      dailyLossSol,
      slippage,
      tpPct,
      slPct,
      simulate,
    });
  }, [
    accountId,
    open,
    durationH,
    maxTrades,
    perCoinCapSol,
    maxOpenPos,
    dailyLossSol,
    slippage,
    tpPct,
    slPct,
    simulate,
  ]);

  useEffect(() => {
    if (!open || !wallet.publicKey) {
      setBalanceLamports(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { lamports } = await getBalanceWithFallback(connection, wallet.publicKey!);
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
      if (accountId) {
        safeWriteScoped(accountId, BOT_DRAFT_KEY, {
          durationH,
          maxTrades,
          perCoinCapSol,
          maxOpenPos,
          dailyLossSol,
          slippage,
          tpPct,
          slPct,
          simulate,
        });
      }
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
      className="fixed inset-0 z-[90] flex items-stretch justify-center overflow-hidden bg-ink-950/85 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-bot-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-t-xl border border-line glass-strong shadow-2xl sm:rounded-xl">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 h-44 w-44 rounded-full bg-neon/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-20 h-36 w-36 rounded-full bg-info/10 blur-3xl"
        />
        <div className="relative flex shrink-0 items-start justify-between gap-3 border-b border-line-soft bg-ink-850/80 px-4 py-3 backdrop-blur">
          <div>
            <h2 id="start-bot-title" className="font-mono text-sm font-semibold tracking-widest text-neon">
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
            className="press shrink-0 rounded-md border border-line bg-ink-800 p-1 text-mute hover:border-danger hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div
          ref={panelRef}
          tabIndex={-1}
          className="relative min-h-0 flex-1 space-y-4 overflow-y-auto p-4 scroll-thin"
        >
          <section className="relative overflow-hidden rounded-xl border border-line bg-ink-900 p-3">
            <header className="flex items-center justify-between">
              <h3 className="font-mono text-[10px] uppercase tracking-widest text-mute">
                Wallet balance
              </h3>
              {solUsd != null ? (
                <span className="font-mono text-[11px] text-mute">SOL ≈ <span className="text-info">${solUsd.toFixed(2)}</span></span>
              ) : (
                <span className="font-mono text-[11px] text-mute">SOL price …</span>
              )}
            </header>
            <p className="mt-1 break-all font-mono text-base text-white">
              {walletMissing ? (
                <span className="text-warn">Wallet not connected — connect to start.</span>
              ) : balanceSol == null ? (
                "—"
              ) : (
                <>
                  <span className="text-neon">{balanceSol.toFixed(4)}</span>{" "}
                  <span className="text-mute">SOL</span>
                  {solUsd != null ? (
                    <span className="text-mute"> ≈ <span className="text-info">${(balanceSol * solUsd).toFixed(2)}</span></span>
                  ) : null}
                </>
              )}
            </p>
            {gateError ? (
              <p className="mt-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-[11px] text-danger">
                {gateError}
              </p>
            ) : balanceSol != null && solUsd != null && !walletMissing ? (
              <p className="mt-2 rounded-md border border-neon/40 bg-neon/5 p-2 text-[11px] text-neon">
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
                  className={`press rounded-md px-3 py-1.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon ${
                    durationH === h
                      ? "border border-neon/50 bg-neon/10 text-neon"
                      : "border border-line bg-ink-850 text-mute hover:border-neon/60"
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
            <p className="mb-2 text-[11px] text-mute">
              Type any value. Each field has a sensible minimum; there is no maximum cap so
              you can size trades the way you want.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Max trades this run"
                value={maxTrades}
                step={1}
                min={1}
                onChange={(v) => setMaxTrades(Math.max(1, Math.round(v)))}
              />
              <Field
                label="SOL per coin"
                value={perCoinCapSol}
                step={0.0001}
                min={0.0001}
                onChange={(v) => setPerCoinCapSol(Math.max(0.0001, v))}
              />
              <Field
                label="Max open positions"
                value={maxOpenPos}
                step={1}
                min={1}
                onChange={(v) => setMaxOpenPos(Math.max(1, Math.round(v)))}
              />
              <Field
                label="Daily loss limit SOL"
                value={dailyLossSol}
                step={0.0001}
                min={0}
                onChange={(v) => setDailyLossSol(Math.max(0, v))}
              />
              <Field
                label="Slippage %"
                value={slippage}
                step={0.1}
                min={0.1}
                onChange={(v) => setSlippage(Math.max(0.1, v))}
              />
              <Field
                label="Take profit %"
                value={tpPct}
                step={0.5}
                min={0.1}
                onChange={(v) => setTpPct(Math.max(0.1, v))}
              />
              <Field
                label="Stop loss %"
                value={slPct}
                step={0.5}
                min={0.1}
                onChange={(v) => setSlPct(Math.max(0.1, v))}
              />
            </div>
          </Section>

          <Section title="Mode">
            <label className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${
              simulate
                ? "border-neon/30 bg-neon/5"
                : "border-danger/30 bg-danger/5"
            }`}>
              <input
                type="checkbox"
                checked={simulate}
                onChange={(e) => setSimulate(e.target.checked)}
                className="mt-1 h-4 w-4 accent-neon"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm text-white">
                  {simulate ? "Simulate / paper mode" : "Live mainnet mode"}
                </span>
                <span className="mt-0.5 block text-xs text-mute">
                  {simulate
                    ? "ON. No transactions broadcast. Use this for tuning the bot."
                    : "OFF. The bot will spend real SOL using your connected wallet."}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
                  simulate
                    ? "border-neon/30 bg-neon/5 text-neon"
                    : "border-danger/30 bg-danger/5 text-danger"
                }`}
              >
                {simulate ? "paper" : "live"}
              </span>
            </label>
            {live ? (
              <p className="mt-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-[11px] text-danger">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-danger align-middle live-pulse" />
                LIVE mode. Real SOL will be spent. The wallet still has to sign every transaction —
                keep Phantom open.
              </p>
            ) : (
              <p className="mt-2 rounded-md border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-warn align-middle live-pulse" />
                SIMULATE mode. No transaction is broadcast. Use this for tuning.
              </p>
            )}
          </Section>

          <label className="flex items-start gap-3 rounded-md border border-line bg-ink-900 p-3">
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

        <div className="sticky bottom-0 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line-soft bg-ink-850/90 px-4 py-3 backdrop-blur">
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
            className="press rounded-md border border-line bg-ink-800 px-3 py-1.5 font-mono text-xs text-mute hover:border-danger hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || !canStart}
            className={`press relative overflow-hidden rounded-md border px-4 py-1.5 font-mono text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-40 ${
              live
                ? "border-danger/50 bg-gradient-to-r from-danger to-rose-400 text-white focus-visible:ring-danger"
                : "border-neon/50 bg-gradient-to-r from-neon to-emerald-400 text-ink-950 focus-visible:ring-neon"
            }`}
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
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-mute">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        inputMode="decimal"
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" || raw === "-") {
            onChange(min);
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(n < min ? min : n);
        }}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n < min) onChange(min);
        }}
        className="w-full rounded-md border border-line bg-ink-850 px-3 py-1.5 font-mono text-sm focus:border-neon focus:bg-ink-900 focus:outline-none"
      />
    </label>
  );
}