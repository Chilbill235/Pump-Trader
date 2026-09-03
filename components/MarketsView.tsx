"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PumpCoin } from "@/lib/types";
import { compactNumber, formatUsd, shortenAddress, timeAgo } from "@/lib/format";
import { CoinImage } from "./CoinImage";
import { CopyButton } from "./CopyButton";
import { QuickTradePanel } from "./QuickTradePanel";

type Kind = "trending" | "newest";

export function MarketsView() {
  const [kind, setKind] = useState<Kind>("trending");
  const [q, setQ] = useState("");
  const [coins, setCoins] = useState<PumpCoin[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeMint, setActiveMint] = useState<string | null>(null);

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
    void load(kind, "");
  }, [kind, load]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (/^[1-9A-HJ-NP-Za-kmz2-9]{32,44}$/.test(term)) {
      setActiveMint(term);
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg tracking-wide">Markets</h1>
          <p className="text-xs text-mute">
            Honest buy/sell client. Not a sniper. Click any row to trade. Simulate mode is on by default.
          </p>
        </div>
        <form onSubmit={onSearch} className="flex w-full gap-2 sm:w-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Paste mint, search name / ticker"
            className="w-full rounded border border-line bg-ink-800 px-3 py-1.5 font-mono text-sm outline-none focus:border-neon sm:w-80"
          />
          <button
            type="submit"
            className="rounded bg-neon px-3 py-1.5 font-mono text-xs text-ink-950"
          >
            Open
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["trending", "newest"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setQ("");
              setKind(k);
            }}
            className={`rounded border px-3 py-1 font-mono text-xs uppercase ${
              kind === k && !q
                ? "border-neon text-neon"
                : "border-line text-mute"
            }`}
          >
            {k}
          </button>
        ))}
        {coins.length > 0 ? (
          <span className="ml-auto font-mono text-[11px] text-mute">
            {coins.length} coins · click any row to trade
          </span>
        ) : null}
      </div>

      {source ? (
        <p className="truncate font-mono text-[11px] text-mute">source: {source}</p>
      ) : null}
      {error ? (
        <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <div className="font-medium">Markets API error</div>
          <p className="mt-1 font-mono text-xs">{error}</p>
          <p className="mt-2 text-xs text-mute">
            Paste a mint above and press Open — on-chain quotes still work without the HTTP list.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded border border-line">
          {loading ? (
            <div className="p-8 text-center text-sm text-mute">Loading coins…</div>
          ) : coins.length === 0 && !error ? (
            <div className="p-8 text-center text-sm text-mute">
              No coins returned. Paste a mint above.
            </div>
          ) : (
            <>
              {/* Mobile cards */}
              <ul className="divide-y divide-line sm:hidden">
                {coins.map((c) => {
                  const active = activeMint === c.mint;
                  return (
                    <li
                      key={c.mint}
                      onClick={() => setActiveMint(c.mint)}
                      className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${
                        active ? "bg-neon/10" : "hover:bg-ink-800/80"
                      }`}
                    >
                      <CoinImage src={c.imageUri ?? null} alt={c.symbol} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{c.name}</p>
                        <p className="truncate font-mono text-[11px] text-mute">
                          {c.symbol} · {formatUsd(c.usdMarketCap ?? null)}
                        </p>
                      </div>
                      <span
                        className={`font-mono text-[11px] ${
                          c.complete ? "text-warn" : "text-neon"
                        }`}
                      >
                        {c.complete ? "grad" : "curve"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-ink-800 font-mono text-[11px] uppercase text-mute">
                    <tr>
                      <th className="px-3 py-2">Coin</th>
                      <th className="px-3 py-2">Mint</th>
                      <th className="px-3 py-2">MC USD</th>
                      <th className="px-3 py-2">MC SOL</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Last</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {coins.map((c) => {
                      const active = activeMint === c.mint;
                      return (
                        <tr
                          key={c.mint}
                          className={`cursor-pointer border-t border-line transition ${
                            active ? "bg-neon/10" : "hover:bg-ink-800/80"
                          }`}
                          onClick={() => setActiveMint(c.mint)}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <CoinImage src={c.imageUri ?? null} alt={c.symbol} size={28} />
                              <div>
                                <div className="font-medium">{c.name}</div>
                                <div className="font-mono text-[11px] text-mute">{c.symbol}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2 font-mono text-xs">
                              {shortenAddress(c.mint, 6, 6)}
                              <CopyButton value={c.mint} label="copy" />
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {formatUsd(c.usdMarketCap ?? null)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {c.marketCapSol != null ? compactNumber(c.marketCapSol) : "—"}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px]">
                            {c.complete ? (
                              <span className="text-warn">graduated</span>
                            ) : (
                              <span className="text-neon">curve</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-mute">
                            {c.lastTradeAt ? timeAgo(c.lastTradeAt) : c.createdAt ? timeAgo(c.createdAt) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              className="rounded bg-neon/10 px-2 py-1 font-mono text-[11px] text-neon hover:bg-neon/20"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMint(c.mint);
                              }}
                            >
                              Trade
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

        <aside className="lg:sticky lg:top-20 lg:self-start">
          {activeMint ? (
            activeCoin ? (
              <QuickTradePanel
                mint={activeMint}
                name={activeCoin.name}
                symbol={activeCoin.symbol}
                imageUri={activeCoin.imageUri}
                onClose={() => setActiveMint(null)}
              />
            ) : (
              <QuickTradePanel mint={activeMint} onClose={() => setActiveMint(null)} />
            )
          ) : (
            <div className="rounded border border-dashed border-line bg-ink-800 p-6 text-center text-sm text-mute">
              <p className="font-medium">Pick a coin to start.</p>
              <p className="mt-1 font-mono text-[11px]">
                Click any row in the markets list (or paste a mint above) to open the trade panel
                without the extra click.
              </p>
            </div>
          )}
          {activeCoin ? (
            <div className="mt-3 text-right">
              <Link
                href={`/coin/${activeCoin.mint}`}
                className="font-mono text-[11px] text-mute underline hover:text-neon"
              >
                Open full coin page →
              </Link>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}