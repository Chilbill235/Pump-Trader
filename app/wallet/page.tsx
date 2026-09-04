"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { CoinImage } from "@/components/CoinImage";
import { CopyButton } from "@/components/CopyButton";
import { useSettings } from "@/components/SettingsProvider";
import { useActiveAccountId } from "@/components/AccountsProvider";
import { useWalletData } from "@/components/WalletDataProvider";
import { getBalanceWithFallback } from "@/lib/connection";
import { loadWalletPortfolio } from "@/lib/portfolio";
import { fetchJupiterUsdPrice, getKnownTokenMeta } from "@/lib/jupiter";
import { quoteTokenToSol } from "@/lib/token-value";
import { shortenAddress, tokensToUi } from "@/lib/format";
import { notify } from "@/components/NotificationProvider";

type Holding = {
  mint: string;
  amount: number;
  decimals: number;
  uiAmount: number;
  name: string;
  symbol: string;
  imageUri?: string;
  source: "cache" | "lookup" | "unknown";
  usd: number | null;
  solValue: number | null;
  isPumpCoin: boolean;
};

export default function WalletPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const walletData = useWalletData();
  const { settings } = useSettings();
  const accountId = useActiveAccountId();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"value" | "amount" | "symbol">("value");
  const [filter, setFilter] = useState<"all" | "pump" | "jupiter">("all");
  const [search, setSearch] = useState("");
  const [hiddenDust, setHiddenDust] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  useEffect(() => {
    if (!connected || !publicKey) {
      setHoldings([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = await loadWalletPortfolio(connection, publicKey, async (mint) => {
          try {
            const res = await fetch(`/api/coins/${mint}`, { cache: "no-store" });
            const j = (await res.json()) as {
              coin: { name: string; symbol: string; imageUri?: string } | null;
            };
            return j.coin
              ? { name: j.coin.name, symbol: j.coin.symbol, imageUri: j.coin.imageUri }
              : null;
          } catch {
            return null;
          }
        });
        const enriched = list.map((t) => {
          if (t.source === "unknown") {
            const known = getKnownTokenMeta(t.mint);
            if (known) {
              return {
                ...t,
                name: known.name,
                symbol: known.symbol,
                source: "lookup" as const,
              };
            }
          }
          return t;
        });
        const usd = walletData.solUsd ?? null;
        const priced = await Promise.all(
          enriched.map(async (t) => {
            let usdValue: number | null = null;
            let solValue: number | null = null;
            let isPump = false;
            try {
              const q = await quoteTokenToSol({
                connection,
                mint: t.mint,
                tokenAmountRaw: t.amount,
                user: publicKey,
                slippagePct: settings.slippagePct,
                solUsd: usd,
              });
              if (q.usd != null) usdValue = q.usd;
              if (q.solLamports) solValue = Number(new BN(q.solLamports).toString()) / 1e9;
              isPump = q.isPumpCoin;
            } catch {
              // ignore
            }
            if (usdValue == null) {
              const prices = await fetchJupiterUsdPrice([t.mint]);
              const p = prices[t.mint];
              if (p != null && Number.isFinite(p) && Number.isFinite(t.uiAmount)) {
                usdValue = p * t.uiAmount;
              }
            }
            return {
              ...t,
              usd: usdValue,
              solValue,
              isPumpCoin: isPump,
            } satisfies Holding;
          }),
        );
        if (cancelled) return;
        setHoldings(priced);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, connected, settings.slippagePct, walletData.solUsd]);

  const visible = useMemo(() => {
    let list = holdings;
    if (filter === "pump") list = list.filter((h) => h.isPumpCoin);
    else if (filter === "jupiter") list = list.filter((h) => !h.isPumpCoin);
    if (hiddenDust) list = list.filter((h) => (h.usd ?? 0) >= 0.5);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (h) => h.symbol.toLowerCase().includes(q) || h.name.toLowerCase().includes(q) || h.mint.toLowerCase().includes(q),
      );
    }
    list = [...list].sort((a, b) => {
      if (sortBy === "value") return (b.usd ?? 0) - (a.usd ?? 0);
      if (sortBy === "amount") return b.uiAmount - a.uiAmount;
      return a.symbol.localeCompare(b.symbol);
    });
    return list;
  }, [holdings, filter, hiddenDust, search, sortBy]);

  const totals = useMemo(() => {
    let solValue = 0;
    let usd = 0;
    for (const h of visible) {
      if (h.solValue != null) solValue += h.solValue;
      if (h.usd != null) usd += h.usd;
    }
    return { solValue, usd };
  }, [visible]);

  async function copyAddress() {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 1500);
    } catch {
      // ignore
    }
  }

  async function airdropCheck() {
    if (!publicKey) return;
    try {
      const { lamports, endpoint } = await getBalanceWithFallback(connection, publicKey);
      notify({
        key: `balance:${publicKey.toBase58()}:${Math.floor(lamports / 1e7)}`,
        level: "info",
        category: "wallet",
        title: "Balance refreshed",
        body: `${(lamports / 1e9).toFixed(6)} SOL via ${new URL(endpoint).hostname}`,
      });
    } catch (err) {
      notify({
        level: "danger",
        category: "wallet",
        title: "Balance fetch failed",
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!connected) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="max-w-md rounded border border-line bg-ink-800 p-6 text-center">
          <p className="font-mono text-sm text-neon">Wallet</p>
          <p className="mt-2 text-sm text-mute">Connect your wallet to see balances, holdings, and recent activity.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-20">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg tracking-wide">Wallet</h1>
          <p className="text-xs text-mute">
            Live balances, every SPL token, USD value, and quick actions. Updates in real time via WebSocket.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={airdropCheck}
            className="touch-target press rounded border border-line bg-ink-800 px-3 py-1.5 font-mono text-xs text-mute hover:border-neon hover:text-neon"
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="rounded border border-line bg-gradient-to-br from-ink-800 to-ink-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-mute">Total balance</p>
            <p className="mt-1 font-mono text-3xl font-semibold">
              {walletData.sol != null ? walletData.sol.toFixed(4) : "—"}
              <span className="ml-1 text-base text-mute">SOL</span>
              {walletData.live ? (
                <span
                  className="ml-3 inline-block h-2 w-2 rounded-full bg-neon live-pulse align-middle"
                  title="WebSocket live"
                />
              ) : null}
            </p>
            <p className="mt-1 font-mono text-xs text-mute">
              {walletData.solUsd != null && walletData.sol != null
                ? `≈ $${(walletData.sol * walletData.solUsd).toFixed(2)} · SOL $${walletData.solUsd.toFixed(2)}`
                : "…"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <button
              type="button"
              onClick={copyAddress}
              className="press flex items-center gap-2 rounded border border-line bg-ink-800 px-3 py-1.5 font-mono text-xs text-mute hover:border-neon hover:text-neon"
            >
              {publicKey ? shortenAddress(publicKey.toBase58(), 6, 6) : "—"}
              <span aria-hidden>{copiedAddress ? "✓" : "⧉"}</span>
            </button>
            <p className="font-mono text-[11px] text-mute">
              via {walletData.endpoint ? new URL(walletData.endpoint).hostname : "…"}
            </p>
            <p className="font-mono text-[11px] text-mute">{holdings.length} SPL token{holdings.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Native" value={walletData.sol != null ? `${walletData.sol.toFixed(4)} SOL` : "—"} />
          <Stat
            label="Tokens"
            value={`${holdings.length}`}
            sub={totals.solValue > 0 ? `≈ ${totals.solValue.toFixed(4)} SOL` : undefined}
          />
          <Stat
            label="USD"
            value={walletData.solUsd != null && walletData.sol != null ? `$${((walletData.sol + totals.solValue) * walletData.solUsd).toFixed(2)}` : "—"}
          />
        </div>
      </section>

      <section className="rounded border border-line bg-ink-800">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="font-mono text-xs uppercase tracking-wide text-mute">Holdings</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="rounded border border-line bg-ink-900 px-2 py-1 font-mono text-xs"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as "all" | "pump" | "jupiter")}
              className="rounded border border-line bg-ink-900 px-2 py-1 font-mono text-xs"
            >
              <option value="all">All venues</option>
              <option value="pump">pump only</option>
              <option value="jupiter">Jupiter only</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "value" | "amount" | "symbol")}
              className="rounded border border-line bg-ink-900 px-2 py-1 font-mono text-xs"
            >
              <option value="value">Sort: value</option>
              <option value="amount">Sort: amount</option>
              <option value="symbol">Sort: name</option>
            </select>
            <label className="flex items-center gap-1 font-mono text-[11px] text-mute">
              <input
                type="checkbox"
                checked={hiddenDust}
                onChange={(e) => setHiddenDust(e.target.checked)}
                className="accent-neon"
              />
              hide &lt;$0.50
            </label>
          </div>
        </header>
        {error ? (
          <p className="p-3 text-xs text-danger">{error}</p>
        ) : loading && holdings.length === 0 ? (
          <p className="p-6 text-center text-sm text-mute">Loading holdings…</p>
        ) : visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-mute">
            {holdings.length === 0 ? "No SPL tokens found in this wallet." : "Nothing matches the filter."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((h) => (
              <HoldingRow key={h.mint} h={h} accountId={accountId} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-line/40 bg-ink-900/60 p-2">
      <p className="font-mono text-[10px] uppercase tracking-wide text-mute">{label}</p>
      <p className="mt-0.5 font-mono text-sm">{value}</p>
      {sub ? <p className="font-mono text-[10px] text-mute">{sub}</p> : null}
    </div>
  );
}

function HoldingRow({ h, accountId }: { h: Holding; accountId: string | null }) {
  const sym = h.symbol || shortenAddress(h.mint, 4, 4);
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap sm:gap-3">
      <CoinImage src={h.imageUri ?? null} alt={sym} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link
            href={`/coin/${h.mint}`}
            className="truncate font-medium hover:text-neon"
          >
            {h.name}
          </Link>
          <span className="font-mono text-xs text-mute">{sym}</span>
          <span className="font-mono text-[11px] text-mute">
            {tokensToUi(new BN(Math.round(h.amount)), h.decimals)} {sym}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-mute">
          {shortenAddress(h.mint, 6, 6)}
          <CopyButton value={h.mint} label="copy" />
          {h.source === "unknown" ? (
            <span className="rounded bg-warn/10 px-1 py-0.5 text-[10px] text-warn">no meta</span>
          ) : null}
          {h.isPumpCoin ? (
            <span className="rounded bg-neon/10 px-1 py-0.5 text-[10px] text-neon">pump</span>
          ) : (
            <span className="rounded bg-ink-700 px-1 py-0.5 text-[10px] text-mute">jupiter</span>
          )}
        </div>
      </div>
      <div className="text-right font-mono text-xs">
        {h.usd != null ? (
          <p>
            ${h.usd.toFixed(2)}
            {h.solValue != null ? (
              <span className="block text-[11px] text-mute">{h.solValue.toFixed(4)} SOL</span>
            ) : null}
          </p>
        ) : (
          <span className="text-mute">no price</span>
        )}
      </div>
      <Link
        href={`/coin/${h.mint}${accountId ? `?acct=${accountId}` : ""}`}
        className="touch-target press shrink-0 rounded border border-line bg-ink-800 px-3 py-1.5 font-mono text-[11px] text-mute hover:border-neon hover:text-neon"
      >
        Trade
      </Link>
    </li>
  );
}

void PublicKey;
