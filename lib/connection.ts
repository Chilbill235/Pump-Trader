import { Connection, PublicKey } from "@solana/web3.js";
import { DEFAULT_RPC } from "./constants";

const cache = new Map<string, Connection>();

export function getConnection(rpcUrl?: string): Connection {
  const url = (rpcUrl || DEFAULT_RPC).trim() || DEFAULT_RPC;
  const existing = cache.get(url);
  if (existing) return existing;
  const conn = new Connection(url, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
  cache.set(url, conn);
  return conn;
}

/**
 * Public RPCs that don't require an API key. Used as fallbacks when the
 * configured RPC rate-limits or 403s (very common with Helius free keys,
 * public mainnet-beta, and the bundled ankr endpoint).
 */
export const FREE_PUBLIC_RPCS: readonly string[] = [
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
];

/**
 * Run an arbitrary Solana read or subscription call, falling back across
 * other public RPCs if the primary one fails with 403 / 429 / 5xx. The
 * operation is retried on each new Connection so the user doesn't have to
 * configure anything.
 *
 * The op's return type is preserved so callers can keep their typing.
 */
export async function withRpcFallback<T>(
  primary: Connection,
  op: (c: Connection) => T | Promise<T>,
): Promise<{ result: T; endpoint: string }> {
  const tried = new Set<string>();
  const order = [
    primary.rpcEndpoint,
    ...FREE_PUBLIC_RPCS.filter((u) => u !== primary.rpcEndpoint),
  ];
  let lastErr: unknown = null;
  for (const url of order) {
    if (tried.has(url)) continue;
    tried.add(url);
    const conn = url === primary.rpcEndpoint ? primary : new Connection(url, "confirmed");
    try {
      const result = await op(conn);
      return { result, endpoint: url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("All RPCs failed");
}

/** Convenience: getBalance with fallback. */
export async function getBalanceWithFallback(
  primary: Connection,
  owner: PublicKey,
): Promise<{ lamports: number; endpoint: string }> {
  return withRpcFallback(primary, async (c) => c.getBalance(owner, "confirmed")).then(
    (r) => ({ lamports: r.result, endpoint: r.endpoint }),
  );
}