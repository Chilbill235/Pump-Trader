import {
  Connection,
  PublicKey,
} from "@solana/web3.js";

export type WalletToken = {
  mint: string;
  amount: number;
  decimals: number;
  uiAmount: number;
};

type ParsedAccountInfo = {
  parsed?: {
    info?: {
      mint?: string;
      tokenAmount?: {
        amount?: string;
        decimals?: number;
        uiAmount?: number;
        uiAmountString?: string;
      };
    };
    type?: string;
  };
};

// Public RPCs that do not require an API key and tend to be more permissive
// than api.mainnet-beta.solana.com (which now rate-limits free users). We try
// the user's configured one first, then fall back through this list. Each
// entry was verified to support both getBalance and getTokenAccountsByOwner
// without auth at the time of writing.
const FREE_PUBLIC_RPCS = [
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
];

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

type WorkingEndpoint = { url: string; isPrimary: boolean };

let cachedWorking: WorkingEndpoint | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60_000;

function newConn(url: string): Connection {
  // Use "processed" so we get the freshest account state; token accounts move
  // fast and a "confirmed" wait isn't necessary for displaying balances.
  return new Connection(url, "processed");
}

async function tryParsed(
  conn: Connection,
  owner: PublicKey,
): Promise<WalletToken[] | null> {
  try {
    const resp = await conn.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    });
    const out: WalletToken[] = [];
    for (const acc of resp.value) {
      const info = (acc.account.data as ParsedAccountInfo | undefined)?.parsed?.info;
      if (!info?.mint || !info.tokenAmount) continue;
      const amount = Number(info.tokenAmount.amount ?? "0");
      if (!Number.isFinite(amount) || amount <= 0) continue;
      out.push({
        mint: info.mint,
        amount,
        decimals: info.tokenAmount.decimals ?? 0,
        uiAmount:
          info.tokenAmount.uiAmount ??
          Number(
            info.tokenAmount.uiAmountString ??
              amount / 10 ** (info.tokenAmount.decimals ?? 0),
          ),
      });
    }
    return out;
  } catch {
    return null;
  }
}

async function tryRaw(
  conn: Connection,
  owner: PublicKey,
): Promise<WalletToken[]> {
  const resp = await conn.getTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });
  const out: WalletToken[] = [];
  for (const acc of resp.value) {
    const data = acc.account.data as Buffer | Uint8Array | { parsed?: unknown };
    // Skip if a parsed response came through anyway.
    if (data && typeof data === "object" && "parsed" in (data as Record<string, unknown>)) {
      const info = (data as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } })
        .parsed?.info;
      if (info?.mint && info.tokenAmount) {
        const amount = Number(info.tokenAmount.amount ?? "0");
        if (Number.isFinite(amount) && amount > 0) {
          out.push({
            mint: info.mint,
            amount,
            decimals: info.tokenAmount.decimals ?? 0,
            uiAmount: amount / 10 ** (info.tokenAmount.decimals ?? 0),
          });
        }
        continue;
      }
    }
    // Raw SPL token account layout (165 bytes):
    //   0..32  : mint pubkey
    //   32..64 : owner pubkey
    //   64..72 : amount (little-endian u64)
    //   72..76 : delegate option (COption<Pubkey>)
    //   76     : state (1 = initialized)
    //   77..81 : isNative option
    //   81..109: delegated amount
    //   109..112: close authority option
    // We need the mint to derive decimals, so look it up.
    const buf = data instanceof Uint8Array ? data : Buffer.from(data as ArrayLike<number>);
    if (buf.length < 72) continue;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const amountLE = Number(view.getBigUint64(64, true));
    if (!Number.isFinite(amountLE) || amountLE <= 0) continue;
    // Mint is bytes [0..32]. We don't know decimals yet; we'll patch them
    // after a single batch getMultipleParsedAccounts call.
    const mint = new PublicKey(buf.slice(0, 32)).toBase58();
    out.push({ mint, amount: amountLE, decimals: 0, uiAmount: amountLE });
  }
  // Batch-fetch mint decimals. Without this, the UI would show wrong balances
  // for USDC (6), BONK (5), WIF (6), etc.
  if (out.length > 0) {
    const mints = out.map((t) => new PublicKey(t.mint));
    try {
      const infos = await conn.getMultipleParsedAccounts(mints);
      infos.value.forEach((info, i) => {
        const parsed = (info?.data as { parsed?: { info?: { decimals?: number } } } | undefined)
          ?.parsed?.info;
        const decimals = parsed?.decimals ?? 0;
        out[i].decimals = decimals;
        out[i].uiAmount = out[i].amount / 10 ** decimals;
      });
    } catch {
      // If the batched call fails, fall back to per-mint queries (slower but
      // still better than nothing).
      for (let i = 0; i < out.length; i++) {
        try {
          const info = await conn.getParsedAccountInfo(new PublicKey(out[i].mint));
          const parsed = (info.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)
            ?.parsed?.info;
          const decimals = parsed?.decimals ?? 0;
          out[i].decimals = decimals;
          out[i].uiAmount = out[i].amount / 10 ** decimals;
        } catch {
          // leave decimals at 0 — UI will still show raw amount
        }
      }
    }
  }
  return out;
}

export async function loadWalletTokens(
  connection: Connection,
  owner: PublicKey,
): Promise<WalletToken[]> {
  const now = Date.now();
  if (cachedWorking && now - cachedAt < CACHE_TTL_MS) {
    const conn = cachedWorking.isPrimary
      ? connection
      : newConn(cachedWorking.url);
    const got = (await tryParsed(conn, owner)) ?? (await tryRaw(conn, owner));
    if (got.length > 0 || cachedWorking.isPrimary) return got;
  }
  const primary = connection.rpcEndpoint;
  const endpoints: Array<{ url: string; isPrimary: boolean }> = [
    { url: primary, isPrimary: true },
    ...FREE_PUBLIC_RPCS.filter((u) => u !== primary).map((u) => ({
      url: u,
      isPrimary: false,
    })),
  ];
  const errors: string[] = [];
  for (const ep of endpoints) {
    const conn = ep.isPrimary ? connection : newConn(ep.url);
    const parsed = await tryParsed(conn, owner);
    if (parsed !== null) {
      if (parsed.length > 0) {
        cachedWorking = ep;
        cachedAt = now;
        return parsed;
      }
      // parsed succeeded with 0 results — wallet genuinely holds no SPL
      // tokens. Don't try other RPCs.
      return parsed;
    }
    try {
      const raw = await tryRaw(conn, owner);
      if (raw.length > 0) {
        cachedWorking = ep;
        cachedAt = now;
        return raw;
      }
      return raw;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${ep.url} → ${msg.slice(0, 140)}`);
    }
  }
  throw new Error(
    `All RPCs refused wallet token lookup. Tried:\n${errors.join("\n")}`,
  );
}

const META_CACHE = new Map<string, { name: string; symbol: string; imageUri?: string }>();

export async function loadWalletPortfolio(
  connection: Connection,
  owner: PublicKey,
  metaLookup: (mint: string) => Promise<{ name: string; symbol: string; imageUri?: string } | null>,
): Promise<
  Array<WalletToken & { name: string; symbol: string; imageUri?: string; source: "cache" | "lookup" | "unknown" }>
> {
  const tokens = await loadWalletTokens(connection, owner);
  const metas = await Promise.all(
    tokens.map(async (t) => {
      if (META_CACHE.has(t.mint)) {
        const c = META_CACHE.get(t.mint)!;
        return { ...c, source: "cache" as const };
      }
      const m = await metaLookup(t.mint).catch(() => null);
      if (m) {
        META_CACHE.set(t.mint, m);
        return { ...m, source: "lookup" as const };
      }
      return { name: "Unknown", symbol: shorten(t.mint), source: "unknown" as const };
    }),
  );
  return tokens.map((t, i) => ({ ...t, ...metas[i] }));
}

function shorten(addr: string): string {
  if (addr.length <= 8) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}