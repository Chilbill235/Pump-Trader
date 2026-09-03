import { fetchCoinList, fetchCoinMeta, normalizeCoin, pumpGet } from "./pump-api";
import type { PumpCoin } from "./types";

function needle(s: string): string {
  return s.trim().toLowerCase();
}

export async function searchCoins(term: string): Promise<{
  coins: PumpCoin[];
  source: string;
}> {
  const raw = term.trim();
  if (!raw) return fetchCoinList("trending");

  const looksLikeMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw);
  if (looksLikeMint) {
    const meta = await fetchCoinMeta(raw);
    if (meta.coin) return { coins: [meta.coin], source: meta.source ?? "mint" };
  }

  try {
    const { data, source } = await pumpGet(
      `/coins?offset=0&limit=50&sort=market_cap&order=DESC&includeNsfw=false`,
    );
    const one = Array.isArray(data) ? null : normalizeCoin(data);
    const listed = [
      ...(Array.isArray(data) ? data.map(normalizeCoin) : []),
      one,
    ].filter((c): c is PumpCoin => c !== null);
    const n = needle(raw);
    const hits = listed.filter(
      (c) =>
        c.mint.toLowerCase().includes(n) ||
        c.name.toLowerCase().includes(n) ||
        c.symbol.toLowerCase().includes(n),
    );
    if (hits.length > 0) return { coins: hits, source: `${source} (filtered)` };
  } catch {
    // fall through to list merge
  }

  const [trending, newest] = await Promise.all([
    fetchCoinList("trending").catch(() => ({ coins: [] as PumpCoin[], source: "" })),
    fetchCoinList("newest").catch(() => ({ coins: [] as PumpCoin[], source: "" })),
  ]);
  const seen = new Set<string>();
  const merged: PumpCoin[] = [];
  for (const c of [...trending.coins, ...newest.coins]) {
    if (seen.has(c.mint)) continue;
    seen.add(c.mint);
    merged.push(c);
  }
  const n = needle(raw);
  const hits = merged.filter(
    (c) =>
      c.mint.toLowerCase().includes(n) ||
      c.name.toLowerCase().includes(n) ||
      c.symbol.toLowerCase().includes(n),
  );
  return {
    coins: hits,
    source: `${trending.source || newest.source} (client filter; /coins/search is 404)`,
  };
}
