"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { lamportsToSol, pct, shortenAddress, tokensToUi } from "@/lib/format";
import { MIN_HOLDING_USD_TO_TRADE } from "@/lib/trade-limits";
import {
  loadPositions,
  pnlPct,
  removePosition,
  updatePositionMeta,
} from "@/lib/positions";
import { loadWalletPortfolio, type WalletToken } from "@/lib/portfolio";
import { quoteTrade } from "@/lib/sdk";
import { getSolUsd, quoteTokenToSol } from "@/lib/token-value";
import { fetchJupiterUsdPrice, getKnownTokenMeta } from "@/lib/jupiter";
import type { Position } from "@/lib/types";
import { CoinImage } from "./CoinImage";
import { CopyButton } from "./CopyButton";
import { QuickTradePanel } from "./QuickTradePanel";
import { useSettings } from "./SettingsProvider";
import { useActiveAccountId } from "./AccountsProvider";

type Row = Position & { valueLamports: string | null; err?: string };

type Holding = WalletToken & {
  name: string;
  symbol: string;
  imageUri?: string;
  source: "cache" | "lookup" | "unknown";
  valueLamports: string | null;
  valueUsd: number | null;
  isPumpCoin: boolean;
  err?: string;
};

export function PositionsView() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const { settings } = useSettings();
  const accountId = useActiveAccountId();
  const [rows, setRows] = useState<Row[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [holdingsErr, setHoldingsErr] = useState<string | null>(null);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [sol, setSol] = useState<number | null>(null);
  const [solErr, setSolErr] = useState<string | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [tradeMint, setTradeMint] = useState<string | null>(null);

  const refreshLocal = useCallback(async () => {
    if (!accountId) {
      setRows([]);
      return;
    }
    const list = loadPositions(accountId);
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
  }, [connection, publicKey, settings.slippagePct, accountId]);

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
      // Show every token the wallet holds, including dust and wrapped SOL
      // (native SOL is still shown separately at the top of the page for
      // convenience). The user explicitly asked for a complete list of
      // everything in the wallet.
      const eligible = tokens;
      // Fall back to the well-known token list (USDC, USDT, BONK, JUP, …) when
      // the pump-fun metadata endpoint returns nothing.
      const enrichedMeta = eligible.map((t) => {
        if (t.source !== "unknown") return t;
        const known = getKnownTokenMeta(t.mint);
        if (known) {
          return {
            ...t,
            name: known.name,
            symbol: known.symbol,
            source: "lookup" as const,
          };
        }
        return t;
      });
      const usd = solUsd ?? (await getSolUsd());
      const valued = await Promise.all(
        enrichedMeta.map(async (t): Promise<Holding> => {
          try {
            const q = await quoteTokenToSol({
              connection,
              mint: t.mint,
              tokenAmountRaw: t.amount,
              user: publicKey,
              slippagePct: settings.slippagePct,
              solUsd: usd,
            });
            return {
              ...t,
              valueLamports: q.solLamports,
              valueUsd: q.usd,
              isPumpCoin: q.isPumpCoin,
              err: q.error,
            } satisfies Holding;
          } catch (err) {
            return {
              ...t,
              valueLamports: null,
              valueUsd: null,
              isPumpCoin: false,
              err: err instanceof Error ? err.message : String(err),
            } satisfies Holding;
          }
        }),
      );
      // also fetch a USD price for any holding that came back with USD=null
      const needUsd = valued
        .filter((h) => h.valueUsd == null && !h.err)
        .map((h) => h.mint);
      if (needUsd.length > 0) {
        const prices = await fetchJupiterUsdPrice(needUsd);
        for (const h of valued) {
          if (h.valueUsd != null) continue;
          const p = prices[h.mint];
          if (p != null && Number.isFinite(p) && Number.isFinite(h.uiAmount)) {
            h.valueUsd = p * h.uiAmount;
          }
        }
      }
      setHoldings(valued);
    } catch (err) {
      setHoldingsErr(err instanceof Error ? err.message : String(err));
    } finally {
      setHoldingsLoading(false);
    }
  }, [connection, publicKey, settings.slippagePct, solUsd]);

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
    let cancelled = false;
    void getSolUsd().then((v) => {
      if (!cancelled) setSolUsd(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const totalSol = sol ?? 0;
  const totalHoldingsSol = holdings.reduce((s, h) => {
    if (h.valueLamports) return s + Number(lamportsToSol(new BN(h.valueLamports)));
    if (h.valueUsd != null && solUsd != null && solUsd > 0) return s + h.valueUsd / solUsd;
    return s;
  }, 0);
  const totalUsd = (totalSol + totalHoldingsSol) * (solUsd ?? 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-mono text-lg tracking-wide">Positions</h1>
        <p className="text-xs text-mute">
          Your on-wallet SPL holdings and the tokens this account has traded. Other accounts on this
          device are isolated.
        </p>
      </div>
      <div className="rounded border border-line bg-ink-800 p-3 font-mono text-sm">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span>
            Wallet SOL:{" "}
            {solErr ? <span className="text-danger">{solErr}</span> : sol == null ? "—" : `${sol.toFixed(4)} SOL`}
            {solUsd != null && sol != null ? (
              <span className="ml-1 text-mute">≈ ${(sol * solUsd).toFixed(2)}</span>
            ) : null}
          </span>
          {connected ? (
            <span className="text-mute">{shortenAddress(publicKey!.toBase58(), 6, 6)}</span>
          ) : null}
        </div>
        {connected && (holdings.length > 0 || totalSol > 0) && solUsd != null ? (
          <p className="mt-1 text-[11px] text-mute">
            Total ≈ {totalSol.toFixed(4)} + {totalHoldingsSol.toFixed(4)} holdings = {(totalSol + totalHoldingsSol).toFixed(4)} SOL · ${totalUsd.toFixed(2)}
          </p>
        ) : null}
      </div>

      {!connected ? (
        <div className="rounded border border-line bg-ink-800 p-8 text-center text-sm text-mute">
          Connect your wallet to load your positions and on-wallet holdings.
        </div>
      ) : (
      <>
        <section className="rounded border border-line bg-ink-800">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <h2 className="font-mono text-xs uppercase tracking-wide text-mute">
              Wallet holdings {holdingsLoading ? "· loading?" : `· ${holdings.length}`}
            </h2>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-mute">
                {holdings.length} token{holdings.length === 1 ? "" : "s"} · everything in this wallet
              </span>
              <button
                type="button"
                onClick={() => void refreshWallet()}
                className="font-mono text-[11px] text-mute hover:text-neon"
              >
                refresh
              </button>
            </div>
          </header>
          {holdingsErr ? (
            <div className="p-3 text-xs text-danger">
              <p>Could not load wallet tokens: {holdingsErr}</p>
              <p className="mt-1 text-mute">
                Public RPCs are rate-limited. Set a private RPC in Settings
                (NEXT_PUBLIC_SOLANA_RPC_URL or Helius/QuickNet/Triton). Verify holdings on{" "}
                <a
                  className="underline"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://solscan.io/account/${publicKey!.toBase58()}#balances`}
                >
                  Solscan
                </a>
                .
              </p>
            </div>
          ) : holdings.length === 0 && !holdingsLoading ? (
            <div className="space-y-2 p-6 text-center text-sm text-mute">
              <p>No SPL tokens found in this wallet.</p>
              <p className="font-mono text-[11px]">
                Verify on{" "}
                <a
                  className="underline"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://solscan.io/account/${publicKey!.toBase58()}#balances`}
                >
                  Solscan
                </a>
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {holdings.map((h) => (
                <HoldingRow
                  key={h.mint}
                  holding={h}
                  onTrade={() => setTradeMint(h.mint)}
                  solUsd={solUsd}
                />
              ))}
            </ul>
          )}
          <p className="border-t border-line/60 px-3 py-2 text-[11px] text-mute">
            Tap a token to trade. Pump.fun bonding-curve / pump-amm coins use the pump program.
            Everything else (USDC, BONK, JUP, memecoins, etc.) routes through Jupiter so you can
            buy or sell using any token in your wallet that has enough balance. The app requires
            at least $1 USD per trade — sub-$1 dust is shown but the Trade button is disabled.
          </p>
        </section>

          {tradeMint ? (
            <section className="rounded border border-line bg-ink-800 p-3">
              <header className="mb-2 flex items-center justify-between">
                <h2 className="font-mono text-xs uppercase tracking-wide text-mute">
                  Trade · {shortenAddress(tradeMint, 6, 6)}
                </h2>
                <button
                  type="button"
                  onClick={() => setTradeMint(null)}
                  className="font-mono text-[11px] text-mute hover:text-danger"
                >
                  close
                </button>
              </header>
              <QuickTradePanel
                mint={tradeMint}
                name={holdings.find((h) => h.mint === tradeMint)?.name}
                symbol={holdings.find((h) => h.mint === tradeMint)?.symbol}
                imageUri={holdings.find((h) => h.mint === tradeMint)?.imageUri}
                initialSide="sell"
                onClose={() => setTradeMint(null)}
                holdings={holdings}
              />
            </section>
          ) : null}

          <section>
            <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-mute">
              Local positions (this account) · {rows.length}
            </h2>
            {rows.length === 0 ? (
              <div className="rounded border border-line bg-ink-800 p-8 text-center text-sm text-mute">
                No positions yet. Paper-trade a coin to see it here.
              </div>
            ) : (
              <>
                {/* Mobile card layout */}
                <div className="space-y-2 sm:hidden">
                  {rows.map((r) => (
                    <PositionCard
                      key={r.mint}
                      position={r}
                      onUpdate={() => void refreshLocal()}
                      onRemove={() => {
                        removePosition(accountId, r.mint);
                        void refreshLocal();
                      }}
                      onSaveMeta={(patch) => {
                        updatePositionMeta(accountId, r.mint, patch);
                        void refreshLocal();
                      }}
                    />
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto rounded border border-line sm:block">
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
                          accountId={accountId}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function HoldingRow({
  holding,
  onTrade,
  solUsd,
}: {
  holding: Holding;
  onTrade: () => void;
  solUsd: number | null;
}) {
  const value = holding.valueLamports ? new BN(holding.valueLamports) : null;
  const valueUsd = holding.valueUsd;
  const usd = valueUsd != null
    ? valueUsd
    : value && solUsd != null
      ? Number(lamportsToSol(value)) * solUsd
      : null;
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap sm:gap-3">
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
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-mute">
          {shortenAddress(holding.mint, 6, 6)}
          <CopyButton value={holding.mint} label="copy" />
          {holding.source === "unknown" ? (
            <span className="rounded bg-warn/10 px-1 py-0.5 text-[10px] text-warn">no meta</span>
          ) : null}
          {holding.isPumpCoin ? (
            <span className="rounded bg-neon/10 px-1 py-0.5 text-[10px] text-neon">pump</span>
          ) : (
            <span className="rounded bg-ink-700 px-1 py-0.5 text-[10px] text-mute">jupiter</span>
          )}
        </div>
      </div>
      <div className="text-right font-mono text-xs">
        {value ? (
          <p>
            {lamportsToSol(value)} SOL
            {usd != null ? <span className="block text-[11px] text-mute">≈ ${usd.toFixed(2)}</span> : null}
          </p>
        ) : usd != null ? (
          <p>
            ${usd.toFixed(2)}
            <span className="block text-[11px] text-mute">price feed</span>
          </p>
        ) : holding.err ? (
          <span className="text-warn" title={holding.err}>
            no quote
          </span>
        ) : (
          <span className="text-mute">…</span>
        )}
      </div>
      <button
        type="button"
        onClick={onTrade}
        disabled={usd != null && usd < MIN_HOLDING_USD_TO_TRADE}
        title={
          usd != null && usd < MIN_HOLDING_USD_TO_TRADE
            ? `Below $${MIN_HOLDING_USD_TO_TRADE.toFixed(2)} minimum — top up or sell to recoup fees first.`
            : undefined
        }
        className="shrink-0 rounded border border-line px-2 py-1 font-mono text-[11px] text-mute hover:border-neon hover:text-neon disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-mute"
      >
        Trade
      </button>
    </li>
  );
}

function PositionCard(props: {
  position: Row;
  onUpdate: () => void;
  onRemove: () => void;
  onSaveMeta: (patch: { takeProfitPct?: number | null; stopLossPct?: number | null }) => void;
}) {
  const [tp, setTP] = useState<string>(props.position.takeProfitPct == null ? "" : String(props.position.takeProfitPct));
  const [sl, setSL] = useState<string>(props.position.stopLossPct == null ? "" : String(props.position.stopLossPct));
  const cost = new BN(props.position.costLamports);
  const value = props.position.valueLamports ? new BN(props.position.valueLamports) : null;
  const pnl = value ? pnlPct(cost, value) : null;
  return (
    <article className="rounded border border-line bg-ink-800 p-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/coin/${props.position.mint}`} className="min-w-0">
          <p className="truncate font-medium">{props.position.name}</p>
          <p className="font-mono text-[11px] text-mute">{props.position.symbol} · {props.position.paper ? "paper" : "live"}</p>
        </Link>
        <div className="text-right font-mono text-xs">
          <p>{value ? `${lamportsToSol(value)} SOL` : "…"}</p>
          <p className={pnl == null ? "text-mute" : pnl >= 0 ? "text-neon" : "text-danger"}>
            {pnl == null ? "—" : pct(pnl)}
          </p>
        </div>
      </div>
      <p className="mt-2 font-mono text-[11px] text-mute">
        {tokensToUi(new BN(props.position.tokenAmountRaw), props.position.decimals)} {props.position.symbol} · cost {lamportsToSol(cost)} SOL
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block font-mono text-[10px] uppercase text-mute">TP %</span>
          <input
            className="w-full rounded border border-line bg-ink-900 px-2 py-1 font-mono text-xs"
            value={tp}
            placeholder="off"
            onChange={(e) => setTP(e.target.value)}
            onBlur={() => props.onSaveMeta({ takeProfitPct: tp.trim() ? Number(tp) : null })}
          />
        </label>
        <label className="block">
          <span className="block font-mono text-[10px] uppercase text-mute">SL %</span>
          <input
            className="w-full rounded border border-line bg-ink-900 px-2 py-1 font-mono text-xs"
            value={sl}
            placeholder="off"
            onChange={(e) => setSL(e.target.value)}
            onBlur={() => props.onSaveMeta({ stopLossPct: sl.trim() ? Number(sl) : null })}
          />
        </label>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <CopyButton value={props.position.mint} label="copy mint" />
        <button
          type="button"
          className="font-mono text-[11px] text-mute hover:text-danger"
          onClick={props.onRemove}
        >
          remove
        </button>
      </div>
    </article>
  );
}

function PositionRow({
  position,
  onUpdate,
  accountId,
}: {
  position: Row;
  onUpdate: () => void;
  accountId: string | null;
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
            updatePositionMeta(accountId, position.mint, {
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
            updatePositionMeta(accountId, position.mint, {
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
            removePosition(accountId, position.mint);
            onUpdate();
          }}
        >
          remove
        </button>
      </td>
    </tr>
  );
}
