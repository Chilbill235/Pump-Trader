"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { lamportsToSol, pct, shortenAddress, tokensToUi } from "@/lib/format";
import {
  loadPositions,
  pnlPct,
  removePosition,
  updatePositionMeta,
} from "@/lib/positions";
import { loadWalletPortfolio, type WalletToken } from "@/lib/portfolio";
import { quoteTrade } from "@/lib/sdk";
import type { Position } from "@/lib/types";
import { CoinImage } from "./CoinImage";
import { CopyButton } from "./CopyButton";
import { useSettings } from "./SettingsProvider";

type Row = Position & { valueLamports: string | null; err?: string };

type Holding = WalletToken & {
  name: string;
  symbol: string;
  imageUri?: string;
  source: "cache" | "lookup" | "unknown";
  valueLamports: string | null;
  costLamports: string | null;
  err?: string;
};

export function PositionsView() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const { settings } = useSettings();
  const [rows, setRows] = useState<Row[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [holdingsErr, setHoldingsErr] = useState<string | null>(null);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [sol, setSol] = useState<number | null>(null);
  const [solErr, setSolErr] = useState<string | null>(null);

  const refreshLocal = useCallback(async () => {
    const list = loadPositions();
    const valued = await Promise.all(
      list.map(async (p) => {
        try {
          const q = await quoteTrade({
            connection,
            mint: p.mint,
            user: publicKey,
            side: "sell",
            tokenAmountRaw: new BN(p.tokenAmountRaw),
            slippagePct: settings.slippagePct,
          });
          return { ...p, valueLamports: q.solLamports } satisfies Row;
        } catch (err) {
          return {
            ...p,
            valueLamports: null,
            err: err instanceof Error ? err.message : String(err),
          } satisfies Row;
        }
      }),
    );
    setRows(valued);
  }, [connection, publicKey, settings.slippagePct]);

  const refreshWallet = useCallback(async () => {
    if (!publicKey) {
      setHoldings([]);
      return;
    }
    setHoldingsLoading(true);
    setHoldingsErr(null);
    try {
      const tokens = await loadWalletPortfolio(connection, publicKey, async (mint) => {
        try {
          const res = await fetch(`/api/coins/${mint}`, { cache: "no-store" });
          const j = (await res.json()) as { coin: { name: string; symbol: string; imageUri?: string } | null };
          return j.coin
            ? { name: j.coin.name, symbol: j.coin.symbol, imageUri: j.coin.imageUri }
            : null;
        } catch {
          return null;
        }
      });
      // skip closed SOL pool mints: filter to spl-token & non-zero
      const eligible = tokens.filter((t) => t.mint !== "So11111111111111111111111111111111111111112");
      const valued = await Promise.all(
        eligible.map(async (t) => {
          try {
            const q = await quoteTrade({
              connection,
              mint: t.mint,
              user: publicKey,
              side: "sell",
              tokenAmountRaw: new BN(Math.round(t.amount)),
              slippagePct: settings.slippagePct,
            });
            return {
              ...t,
              valueLamports: q.solLamports,
              costLamports: null,
            } satisfies Holding;
          } catch (err) {
            return {
              ...t,
              valueLamports: null,
              costLamports: null,
              err: err instanceof Error ? err.message : String(err),
            } satisfies Holding;
          }
        }),
      );
      setHoldings(valued);
    } catch (err) {
      setHoldingsErr(err instanceof Error ? err.message : String(err));
    } finally {
      setHoldingsLoading(false);
    }
  }, [connection, publicKey, settings.slippagePct]);

  useEffect(() => {
    void refreshLocal();
    const id = setInterval(() => void refreshLocal(), 15_000);
    return () => clearInterval(id);
  }, [refreshLocal]);

  useEffect(() => {
    if (!publicKey) {
      setHoldings([]);
      return;
    }
    void refreshWallet();
    const id = setInterval(() => void refreshWallet(), 20_000);
    return () => clearInterval(id);
  }, [publicKey, refreshWallet]);

  useEffect(() => {
    const key = publicKey;
    if (!key) {
      setSol(null);
      return;
    }
    let cancelled = false;
    let retries = 0;
    const maxRetries = 2;
    async function fetchBalance() {
      try {
        const l = await connection.getBalance(key!);
        if (!cancelled) {
          setSol(l / LAMPORTS_PER_SOL);
          setSolErr(null);
        }
      } catch (err) {
        retries++;
        const msg = err instanceof Error ? err.message : String(err);
        const isForbidden = msg.includes("403") || msg.toLowerCase().includes("forbidden");
        if (isForbidden && retries <= maxRetries && !cancelled) {
          setTimeout(fetchBalance, 1000 * retries);
          return;
        }
        if (!cancelled) {
          setSolErr(isForbidden ? "Public RPC blocked balance check. Use a custom RPC in Settings." : msg);
        }
      }
    }
    fetchBalance();
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-mono text-lg tracking-wide">Positions</h1>
        <p className="text-xs text-mute">
          Your on-wallet SPL holdings and the tokens this app has traded for you.
        </p>
      </div>
      <div className="rounded border border-line bg-ink-800 p-3 font-mono text-sm">
        Wallet SOL:{" "}
        {solErr ? <span className="text-danger">{solErr}</span> : sol == null ? "—" : `${sol.toFixed(4)} SOL`}
        {connected ? (
          <span className="ml-3 text-mute">{shortenAddress(publicKey!.toBase58(), 6, 6)}</span>
        ) : null}
      </div>

      {!connected ? (
        <div className="rounded border border-line bg-ink-800 p-8 text-center text-sm text-mute">
          Connect your Phantom wallet (top-right) to load your positions and on-wallet holdings.
        </div>
      ) : (
        <>
          <section className="rounded border border-line bg-ink-800">
            <header className="flex items-center justify-between border-b border-line px-3 py-2">
              <h2 className="font-mono text-xs uppercase tracking-wide text-mute">
                Wallet holdings {holdingsLoading ? "· loading…" : `· ${holdings.length}`}
              </h2>
              <button
                type="button"
                onClick={() => void refreshWallet()}
                className="font-mono text-[11px] text-mute hover:text-neon"
              >
                refresh
              </button>
            </header>
            {holdingsErr ? (
              <p className="p-3 text-xs text-danger">{holdingsErr}</p>
            ) : holdings.length === 0 && !holdingsLoading ? (
              <p className="p-6 text-center text-sm text-mute">
                No SPL tokens found in this wallet.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {holdings.map((h) => (
                  <HoldingRow key={h.mint} holding={h} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-mute">
              Local positions (this app) · {rows.length}
            </h2>
            {rows.length === 0 ? (
              <div className="rounded border border-line bg-ink-800 p-8 text-center text-sm text-mute">
                No positions yet. Paper-trade a coin to see it here.
              </div>
            ) : (
              <div className="overflow-x-auto rounded border border-line">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-ink-800 font-mono text-[11px] uppercase text-mute">
                    <tr>
                      <th className="px-3 py-2">Coin</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Cost</th>
                      <th className="px-3 py-2">Value</th>
                      <th className="px-3 py-2">PnL</th>
                      <th className="px-3 py-2">TP %</th>
                      <th className="px-3 py-2">SL %</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <PositionRow
                        key={r.mint}
                        position={r}
                        onUpdate={() => void refreshLocal()}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function HoldingRow({ holding }: { holding: Holding }) {
  const value = holding.valueLamports ? new BN(holding.valueLamports) : null;
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <CoinImage src={holding.imageUri ?? null} alt={holding.symbol} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link href={`/coin/${holding.mint}`} className="truncate font-medium hover:text-neon">
            {holding.name}
          </Link>
          <span className="font-mono text-xs text-mute">{holding.symbol}</span>
          <span className="font-mono text-[11px] text-mute">
            {tokensToUi(new BN(Math.round(holding.amount)), holding.decimals)} {holding.symbol}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-mute">
          {shortenAddress(holding.mint, 6, 6)}
          <CopyButton value={holding.mint} label="copy" />
          {holding.source === "unknown" ? (
            <span className="rounded bg-warn/10 px-1 py-0.5 text-[10px] text-warn">no meta</span>
          ) : null}
        </div>
      </div>
      <div className="text-right font-mono text-xs">
        {value ? (
          <span>{lamportsToSol(value)} SOL</span>
        ) : holding.err ? (
          <span className="text-danger">err</span>
        ) : (
          <span className="text-mute">…</span>
        )}
      </div>
    </li>
  );
}

function PositionRow({
  position,
  onUpdate,
}: {
  position: Row;
  onUpdate: () => void;
}) {
  const [tp, setTp] = useState<string>(position.takeProfitPct == null ? "" : String(position.takeProfitPct));
  const [sl, setSl] = useState<string>(position.stopLossPct == null ? "" : String(position.stopLossPct));

  useEffect(() => {
    setTp(position.takeProfitPct == null ? "" : String(position.takeProfitPct));
    setSl(position.stopLossPct == null ? "" : String(position.stopLossPct));
  }, [position.takeProfitPct, position.stopLossPct]);

  const cost = new BN(position.costLamports);
  const value = position.valueLamports ? new BN(position.valueLamports) : null;
  const pnl = value ? pnlPct(cost, value) : null;

  return (
    <tr className="border-t border-line">
      <td className="px-3 py-2">
        <Link href={`/coin/${position.mint}`} className="hover:text-neon">
          {position.name} <span className="font-mono text-xs text-mute">{position.symbol}</span>
        </Link>
        <div className="flex items-center gap-2 font-mono text-[11px] text-mute">
          {shortenAddress(position.mint)} {position.paper ? "paper" : "live"}
          <CopyButton value={position.mint} label="copy" />
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        {tokensToUi(new BN(position.tokenAmountRaw), position.decimals)}
      </td>
      <td className="px-3 py-2 font-mono text-xs">{lamportsToSol(cost)} SOL</td>
      <td className="px-3 py-2 font-mono text-xs">
        {value ? `${lamportsToSol(value)} SOL` : position.err ? "err" : "…"}
      </td>
      <td
        className={`px-3 py-2 font-mono text-xs ${
          pnl == null ? "" : pnl >= 0 ? "text-neon" : "text-danger"
        }`}
      >
        {pnl == null ? "—" : pct(pnl)}
      </td>
      <td className="px-3 py-2">
        <input
          className="w-16 rounded border border-line bg-ink-900 px-1 py-0.5 font-mono text-xs"
          value={tp}
          placeholder="off"
          onChange={(e) => setTp(e.target.value)}
          onBlur={() => {
            const v = tp.trim();
            updatePositionMeta(position.mint, {
              takeProfitPct: v ? Number(v) : null,
            });
            onUpdate();
          }}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className="w-16 rounded border border-line bg-ink-900 px-1 py-0.5 font-mono text-xs"
          value={sl}
          placeholder="off"
          onChange={(e) => setSl(e.target.value)}
          onBlur={() => {
            const v = sl.trim();
            updatePositionMeta(position.mint, {
              stopLossPct: v ? Number(v) : null,
            });
            onUpdate();
          }}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          className="font-mono text-[11px] text-mute hover:text-danger"
          onClick={() => {
            removePosition(position.mint);
            onUpdate();
          }}
        >
          remove
        </button>
      </td>
    </tr>
  );
}