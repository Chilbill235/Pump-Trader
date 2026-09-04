"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { CoinImage } from "@/components/CoinImage";
import { CopyButton } from "@/components/CopyButton";
import { useSettings } from "@/components/SettingsProvider";
import { useActiveAccountId } from "@/components/AccountsProvider";
import { useWalletData } from "@/components/WalletDataProvider";
import { loadWalletPortfolio } from "@/lib/portfolio";
import { fetchJupiterUsdPrice, getKnownTokenMeta } from "@/lib/jupiter";
import { quoteTokenToSol } from "@/lib/token-value";
import { compactNumber, shortenAddress, tokensToUi } from "@/lib/format";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { detectFromAdapters, type DetectedWallet } from "@/lib/wallet-detect";
import { isMobileDevice } from "@/lib/mobile";
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

type SortKey = "value" | "amount" | "name";
type FilterKey = "all" | "pump" | "jupiter";

export default function WalletPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, connected, wallet: walletAdapter } = wallet;
  const walletData = useWalletData();
  const { settings } = useSettings();
  const accountId = useActiveAccountId();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("value");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [hiddenDust, setHiddenDust] = useState(false);

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
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled) {
          setError(msg);
          notify({
            level: "danger",
            category: "wallet",
            title: "Could not load wallet tokens",
            body: friendlyRpcError(msg),
          });
        }
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
    let knownUsd = 0;
    let knownCount = 0;
    for (const h of visible) {
      if (h.solValue != null) solValue += h.solValue;
      if (h.usd != null) {
        usd += h.usd;
        knownUsd += h.usd;
        knownCount += 1;
      }
    }
    return { solValue, usd, knownUsd, knownCount };
  }, [visible]);

  if (!connected) {
    return <ConnectScreen />;
  }

  return (
    <div className="space-y-4 pb-20">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-neon">Wallet</p>
          <h1 className="mt-1 font-mono text-2xl tracking-wide">Your holdings</h1>
          <p className="mt-1 text-xs text-mute">
            Live balances, every SPL token, USD value, and quick actions. Updates in real time via WebSocket.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ConnectWalletButton />
        </div>
      </header>

      <BalanceCard
        sol={walletData.sol}
        solUsd={walletData.solUsd}
        holdingsCount={holdings.length}
        totals={totals}
        live={walletData.live}
        endpoint={walletData.endpoint}
        address={publicKey?.toBase58() ?? ""}
        walletName={walletAdapter?.adapter?.name ?? "Wallet"}
        onRefresh={() => walletData.refresh()}
        onNotifyError={() =>
          notify({
            level: "danger",
            category: "wallet",
            title: "Refresh failed",
            body: error ?? "Unknown error",
          })
        }
      />

      <HoldingsPanel
        error={error}
        loading={loading}
        holdings={holdings}
        visible={visible}
        search={search}
        setSearch={setSearch}
        filter={filter}
        setFilter={setFilter}
        sortBy={sortBy}
        setSortBy={setSortBy}
        hiddenDust={hiddenDust}
        setHiddenDust={setHiddenDust}
        accountId={accountId}
      />
    </div>
  );
}

function ConnectScreen() {
  const { wallets: adapterWallets } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const isMobile = useMemo(() => (mounted ? isMobileDevice() : false), [mounted]);

  useEffect(() => {
    setMounted(true);
    setWallets(detectFromAdapters(adapterWallets));
  }, [adapterWallets]);

  const installed = wallets.filter((w) => w.installed);
  const installable = wallets.filter((w) => !w.installed);

  return (
    <div className="grid min-h-[70vh] place-items-center px-2 pb-20">
      <div className="w-full max-w-lg space-y-5 rounded-2xl border border-line bg-gradient-to-br from-ink-800 to-ink-900 p-6 shadow-2xl">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-ink-900 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-neon live-pulse" />
            Local · Encrypted · No server
          </span>
          <h1 className="mt-3 font-mono text-2xl tracking-widest text-neon">CONNECT WALLET</h1>
          <p className="mt-2 text-sm text-mute">
            We never see your keys. Pick a wallet to start trading. Your bot, positions, and settings
            stay on this device.
          </p>
        </div>

        <div className="rounded-xl border border-line bg-ink-900 p-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-widest text-mute">Detected on this device</p>
            <ConnectWalletButton />
          </div>
          {mounted && installed.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {installed.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between rounded-lg border border-neon/30 bg-neon/5 px-3 py-2"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span
                      aria-hidden
                      className="flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] font-bold text-white"
                      style={{
                        background:
                          w.id === "phantom"
                            ? "#ab9ff2"
                            : w.id === "solflare"
                            ? "#ffa133"
                            : w.id === "trust"
                            ? "#3375bb"
                            : "#0052ff",
                      }}
                    >
                      {w.id === "phantom" ? "P" : w.id === "solflare" ? "S" : w.id === "trust" ? "T" : "C"}
                    </span>
                    <span>{w.name}</span>
                  </span>
                  <span className="rounded bg-neon/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-neon">
                    {w.inApp ? "in-app" : "installed"}
                  </span>
                </li>
              ))}
            </ul>
          ) : mounted ? (
            <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
              No wallet detected on this browser. {isMobile ? "Open this URL inside your wallet's browser." : "Install one to continue."}
            </p>
          ) : null}
        </div>

        {mounted && installable.length > 0 ? (
          <div className="rounded-xl border border-line bg-ink-900 p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-mute">
              {isMobile ? "Open in a wallet app" : "Install a wallet"}
            </p>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {installable.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (w.deeplink) {
                        window.location.href = w.deeplink;
                      } else {
                        window.open(w.installUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                    className="press flex w-full items-center justify-between rounded-lg border border-line bg-ink-800 px-3 py-2 text-left hover:border-neon"
                  >
                    <span className="text-sm">{w.name}</span>
                    <span className="font-mono text-[10px] uppercase text-mute">
                      {w.deeplink ? "open" : "install"} ↗
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-center text-[11px] text-mute">
          Not financial advice. Most pump.fun coins go to zero.
        </p>
      </div>
    </div>
  );
}

function BalanceCard(props: {
  sol: number | null;
  solUsd: number | null;
  holdingsCount: number;
  totals: { solValue: number; usd: number; knownUsd: number; knownCount: number };
  live: boolean;
  endpoint: string | null;
  address: string;
  walletName: string;
  onRefresh: () => void;
  onNotifyError: () => void;
}) {
  const totalUsd =
    props.sol != null && props.solUsd != null
      ? (props.sol + props.totals.solValue) * props.solUsd
      : null;
  const known = props.totals.knownUsd > 0 && props.totals.knownCount > 0;
  const stale = props.totals.knownCount < props.holdingsCount;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 p-5 shadow-2xl">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(57,255,136,0.5), transparent 70%)" }}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-mute">Total balance</p>
            {props.live ? (
              <span className="inline-flex items-center gap-1 rounded bg-neon/10 px-1.5 py-0.5 font-mono text-[10px] text-neon">
                <span className="h-1.5 w-1.5 rounded-full bg-neon live-pulse" />
                live
              </span>
            ) : null}
          </div>
          <p className="mt-2 font-mono text-4xl font-semibold tracking-tight">
            {props.sol != null ? props.sol.toFixed(4) : "—"}
            <span className="ml-2 text-base text-mute">SOL</span>
          </p>
          <p className="mt-1 font-mono text-sm text-mute">
            {totalUsd != null ? `≈ $${totalUsd.toFixed(2)}` : "…"}
            {props.solUsd != null ? <span className="ml-2 text-[11px] text-mute">· SOL ${props.solUsd.toFixed(2)}</span> : null}
          </p>
          {stale ? (
            <p className="mt-1 font-mono text-[10px] text-warn">
              {props.totals.knownCount}/{props.holdingsCount} priced
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={props.onRefresh}
            className="press rounded border border-line bg-ink-800 px-3 py-1.5 font-mono text-[11px] text-mute hover:border-neon hover:text-neon"
            title="Refresh"
          >
            ↻ Refresh
          </button>
          <div className="flex items-center gap-1 font-mono text-[11px] text-mute">
            <span className="truncate">{shortenAddress(props.address, 4, 4)}</span>
            <CopyButton value={props.address} label="copy" />
          </div>
          <p className="font-mono text-[10px] text-mute">via {props.walletName}</p>
          {props.endpoint ? (
            <p className="font-mono text-[10px] text-mute">rpc {new URL(props.endpoint).hostname}</p>
          ) : null}
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-3 gap-2">
        <Stat label="SOL" value={props.sol != null ? `${props.sol.toFixed(4)}` : "—"} />
        <Stat
          label="Tokens"
          value={`${props.holdingsCount}`}
          sub={props.totals.solValue > 0 ? `≈ ${props.totals.solValue.toFixed(4)} SOL` : undefined}
        />
        <Stat
          label="USD"
          value={totalUsd != null ? `$${compactNumber(totalUsd)}` : "—"}
          sub={known ? `${props.totals.knownCount} priced` : "pricing…"}
        />
      </div>
    </section>
  );
}

function HoldingsPanel(props: {
  error: string | null;
  loading: boolean;
  holdings: Holding[];
  visible: Holding[];
  search: string;
  setSearch: (v: string) => void;
  filter: FilterKey;
  setFilter: (v: FilterKey) => void;
  sortBy: SortKey;
  setSortBy: (v: SortKey) => void;
  hiddenDust: boolean;
  setHiddenDust: (v: boolean) => void;
  accountId: string | null;
}) {
  return (
    <section className="rounded-2xl border border-line bg-ink-800">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-mute">Holdings</h2>
          <p className="mt-0.5 font-mono text-[11px] text-mute">
            {props.holdings.length} SPL token{props.holdings.length === 1 ? "" : "s"} · tap to trade
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={props.search}
            onChange={(e) => props.setSearch(e.target.value)}
            placeholder="Search…"
            className="w-32 rounded border border-line bg-ink-900 px-2 py-1 font-mono text-xs sm:w-40"
          />
          <select
            value={props.filter}
            onChange={(e) => props.setFilter(e.target.value as FilterKey)}
            className="rounded border border-line bg-ink-900 px-2 py-1 font-mono text-xs"
          >
            <option value="all">All venues</option>
            <option value="pump">pump only</option>
            <option value="jupiter">Jupiter only</option>
          </select>
          <select
            value={props.sortBy}
            onChange={(e) => props.setSortBy(e.target.value as SortKey)}
            className="rounded border border-line bg-ink-900 px-2 py-1 font-mono text-xs"
          >
            <option value="value">Sort: value</option>
            <option value="amount">Sort: amount</option>
            <option value="name">Sort: name</option>
          </select>
          <label className="flex items-center gap-1 font-mono text-[11px] text-mute">
            <input
              type="checkbox"
              checked={props.hiddenDust}
              onChange={(e) => props.setHiddenDust(e.target.checked)}
              className="accent-neon"
            />
            hide &lt;$0.50
          </label>
        </div>
      </header>
      {props.error ? (
        <div className="m-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          <p className="font-mono text-[10px] uppercase tracking-widest">Wallet load failed</p>
          <p className="mt-1 break-words">{friendlyRpcError(props.error)}</p>
          <Link
            href="/settings"
            className="press mt-2 inline-block rounded border border-danger/40 bg-danger/5 px-2 py-1 font-mono text-[11px] text-danger hover:bg-danger/15"
          >
            Open Settings →
          </Link>
        </div>
      ) : props.loading && props.holdings.length === 0 ? (
        <HoldingsSkeleton />
      ) : props.visible.length === 0 ? (
        <EmptyState hasHoldings={props.holdings.length > 0} />
      ) : (
        <ul className="divide-y divide-line">
          {props.visible.map((h) => (
            <HoldingRow key={h.mint} h={h} accountId={props.accountId} />
          ))}
        </ul>
      )}
      <footer className="border-t border-line/60 px-4 py-2 font-mono text-[10px] text-mute">
        Pump.fun bonding-curve / pump-amm coins use the pump program. Everything else (USDC, BONK,
        JUP, memecoins) routes through Jupiter using any token in your wallet with enough balance.
        Trades under $1 USD are disabled.
      </footer>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line/40 bg-ink-900/60 p-2.5">
      <p className="font-mono text-[10px] uppercase tracking-wide text-mute">{label}</p>
      <p className="mt-0.5 font-mono text-sm">{value}</p>
      {sub ? <p className="font-mono text-[10px] text-mute">{sub}</p> : null}
    </div>
  );
}

function HoldingsSkeleton() {
  return (
    <ul className="divide-y divide-line">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-8 w-8 animate-pulse rounded-full bg-ink-700" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-ink-700" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-ink-700" />
          </div>
          <div className="h-4 w-16 animate-pulse rounded bg-ink-700" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ hasHoldings }: { hasHoldings: boolean }) {
  return (
    <div className="grid place-items-center px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-ink-900 font-mono text-2xl text-mute">
        ∅
      </div>
      <p className="mt-3 font-mono text-sm text-mute">
        {hasHoldings ? "Nothing matches the filter." : "No SPL tokens in this wallet yet."}
      </p>
      <p className="mt-1 text-[11px] text-mute">
        {hasHoldings ? "Try clearing filters above." : "Buy a coin from the Markets tab to get started."}
      </p>
    </div>
  );
}

function HoldingRow({ h, accountId }: { h: Holding; accountId: string | null }) {
  const sym = h.symbol || shortenAddress(h.mint, 4, 4);
  const tradeHref = `/coin/${h.mint}${accountId ? `?acct=${accountId}` : ""}`;
  const tradable = (h.usd ?? 0) >= 1;
  return (
    <li className="group">
      <Link
        href={tradable ? tradeHref : "#"}
        aria-disabled={!tradable}
        onClick={(e) => {
          if (!tradable) e.preventDefault();
        }}
        className={`press flex flex-wrap items-center gap-2 px-4 py-3 sm:flex-nowrap sm:gap-3 ${
          tradable ? "hover:bg-ink-700/50" : "opacity-60"
        }`}
      >
        <CoinImage src={h.imageUri ?? null} alt={sym} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="truncate font-medium group-hover:text-neon">{h.name}</span>
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
            {!tradable ? (
              <span className="rounded bg-warn/10 px-1 py-0.5 text-[10px] text-warn">min $1 to trade</span>
            ) : null}
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
        <span
          className={`touch-target press shrink-0 rounded border px-3 py-1.5 font-mono text-[11px] ${
            tradable
              ? "border-line bg-ink-800 text-mute group-hover:border-neon group-hover:text-neon"
              : "border-line/40 bg-ink-900 text-mute/60"
          }`}
        >
          {tradable ? "Trade →" : "Trade"}
        </span>
      </Link>
    </li>
  );
}

function friendlyRpcError(msg: string): string {
  if (/403|API key/i.test(msg)) {
    return "Public RPCs are rate-limited. Set a private RPC in Settings (NEXT_PUBLIC_SOLANA_RPC_URL or Helius/QuickNet/Triton). Verify holdings on Solscan.";
  }
  if (/429|rate limit/i.test(msg)) {
    return "RPC rate-limited. Add a private RPC in Settings or wait a minute.";
  }
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}
