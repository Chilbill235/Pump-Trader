import type { PumpCoin } from "./types";

export type CoinMomentum = {
  mint: string;
  symbol: string;
  name: string;
  imageUri?: string;
  /** Pumped mcap or trade-count growth in last sample window. */
  deltaMcSol: number;
  deltaPct: number;
  /** Recent trade count from `last_trade_timestamp` density. */
  recentTrades: number;
  /** Pump-like short-window classifier score. */
  score: number;
  /** Last seen at. */
  seenAt: number;
};

const WINDOW_MS = 90_000;

type Sample = { mcSol: number | null; trades: number; ts: number };

const samples = new Map<string, { coin: PumpCoin; samples: Sample[] }>();

export function recordMomentumSample(coins: PumpCoin[]): CoinMomentum[] {
  const now = Date.now();
  for (const c of coins) {
    const mcSol =
      c.marketCapSol != null && Number.isFinite(c.marketCapSol)
        ? c.marketCapSol
        : c.usdMarketCap != null && Number.isFinite(c.usdMarketCap)
          ? c.usdMarketCap / 200 // rough fallback when only USD is present
          : null;
    const trades = c.lastTradeAt && now - c.lastTradeAt <= 5 * 60_000 ? 1 : 0;
    const entry = samples.get(c.mint);
    if (!entry) {
      samples.set(c.mint, { coin: c, samples: [{ mcSol, trades, ts: now }] });
      continue;
    }
    entry.coin = c;
    entry.samples.push({ mcSol, trades, ts: now });
    entry.samples = entry.samples.filter((s) => now - s.ts <= WINDOW_MS);
  }

  const out: CoinMomentum[] = [];
  for (const [mint, { coin, samples: list }] of samples) {
    if (!list.length) continue;
    const first = list[0];
    const last = list[list.length - 1];
    const recentTrades = list.reduce((s, x) => s + x.trades, 0);
    if (!first.mcSol || !last.mcSol) continue;
    const deltaMcSol = last.mcSol - first.mcSol;
    const deltaPct = first.mcSol > 0 ? (deltaMcSol / first.mcSol) * 100 : 0;
    // Heuristic pump score: relative growth + recent trade density
    const score = clamp01(
      0.5 * Math.min(1, Math.abs(deltaPct) / 30) + 0.5 * Math.min(1, recentTrades / 5),
    );
    out.push({
      mint,
      symbol: coin.symbol,
      name: coin.name,
      imageUri: coin.imageUri,
      deltaMcSol,
      deltaPct,
      recentTrades,
      score,
      seenAt: now,
    });
  }

  return out
    .filter((m) => m.deltaPct > 5 && m.score > 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

export function clearMomentum(): void {
  samples.clear();
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}