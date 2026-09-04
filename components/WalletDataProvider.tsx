"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getBalanceWithFallback, withRpcFallback } from "@/lib/connection";
import { loadWalletPortfolio, type WalletToken } from "@/lib/portfolio";
import { getSolUsd } from "@/lib/token-value";

export type Holding = WalletToken & {
  name: string;
  symbol: string;
  imageUri?: string;
  source: "cache" | "lookup" | "unknown";
};

type Ctx = {
  /** Native SOL balance in SOL (not lamports). Null while loading. */
  sol: number | null;
  /** Current SOL/USD price. Null while loading. */
  solUsd: number | null;
  /** Every SPL token the wallet holds. */
  holdings: Holding[];
  /** True only for the first load. */
  loading: boolean;
  /** Last error message if any. Cleared on success. */
  error: string | null;
  /** Endpoint that the most recent successful read used. */
  endpoint: string | null;
  /** True when at least one WebSocket subscription is live. */
  live: boolean;
  /** Force a refetch (holdings + balance). */
  refresh: () => void;
};

const WalletDataContext = createContext<Ctx | null>(null);

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ACCOUNT_CHANGE_POLL_MS = 8_000;
const PRICE_POLL_MS = 60_000;

export function WalletDataProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const publicKey = wallet.publicKey ?? null;
  const connected = wallet.connected && !!publicKey;

  const [sol, setSol] = useState<number | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // Mirror the publicKey into a ref so the websocket callbacks always see the
  // current key without re-subscribing.
  const pkRef = useRef<PublicKey | null>(null);
  useEffect(() => {
    pkRef.current = publicKey;
  }, [publicKey]);

  const fetchSol = useCallback(async () => {
    const pk = pkRef.current;
    if (!pk) {
      setSol(null);
      return;
    }
    try {
      const { lamports, endpoint: ep } = await getBalanceWithFallback(connection, pk);
      setSol(lamports / 1e9);
      setEndpoint(ep);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [connection]);

  const fetchHoldings = useCallback(async () => {
    const pk = pkRef.current;
    if (!pk) {
      setHoldings([]);
      return;
    }
    try {
      const list = await loadWalletPortfolio(connection, pk, async () => null);
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [connection]);

  const refresh = useCallback(() => {
    void fetchSol();
    void fetchHoldings();
  }, [fetchSol, fetchHoldings]);

  // Initial + wallet-change fetch
  useEffect(() => {
    if (!connected || !publicKey) {
      setSol(null);
      setHoldings([]);
      setError(null);
      setLive(false);
      return;
    }
    setLoading(true);
    Promise.all([fetchSol(), fetchHoldings()]).finally(() => setLoading(false));
  }, [connected, publicKey, fetchSol, fetchHoldings]);

  // WebSocket subscriptions: accountSubscribe for SOL, programSubscribe for
  // token accounts. These push updates the moment something changes, so the UI
  // stays in sync without polling.
  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    const subs: Array<{ close: () => void }> = [];
    let pollId: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        // 1) Native SOL balance — accountSubscribe.
        const solSub = ((await withRpcFallback(connection, (c) =>
          c.onAccountChange(
            publicKey,
            (acc) => {
              if (cancelled) return;
              const lamports = acc.lamports;
              setSol(lamports / 1e9);
              setLive(true);
            },
            "confirmed",
          ),
        )).result as unknown) as { close: () => void };
        if (cancelled) {
          solSub.close?.();
          return;
        }
        subs.push(solSub);
        setLive(true);

        // 2) Token accounts — programSubscribe on the SPL Token program. This
        //    emits every account change in the wallet's token accounts. The
        //    wallet filter isn't built in, so we filter on the client.
        const tokSub = ((await withRpcFallback(connection, (c) =>
          c.onProgramAccountChange(
            TOKEN_PROGRAM_ID,
            (info) => {
              if (cancelled) return;
              try {
                const owner = (info.accountInfo.data as { parsed?: { info?: { owner?: string } } })
                  ?.parsed?.info?.owner;
                if (owner && owner === pkRef.current?.toBase58()) {
                  // A token account we own just changed → refetch holdings.
                  void fetchHoldings();
                  setLive(true);
                }
              } catch {
                // ignore parse errors
              }
            },
            "confirmed",
            [{ dataSize: 165 }],
          ),
        )).result as unknown) as { close: () => void };
        if (cancelled) {
          tokSub.close?.();
          return;
        }
        subs.push(tokSub);
        setLive(true);

        // 3) Some public RPCs don't actually push anything. Fall back to a
        //    short poll loop just in case, so the UI never goes stale.
        pollId = setInterval(() => {
          if (cancelled) return;
          void fetchSol();
        }, ACCOUNT_CHANGE_POLL_MS);
      } catch {
        // Subscribe failed → just rely on the fetch + poll we already have.
        pollId = setInterval(() => {
          if (cancelled) return;
          void fetchSol();
        }, ACCOUNT_CHANGE_POLL_MS);
      }
    })();

    return () => {
      cancelled = true;
      for (const s of subs) {
        try {
          s.close?.();
        } catch {
          // ignore
        }
      }
      if (pollId) clearInterval(pollId);
      setLive(false);
    };
  }, [connection, publicKey, connected, fetchHoldings, fetchSol]);

  // SOL price ticker
  useEffect(() => {
    let cancelled = false;
    const update = async () => {
      const v = await getSolUsd();
      if (!cancelled && v != null) setSolUsd(v);
    };
    void update();
    const id = setInterval(update, PRICE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({ sol, solUsd, holdings, loading, error, endpoint, live, refresh }),
    [sol, solUsd, holdings, loading, error, endpoint, live, refresh],
  );

  return <WalletDataContext.Provider value={value}>{children}</WalletDataContext.Provider>;
}

export function useWalletData(): Ctx {
  const ctx = useContext(WalletDataContext);
  if (!ctx) throw new Error("useWalletData must be used inside WalletDataProvider");
  return ctx;
}