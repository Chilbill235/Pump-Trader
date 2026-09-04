"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { useEffect, useState } from "react";
import { ALERTS_KEY, TPSL_FIRED_KEY } from "@/lib/constants";
import { safeReadScoped, safeWriteScoped } from "@/lib/accounts";
import { appendBotLog } from "@/lib/bot-log";
import { loadPositions, pnlPct, upsertPositionFromFill } from "@/lib/positions";
import { quoteTrade, isLikelyNotPumpCoin } from "@/lib/sdk";
import { quoteTokenToSol } from "@/lib/token-value";
import { simulateAndSend } from "@/lib/trade";
import type { AppAlert, Position } from "@/lib/types";
import { useSettings } from "./SettingsProvider";
import { useActiveAccountId } from "./AccountsProvider";
import { useWalletData } from "./WalletDataProvider";

function loadAlerts(accountId: string | null): AppAlert[] {
  if (!accountId) return [];
  return safeReadScoped<AppAlert[]>(accountId, ALERTS_KEY, []);
}

function saveAlerts(accountId: string | null, alerts: AppAlert[]): void {
  if (!accountId) return;
  safeWriteScoped(accountId, ALERTS_KEY, alerts.slice(0, 20));
}

function loadFiredKeys(accountId: string | null): Set<string> {
  if (!accountId) return new Set();
  const arr = safeReadScoped<string[]>(accountId, TPSL_FIRED_KEY, []);
  return new Set(arr);
}

function saveFiredKeys(accountId: string | null, keys: Set<string>): void {
  if (!accountId) return;
  safeWriteScoped(accountId, TPSL_FIRED_KEY, [...keys].slice(-100));
}

export function TpSlWatcher() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { settings } = useSettings();
  const accountId = useActiveAccountId();
  const walletData = useWalletData();
  const [banner, setBanner] = useState<AppAlert | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    async function tick() {
      const positions = loadPositions(accountId).filter(
        (p) => p.takeProfitPct != null || p.stopLossPct != null,
      );
      if (positions.length === 0) return;
      for (const p of positions) {
        if (cancelled) return;
        await checkOne(p);
      }
    }

    async function checkOne(p: Position) {
      try {
        let solLamports: string | null = null;
        try {
          const q = await quoteTrade({
            connection,
            mint: p.mint,
            user: wallet.publicKey,
            side: "sell",
            tokenAmountRaw: new BN(p.tokenAmountRaw),
            slippagePct: settings.slippagePct,
          });
          solLamports = q.solLamports;
        } catch (err) {
          if (!isLikelyNotPumpCoin(err)) {
            // transient pump error → skip this tick
            return;
          }
          // non-pump position: try Jupiter price feed for value
          const v = await quoteTokenToSol({
            connection,
            mint: p.mint,
            tokenAmountRaw: p.tokenAmountRaw,
            user: wallet.publicKey,
            slippagePct: settings.slippagePct,
          });
          if (!v.usd || !v.solLamports) {
            return; // not enough data to evaluate TP/SL
          }
          solLamports = v.solLamports;
        }
        if (!solLamports) return;
        const pnl = pnlPct(new BN(p.costLamports), new BN(solLamports));
        let kind: AppAlert["kind"] | null = null;
        if (p.takeProfitPct != null && pnl >= p.takeProfitPct) kind = "take-profit";
        else if (p.stopLossPct != null && pnl <= -Math.abs(p.stopLossPct)) kind = "stop-loss";
        if (!kind) return;

        const pnlBucket = kind === "take-profit" ? Math.floor(pnl) : Math.ceil(pnl);
        const key = `${p.mint}:${kind}:${pnlBucket}`;
        const fired = loadFiredKeys(accountId);
        if (fired.has(key)) return;
        fired.add(key);
        saveFiredKeys(accountId, fired);

        appendBotLog(accountId, {
          kind: kind === "take-profit" ? "tp_hit" : "sl_hit",
          mint: p.mint,
          symbol: p.symbol,
          sizeSol: Number(new BN(p.costLamports).toString()) / 1e9,
          pnlPct: pnl,
          message: `${kind} (${pnl.toFixed(2)}%)`,
        });
        let autoSold = false;
        const autoSellPaper = p.paper || settings.simulateMode;
        if (settings.autoSell && wallet.publicKey && wallet.connected) {
          try {
            const { receipt } = await simulateAndSend({
              connection,
              wallet,
              mint: p.mint,
              side: "sell",
              tokenAmountRaw: new BN(p.tokenAmountRaw),
              slippagePct: settings.slippagePct,
              paper: autoSellPaper,
            });
            upsertPositionFromFill({
              accountId,
              mint: p.mint,
              name: p.name,
              symbol: p.symbol,
              decimals: p.decimals,
              side: "sell",
              tokenAmountRaw: new BN(receipt.tokenAmountRaw),
              solLamports: new BN(receipt.solLamports),
              signature: receipt.signature,
              paper: receipt.paper,
            });
            autoSold = true;
            appendBotLog(accountId, {
              kind: receipt.paper ? "auto_sell_paper" : "auto_sell_live",
              mint: p.mint,
              symbol: p.symbol,
              signature: receipt.signature ?? undefined,
              sizeSol: Number(new BN(receipt.solLamports).toString()) / 1e9,
              message: receipt.paper
                ? `paper auto-sell at ${pnl.toFixed(2)}%`
                : `live auto-sell at ${pnl.toFixed(2)}%`,
            });
            walletData.refresh();
          } catch (err) {
            autoSold = false;
            appendBotLog(accountId, {
              kind: "error",
              mint: p.mint,
              symbol: p.symbol,
              message: `auto-sell failed: ${err instanceof Error ? err.message : String(err)}`,
            });
            console.error(`[TpSlWatcher] auto-sell failed for ${p.mint}:`, err);
          }
        }

        const alert: AppAlert = {
          id: key,
          mint: p.mint,
          symbol: p.symbol,
          kind,
          pnlPct: pnl,
          at: Date.now(),
          autoSold,
          message: autoSold
            ? `${p.symbol} ${kind} hit (${pnl.toFixed(1)}%). Auto-sell ${autoSellPaper ? "paper-filled" : "submitted"}.`
            : `${p.symbol} ${kind} hit (${pnl.toFixed(1)}%). Auto-sell ${settings.autoSell ? "failed" : "is OFF"} — this is an alert only.`,
        };
        const next = [alert, ...loadAlerts(accountId)];
        saveAlerts(accountId, next);
        if (!cancelled) setBanner(alert);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("Pump trader alert", { body: alert.message });
        }
      } catch (err) {
        console.error("[TpSlWatcher] checkOne error:", err);
      }
    }

    void tick();
    const id = setInterval(() => void tick(), 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  // Only re-run when the relevant settings/wallet change. walletData.refresh
  // is stable enough (depends only on the connection) that we ignore it here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, wallet, settings.autoSell, settings.simulateMode, settings.slippagePct, accountId]);

  if (!banner) return null;
  return (
    <div className="mb-3 flex items-start justify-between gap-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
      <p>{banner.message}</p>
      <button
        type="button"
        className="font-mono text-[11px] text-mute"
        onClick={() => setBanner(null)}
      >
        dismiss
      </button>
    </div>
  );
}