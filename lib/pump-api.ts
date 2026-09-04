import { PUMP_API_BASE, PUMP_API_FALLBACKS } from "./constants";
import type { PumpCoin } from "./types";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const rec = asRecord(value);
  if (!rec) return [];
  for (const key of ["coins", "data", "results", "items"]) {
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
  }
  return [];
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

const IPFS_HOSTS = [
  "ipfs.io",
  "gateway.pinata.cloud",
  "cloudflare-ipfs.com",
  "nftstorage.link",
  "cf-ipfs.com",
  "dweb.link",
  "ipfs.dweb.link",
];

/** Rewrite a raw image URI to the app's own /api/img proxy so the browser never hits a cross-origin gateway. */
export function proxifyImageUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("ipfs://")) {
    return `/api/img?u=${encodeURIComponent(src)}`;
  }
  if (src.startsWith("ar://")) {
    return `/api/img?u=${encodeURIComponent(src)}`;
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    try {
      const u = new URL(src);
      if (IPFS_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) {
        return `/api/img?u=${encodeURIComponent(src)}`;
      }
    } catch {
      return undefined;
    }
    return src;
  }
  return undefined;
}

export function normalizeCoin(raw: unknown): PumpCoin | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const mint =
    str(rec.mint) ||
    str(rec.mint_address) ||
    str(rec.address) ||
    str(rec.id);
  if (!mint) return null;
  return {
    mint,
    name: str(rec.name) || "Unknown",
    symbol: str(rec.symbol) || str(rec.ticker) || "???",
    description: str(rec.description) ?? undefined,
    imageUri:
      proxifyImageUrl(
        str(rec.image_uri) ||
          str(rec.imageUri) ||
          str(rec.image) ||
          str(rec.thumbnail),
      ),
    usdMarketCap: num(rec.usd_market_cap) ?? num(rec.usdMarketCap),
    marketCapSol: num(rec.market_cap) ?? num(rec.marketCap),
    complete: Boolean(rec.complete ?? rec.raydium_pool),
    createdAt: num(rec.created_timestamp) ?? num(rec.createdAt),
    lastTradeAt: num(rec.last_trade_timestamp) ?? num(rec.lastTradeAt),
    creator: str(rec.creator),
    twitter: str(rec.twitter),
    telegram: str(rec.telegram),
    website: str(rec.website),
    nsfw: Boolean(rec.nsfw),
    virtualSolReserves: num(rec.virtual_sol_reserves) ?? num(rec.virtualSolReserves),
    virtualTokenReserves: num(rec.virtual_token_reserves) ?? num(rec.virtualTokenReserves),
    realSolReserves: num(rec.real_sol_reserves) ?? num(rec.realSolReserves),
    replyCount: num(rec.reply_count) ?? num(rec.replyCount),
    uniqueBuyers:
      num(rec.unique_buyers) ??
      num(rec.uniqueBuyers) ??
      num(rec.num_holders) ??
      num(rec.holder_count) ??
      num(rec.holders),
    username: str(rec.username),
    isCurrentlyLive: Boolean(rec.is_currently_live ?? rec.isCurrentlyLive),
    kingOfTheHillAt: num(rec.king_of_the_hill_timestamp) ?? num(rec.kingOfTheHillAt),
    metadataUri: str(rec.metadata_uri) || str(rec.metadataUri),
    isBanned: Boolean(rec.is_banned ?? rec.isBanned),
    raw: rec,
  };
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: init?.signal ?? ctrl.signal,
      headers: {
        Accept: "application/json",
        Origin: "https://pump.fun",
        "User-Agent": "pump-trader/0.1 (personal dashboard)",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const body = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, body: body.slice(0, 500) };
    }
    try {
      return { ok: true, data: JSON.parse(body) as unknown };
    } catch {
      return { ok: false, status: res.status, body: "invalid json" };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, body: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function pumpGet(
  path: string,
): Promise<{ data: unknown; source: string }> {
  const bases = [PUMP_API_BASE, ...PUMP_API_FALLBACKS.filter((b) => b !== PUMP_API_BASE)];
  const errors: string[] = [];
  for (const base of bases) {
    const url = `${base}${path}`;
    try {
      const result = await fetchJson(url);
      if (result.ok) return { data: result.data, source: url };
      errors.push(`${url} -> HTTP ${result.status} ${result.body}`);
    } catch (err) {
      errors.push(`${url} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(
    `pump.fun HTTP APIs failed. Last errors: ${errors.slice(-3).join(" | ")}`,
  );
}

export async function fetchCoinList(kind: "trending" | "newest"): Promise<{
  coins: PumpCoin[];
  source: string;
}> {
  const sort = kind === "newest" ? "created_timestamp" : "last_trade_timestamp";
  const paths = [
    `/coins?offset=0&limit=50&sort=${sort}&order=DESC&includeNsfw=false`,
    `/coins/search?offset=0&limit=50&sort=${sort}&order=DESC&includeNsfw=false&searchTerm=`,
    kind === "newest" ? "/coins/latest" : "/coins/for-you?offset=0&limit=50",
  ];
  const errors: string[] = [];
  for (const path of paths) {
    try {
      const { data, source } = await pumpGet(path);
      const coins = asArray(data)
        .map(normalizeCoin)
        .filter((c): c is PumpCoin => c !== null);
      if (coins.length > 0) return { coins, source };
      const one = normalizeCoin(data);
      if (one) return { coins: [one], source };
      errors.push(`${source} returned 0 coins`);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(
    `Could not list pump.fun coins. ${errors.slice(-2).join(" | ")} Paste a mint on the coin page to trade via on-chain reads.`,
  );
}

export async function fetchCoinMeta(mint: string): Promise<{
  coin: PumpCoin | null;
  source: string | null;
  error?: string;
}> {
  try {
    const { data, source } = await pumpGet(`/coins/${mint}`);
    return { coin: normalizeCoin(data), source };
  } catch (err) {
    return {
      coin: null,
      source: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchSolPriceUsd(): Promise<number | null> {
  try {
    const { data } = await pumpGet("/sol-price");
    const rec = asRecord(data);
    return rec ? num(rec.solPrice) ?? num(rec.price) ?? num(rec.usd) : null;
  } catch {
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        { cache: "no-store" },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { solana?: { usd?: number } };
      return json.solana?.usd ?? null;
    } catch {
      return null;
    }
  }
}
