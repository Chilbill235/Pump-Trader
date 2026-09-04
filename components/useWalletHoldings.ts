"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { loadWalletPortfolio } from "@/lib/portfolio";

export type WalletHolding = {
  mint: string;
  amount: number;
  decimals: number;
  uiAmount: number;
  name: string;
  symbol: string;
  imageUri?: string;
  source: "cache" | "lookup" | "unknown";
};

/**
 * Loads the connected wallet's SPL token holdings so the trade panel can offer
 * them as the "Pay with" mint. SOL is always available implicitly via the
 * bonding-curve path; this only returns SPL tokens (USDC, BONK, etc.).
 *
 * Returns:
 *  - holdings: parsed token accounts with names/symbols
 *  - loading: true while we're working on the first fetch
 *  - error: last network/RPC error if any
 */
export function useWalletHoldings() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [holdings, setHoldings] = useState<WalletHolding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet.connected || !wallet.publicKey) {
      setHoldings([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await loadWalletPortfolio(
          connection,
          wallet.publicKey!,
          async () => null,
        );
        if (cancelled) return;
        setHoldings(
          list.map((t) => ({
            mint: t.mint,
            amount: t.amount,
            decimals: t.decimals,
            uiAmount: t.uiAmount,
            name: t.name,
            symbol: t.symbol,
            imageUri: t.imageUri,
            source: t.source,
          })),
        );
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setHoldings([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, wallet.connected, wallet.publicKey]);

  return { holdings, loading, error };
}