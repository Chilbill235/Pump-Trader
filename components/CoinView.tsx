"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PUMP_FUN_COIN, SOLSCAN_TOKEN } from "@/lib/constants";
import { compactNumber, formatUsd, lamportsToSol, shortenAddress } from "@/lib/format";
import { friendlyOnchainError, fetchCoinOnchain } from "@/lib/sdk";
import type { CoinOnchain, PumpCoin } from "@/lib/types";
import { CoinImage } from "./CoinImage";
import { CopyButton } from "./CopyButton";
import { QuickTradePanel } from "./QuickTradePanel";
import { MobileTradeSheet } from "./MobileTradeSheet";
import { isMobileDevice } from "@/lib/mobile";

export function CoinView({ mint }: { mint: string }) {
  const { connection } = useConnection();
  const [meta, setMeta] = useState<PumpCoin | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [onchain, setOnchain] = useState<CoinOnchain | null>(null);
  const [onchainErr, setOnchainErr] = useState<string | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => setIsMobile(isMobileDevice());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/coins/${mint}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as {
          coin: PumpCoin | null;
          error?: string;
        };
        if (cancelled) return;
        setMeta(json.coin);
        setMetaErr(json.error ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setMetaErr(err instanceof Error ? err.message : String(err));
      });
    fetch("/api/sol-price", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { usd?: number | null }) => {
        if (!cancelled) setSolUsd(j.usd ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mint]);

  useEffect(() => {
    let cancelled = false;
    fetchCoinOnchain(connection, mint)
      .then((data) => {
        if (!cancelled) {
          setOnchain(data);
          setOnchainErr(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setOnchain(null);
          setOnchainErr(friendlyOnchainError(err, mint));
        }
      });
    const id = setInterval(() => {
      fetchCoinOnchain(connection, mint)
        .then((data) => {
          if (!cancelled) {
            setOnchain(data);
            setOnchainErr(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setOnchainErr(friendlyOnchainError(err, mint));
        });
    }, 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [connection, mint]);

  const name = meta?.name ?? "Unknown token";
  const symbol = meta?.symbol ?? "???";
  const mcapSol = onchain ? Number(lamportsToSol(new BN(onchain.marketCapLamports))) : meta?.marketCapSol ?? null;
  const mcapUsd =
    meta?.usdMarketCap ??
    (mcapSol != null && solUsd != null ? mcapSol * solUsd : null);
  const progress = onchain ? onchain.progressBps / 100 : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
        <section className="space-y-4">
          <div className="rounded border border-line bg-ink-800 p-4">
            <div className="flex items-start gap-3">
              <CoinImage src={meta?.imageUri ?? null} alt={symbol} size={56} />
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-semibold">
                  {name} <span className="font-mono text-sm text-mute">{symbol}</span>
                </h1>
                {meta?.description ? (
                  <p className="mt-1 line-clamp-3 text-xs text-mute">{meta.description}</p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-mute">
                  {shortenAddress(mint, 8, 8)}
                  <CopyButton value={mint} label="copy mint" />
                  <Link
                    className="underline hover:text-neon"
                    href={`${SOLSCAN_TOKEN}${mint}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Solscan
                  </Link>
                  <Link
                    className="underline hover:text-neon"
                    href={`${PUMP_FUN_COIN}${mint}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    pump.fun
                  </Link>
                </div>
              </div>
              <span
                className={`shrink-0 rounded border px-2 py-1 font-mono text-[11px] ${
                  onchain?.graduated
                    ? "border-warn/40 text-warn"
                    : "border-neon/40 text-neon"
                }`}
              >
                {onchain?.graduated ? "GRADUATED / PUMP AMM" : "BONDING CURVE"}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Price (buy)" value={onchain ? `${lamportsToSol(new BN(onchain.buyPriceLamportsPerToken), 9)} SOL` : "—"} />
              <Stat label="Market cap" value={formatUsd(mcapUsd)} sub={mcapSol != null ? `${compactNumber(mcapSol)} SOL` : undefined} />
              <Stat
                label="Graduation"
                value={progress == null ? "—" : `${progress.toFixed(2)}%`}
              />
              <Stat
                label="Curve SOL"
                value={onchain ? `${lamportsToSol(new BN(onchain.realSolReserves))} SOL` : "—"}
              />
            </div>

            {progress != null ? (
              <div className="mt-4 h-2 overflow-hidden rounded bg-ink-700">
                <div
                  className="h-full bg-neon"
                  style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                />
              </div>
            ) : null}

            {onchainErr ? (
              <p className="mt-3 font-mono text-xs text-danger">On-chain: {onchainErr}</p>
            ) : null}
            {metaErr ? (
              <p className="mt-2 font-mono text-xs text-mute">
                HTTP metadata unavailable ({metaErr}). Trading still uses on-chain state.
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => setTradeOpen(true)}
              className="mt-4 w-full rounded bg-neon px-4 py-3 font-mono text-sm font-semibold text-ink-950 active:bg-neon/80 lg:hidden"
            >
              Buy / Sell
            </button>
          </div>
        </section>
        <div className="hidden lg:block lg:sticky lg:top-20 lg:self-start">
          <QuickTradePanel mint={mint} name={name} symbol={symbol} imageUri={meta?.imageUri} />
        </div>
      </div>

      <MobileTradeSheet
        open={tradeOpen && isMobile}
        onClose={() => setTradeOpen(false)}
        mint={mint}
        name={name}
        symbol={symbol}
        imageUri={meta?.imageUri}
      />
    </div>
  );
}

function Stat(props: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-line bg-ink-900 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wide text-mute">
        {props.label}
      </div>
      <div className="mt-1 font-mono text-sm">{props.value}</div>
      {props.sub ? <div className="text-[11px] text-mute">{props.sub}</div> : null}
    </div>
  );
}
