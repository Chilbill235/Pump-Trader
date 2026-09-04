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
import { useWalletData } from "./WalletDataProvider";

export function CoinView({ mint }: { mint: string }) {
  const { connection } = useConnection();
  const [meta, setMeta] = useState<PumpCoin | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [onchain, setOnchain] = useState<CoinOnchain | null>(null);
  const [onchainErr, setOnchainErr] = useState<string | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { holdings } = useWalletData();

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
          <div className="relative overflow-hidden rounded-xl border border-line glass">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 grid-bg opacity-30"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full bg-neon/15 blur-3xl"
            />
            <div className="relative p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <CoinImage src={meta?.imageUri ?? null} alt={symbol} size={64} className="shadow-neon-sm" />
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-semibold leading-tight sm:text-2xl">
                    {name}{" "}
                    <span className="font-mono text-sm text-mute sm:text-base">${symbol}</span>
                  </h1>
                  {meta?.description ? (
                    <p className="mt-1 line-clamp-3 text-xs text-mute sm:text-sm">{meta.description}</p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-mute sm:text-xs">
                    {shortenAddress(mint, 8, 8)}
                    <CopyButton value={mint} label="copy mint" />
                    <Link
                      className="rounded border border-line bg-ink-800/80 px-1.5 py-0.5 transition-colors hover:border-info hover:text-info"
                      href={`${SOLSCAN_TOKEN}${mint}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Solscan ↗
                    </Link>
                    <Link
                      className="rounded border border-line bg-ink-800/80 px-1.5 py-0.5 transition-colors hover:border-neon hover:text-neon"
                      href={`${PUMP_FUN_COIN}${mint}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      pump.fun ↗
                    </Link>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] sm:text-[11px] ${
                    onchain?.graduated
                      ? "border-warn/40 bg-warn/10 text-warn"
                      : "border-neon/40 bg-neon/10 text-neon"
                  }`}
                >
                  {onchain?.graduated ? "GRADUATED · PUMP AMM" : "BONDING CURVE"}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
                <Stat label="Price (buy)" value={onchain ? `${lamportsToSol(new BN(onchain.buyPriceLamportsPerToken), 9)} SOL` : "—"} />
                <Stat
                  label="Market cap"
                  value={formatUsd(mcapUsd)}
                  sub={mcapSol != null ? `${compactNumber(mcapSol)} SOL` : undefined}
                />
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
                <div className="mt-4 space-y-1">
                  <div className="h-2 overflow-hidden rounded bg-ink-700">
                    <div
                      className="h-full rounded bg-gradient-to-r from-neon via-info to-warn transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                    />
                  </div>
                  <p className="flex items-center justify-between font-mono text-[10px] text-mute">
                    <span>Bonding → Raydium at 100%</span>
                    <span className="text-neon">{progress.toFixed(2)}%</span>
                  </p>
                </div>
              ) : null}

              {onchainErr ? (
                <p className="mt-3 rounded border border-danger/30 bg-danger/5 px-2 py-1 font-mono text-xs text-danger">
                  On-chain: {onchainErr}
                </p>
              ) : null}
              {metaErr ? (
                <p className="mt-2 rounded border border-warn/30 bg-warn/5 px-2 py-1 font-mono text-xs text-warn">
                  HTTP metadata unavailable ({metaErr}). Trading still uses on-chain state.
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => setTradeOpen(true)}
                className="press mt-4 w-full rounded-md border border-neon/40 bg-gradient-to-r from-neon to-emerald-400 px-4 py-3 font-mono text-sm font-semibold text-ink-950 shadow-[0_0_18px_-4px_rgba(57,255,136,0.5)] transition-all hover:from-neon/90 hover:shadow-[0_0_22px_-4px_rgba(57,255,136,0.7)] focus:outline-none focus-visible:ring-2 focus-visible:ring-neon active:scale-[0.99] lg:hidden"
              >
                Buy / Sell
              </button>
            </div>
          </div>

          <TokenFacts mint={mint} onchain={onchain} />
        </section>
        <div className="hidden lg:block lg:sticky lg:top-20 lg:self-start">
          <QuickTradePanel
            mint={mint}
            name={name}
            symbol={symbol}
            imageUri={meta?.imageUri}
            holdings={holdings}
          />
        </div>
      </div>

      <MobileTradeSheet
        open={tradeOpen && isMobile}
        onClose={() => setTradeOpen(false)}
        mint={mint}
        name={name}
        symbol={symbol}
        imageUri={meta?.imageUri}
        holdings={holdings}
      />
    </div>
  );
}

function TokenFacts({ mint, onchain }: { mint: string; onchain: CoinOnchain | null }) {
  return (
    <div className="rounded-xl border border-line bg-ink-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-mute">Token facts</h2>
        <span className="rounded border border-line bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-mute">
          Solana
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-3">
        <Row k="Mint" v={shortenAddress(mint, 4, 4)} mono />
        <Row k="Source" v="pump.fun" mono />
        <Row k="Decimals" v={onchain ? "6" : "—"} mono />
        <Row k="Creator" v={onchain?.creator ? shortenAddress(onchain.creator, 4, 4) : "—"} mono />
        <Row
          k="Status"
          v={onchain?.graduated ? "Graduated" : "Bonding curve"}
          accent={onchain?.graduated ? "warn" : "neon"}
        />
        <Row k="Reserves" v={onchain ? `${lamportsToSol(new BN(onchain.realTokenReserves), 6)}` : "—"} mono />
      </dl>
    </div>
  );
}

function Row({
  k,
  v,
  mono = false,
  accent,
}: {
  k: string;
  v: string;
  mono?: boolean;
  accent?: "neon" | "warn" | "danger" | "info";
}) {
  const tone =
    accent === "neon"
      ? "text-neon"
      : accent === "warn"
      ? "text-warn"
      : accent === "danger"
      ? "text-danger"
      : accent === "info"
      ? "text-info"
      : "text-white";
  return (
    <div className="rounded border border-line bg-ink-850 p-2">
      <dt className="text-[9px] uppercase tracking-widest text-mute">{k}</dt>
      <dd className={`mt-0.5 truncate ${mono ? "font-mono" : ""} ${tone}`} title={v}>
        {v}
      </dd>
    </div>
  );
}

function Stat(props: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-line bg-ink-850 p-2.5 sm:p-3">
      <div className="font-mono text-[9px] uppercase tracking-widest text-mute sm:text-[10px]">
        {props.label}
      </div>
      <div className="mt-1 truncate font-mono text-sm text-white sm:text-base">{props.value}</div>
      {props.sub ? <div className="truncate text-[10px] text-mute sm:text-[11px]">{props.sub}</div> : null}
    </div>
  );
}
