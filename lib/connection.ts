import { Connection } from "@solana/web3.js";
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
