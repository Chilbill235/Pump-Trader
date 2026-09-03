import { Connection, PublicKey } from "@solana/web3.js";

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

export async function loadWalletTokens(
  connection: Connection,
  owner: PublicKey,
): Promise<WalletToken[]> {
  const resp = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
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
        Number(info.tokenAmount.uiAmountString ?? amount / 10 ** (info.tokenAmount.decimals ?? 0)),
    });
  }
  return out;
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