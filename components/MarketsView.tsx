"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PumpCoin } from "@/lib/types";
import { compactNumber, formatUsd, shortenAddress, timeAgo } from "@/lib/format";
import { CoinImage } from "./CoinImage";
import { CopyButton } from "./CopyButton";
import { QuickTradePanel } from "./QuickTradePanel";
import { MobileTradeSheet } from "./MobileTradeSheet";
import { useWalletData } from "./WalletDataProvider";

type Kind = "trending" | "newest";

export function MarketsView() {
  const [kind, setKind] = useState<Kind>("trending");
  const [q, setQ] = useState("");
  const [coins, setCoins] = useState<PumpCoin[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeMint, setActiveMint] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const { holdings } = useWalletData();
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const load = useCallback(async (nextKind: Kind, nextQ: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextQ.trim()) params.set("q", nextQ.trim());
      else params.set("kind", nextKind);
      const res = await fetch(`/api/coins?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as {
        coins?: PumpCoin[];
        source?: string | null;
        error?: string;
      };
      if (!res.ok || json.error) {
        setCoins(json.coins ?? []);
        setSource(json.source ?? null);
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      setCoins(json.coins ?? []);
      setSource(json.source ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCoins([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(kind, q);
  }, [kind, load, q]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (/^[1-9A-HJ-NP-Za-kmz2-9]{32,44}$/.test(term)) {
      router.push(`/coin/${term}`);
      return;
    }
    void load(kind, term);
  }

  const activeCoin = useMemo(
    () => coins.find((c) => c.mint === activeMint) ?? null,
    [coins, activeMint],
  );

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-2xl border border-line-soft bg-gradient-to-br from-ink-800 via-ink-850 to-ink-900 p-4 shadow-card sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-neon/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-info/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-neon">Markets</p>
            <h1 className="mt-1 font-mono text-2xl tracking-wide">
              <span className="text-gradient">pump.fun</span>{" "}
              <span className="text-white">trending</span>
            </h1>
            <p className="mt-1 max-w-xl text-sm text-mute">
              Honest buy/sell client. Not a sniper. Click any row to trade. Simulate mode is on by
              default.
            </p>
          </div>
          <form onSubmit={onSearch} className="flex w-full gap-2 sm:w-auto">
            <div className="relative flex-1 sm:w-80 sm:flex-none">
              <span
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="7" cy="7" r="4.5" />
                  <path d="M10.5 10.5l3 3" strokeLinecap="round" />
                </svg>
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Paste mint, search name or ticker"
                className="w-full rounded-lg border border-line bg-ink-900/80 pl-9 pr-3 py-2 font-mono text-sm text-white outline-none transition-colors placeholder:text-mute-2 focus:border-neon"
              />
            </div>
            <button
              type="submit"
              className="press rounded-lg border border-neon/40 bg-neon/10 px-3 py-2 font-mono text-xs font-semibold text-neon hover:bg-neon/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon"
            >
              Open
            </button>
          </form>
        </div>

        <div className="relative mt-4 flex flex-wrap items-center gap-2">
          {(["trending", "newest"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setQ("");
                setKind(k);
              }}
              className={`press relative rounded-md border px-3 py-1 font-mono text-xs uppercase tracking-wide ${
                kind === k && !q
                  ? "border-neon text-neon shadow-[inset_0_0_0_1px_rgba(57,255,136,0.3)]"
                  : "border-line text-mute hover:border-neon/60 hover:text-white"
              }`}
            >
              {k}
            </button>
          ))}
          {coins.length > 0 ? (
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-mute sm:gap-2">
              <span className="rounded border border-line bg-ink-900/60 px-2 py-0.5">
                {coins.length} coins
              </span>
              {source ? (
                <span className="truncate rounded border border-line bg-ink-900/60 px-2 py-0.5">
                  {source.startsWith("https://") ? source.replace(/^https?:\/\//, "").split("/")[0] : source}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <p className="font-mono font-semibold">Markets API error</p>
          <p className="mt-1 font-mono text-xs text-mute">{error}</p>
          <p className="mt-2 text-xs text-mute">
            Paste a mint above and press Open — on-chain quotes still work without the HTTP list.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="overflow-hidden rounded-xl border border-line-soft bg-ink-900/60 shadow-card">
          {loading ? <MarketsSkeleton /> : coins.length === 0 && !error ? (
            <EmptyMarkets />
          ) : (
            <>
              {/* Mobile cards */}
              <ul className="divide-y divide-line-soft sm:hidden">
                {coins.map((c) => {
                  const active = activeMint === c.mint;
                  return (
                    <li
                      key={c.mint}
                      onClick={() => setActiveMint(c.mint)}
                      className={`relative flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors ${
                        active
                          ? "border-l-2 border-l-neon bg-neon/10 pl-[calc(0.75rem-2px)]"
                          : "border-l-2 border-l-transparent hover:bg-ink-800/80 active:bg-ink-800"
                      }`}
                    >
                      <CoinImage src={c.imageUri ?? null} alt={c.symbol} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{c.name}</p>
                          <span className="font-mono text-[11px] text-mute-2">${c.symbol}</span>
                        </div>
                        <p className="truncate font-mono text-[11px] text-mute">
                          {formatUsd(c.usdMarketCap ?? null)} ·{" "}
                          {c.lastTradeAt
                            ? timeAgo(c.lastTradeAt)
                            : c.createdAt
                              ? timeAgo(c.createdAt)
                              : "—"}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                          c.complete
                            ? "border-warn/40 bg-warn/5 text-warn"
                            : "border-neon/40 bg-neon/5 text-neon"
                        }`}
                      >
                        {c.complete ? "grad" : "curve"}
                      </span>
                      <span aria-hidden className="shrink-0 text-mute-2">›</span>
                    </li>
                  );
                })}
              </ul>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-ink-850/80 font-mono text-[10px] uppercase tracking-widest text-mute backdrop-blur">
                    <tr>
                      <th className="px-3 py-2.5">Coin</th>
                      <th className="hidden px-3 py-2.5 lg:table-cell">Mint</th>
                      <th className="px-3 py-2.5 text-right">MC USD</th>
                      <th className="hidden px-3 py-2.5 text-right md:table-cell">MC SOL</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="hidden px-3 py-2.5 md:table-cell">Last</th>
                      <th className="px-2 py-2.5 text-right"><span className="sr-only">Trade</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {coins.map((c) => {
                      const active = activeMint === c.mint;
                      return (
                        <tr
                          key={c.mint}
                          className={`group relative cursor-pointer border-t border-line-soft/40 transition-colors ${
                            active
                              ? "bg-neon/10"
                              : "hover:bg-ink-800/60"
                          }`}
                          onClick={() => setActiveMint(c.mint)}
                        >
                          <td
                            className={`relative px-3 py-2.5 ${
                              active ? "border-l-2 border-l-neon" : "border-l-2 border-l-transparent"
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <CoinImage src={c.imageUri ?? null} alt={c.symbol} size={30} />
                              <div className="min-w-0">
                                <div className="truncate font-medium">{c.name}</div>
                                <div className="font-mono text-[11px] text-mute-2">${c.symbol}</div>
                              </div>
                            </div>
                          </td>
                          <td className="hidden px-3 py-2.5 lg:table-cell">
                            <div className="flex items-center gap-1.5 font-mono text-xs">
                              <span className="text-mute">{shortenAddress(c.mint, 6, 6)}</span>
                              <CopyButton value={c.mint} label="copy" />
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs">
                            {formatUsd(c.usdMarketCap ?? null)}
                          </td>
                          <td className="hidden px-3 py-2.5 text-right font-mono text-xs md:table-cell">
                            {c.marketCapSol != null ? compactNumber(c.marketCapSol) : "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            {c.complete ? (
                              <span className="rounded border border-warn/40 bg-warn/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-warn">
                                graduated
                              </span>
                            ) : (
                              <span className="rounded border border-neon/40 bg-neon/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-neon">
                                curve
                              </span>
                            )}
                          </td>
                          <td className="hidden px-3 py-2.5 font-mono text-[11px] text-mute md:table-cell">
                            {c.lastTradeAt
                              ? timeAgo(c.lastTradeAt)
                              : c.createdAt
                                ? timeAgo(c.createdAt)
                                : "—"}
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMint(c.mint);
                              }}
                              className={`press inline-flex h-8 items-center gap-1 rounded-md border px-2.5 font-mono text-[11px] font-semibold transition-colors ${
                                active
                                  ? "border-neon/60 bg-neon/15 text-neon"
                                  : "border-line bg-ink-850 text-mute hover:border-neon hover:bg-neon/10 hover:text-neon"
                              }`}
                              aria-label={`Trade ${c.name} (${c.symbol})`}
                            >
                              Trade
                              <span aria-hidden>›</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Desktop inline panel */}
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
          {activeMint ? (
            activeCoin ? (
              <QuickTradePanel
                mint={activeMint}
                name={activeCoin.name}
                symbol={activeCoin.symbol}
                imageUri={activeCoin.imageUri}
                onClose={() => setActiveMint(null)}
                holdings={holdings}
              />
            ) : (
              <QuickTradePanel
                mint={activeMint}
                onClose={() => setActiveMint(null)}
                holdings={holdings}
              />
            )
          ) : (
            <div className="rounded-xl border border-dashed border-line bg-ink-900/60 p-6 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-line bg-ink-850 text-mute">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M2 13l4-4 3 2 4-6 3 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="mt-3 font-mono text-sm">Pick a coin to start</p>
              <p className="mt-1 text-[11px] text-mute-2">
                Click any row in the markets list — or paste a mint above — to open the trade
                panel.
              </p>
            </div>
          )}
          {activeCoin ? (
            <div className="mt-3 text-right">
              <Link
                href={`/coin/${activeCoin.mint}`}
                className="press inline-flex items-center gap-1 rounded border border-line bg-ink-900 px-3 py-1.5 font-mono text-[11px] text-mute hover:border-neon hover:text-neon"
              >
                Open full coin page
                <span aria-hidden>↗</span>
              </Link>
            </div>
          ) : null}
        </aside>
      </div>

      {/* Mobile bottom sheet (pops up over the list) */}
      <MobileTradeSheet
        open={!!activeMint && isMobile}
        onClose={() => setActiveMint(null)}
        mint={activeMint}
        name={activeCoin?.name}
        symbol={activeCoin?.symbol}
        imageUri={activeCoin?.imageUri}
        holdings={holdings}
      />
    </div>
  );
}

function MarketsSkeleton() {
  return (
    <div className="divide-y divide-line/40">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <div className="h-9 w-9 shrink-0 rounded-full skeleton" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/3 rounded skeleton" />
            <div className="h-2.5 w-1/2 rounded skeleton" />
          </div>
          <div className="h-4 w-12 rounded skeleton" />
        </div>
      ))}
    </div>
  );
}

function EmptyMarkets() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-ink-850 text-mute">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <circle cx="9" cy="9" r="6" />
          <path d="M13.5 13.5L17 17" strokeLinecap="round" />
        </svg>
      </div>
      <p className="font-mono text-sm">No coins returned</p>
      <p className="max-w-sm text-[11px] text-mute-2">
        Paste a mint above to load it directly via on-chain. Public RPCs are rate-limited — set a
        private one in Settings for the full list.
      </p>
    </div>
  );
}
