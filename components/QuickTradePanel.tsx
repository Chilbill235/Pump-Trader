"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { useEffect, useMemo, useState } from "react";
import { Connection } from "@solana/web3.js";
import { SOLSCAN_TX, TOKEN_DECIMALS } from "@/lib/constants";
import { lamportsToSol, shortenAddress, tokensToUi, uiToTokens } from "@/lib/format";
import { upsertPositionFromFill } from "@/lib/positions";
import { friendlyOnchainError, isLikelyNotPumpCoin, quoteTrade } from "@/lib/sdk";
import { simulateAndSend } from "@/lib/trade";
import {
  MIN_BUY_SOL,
  MIN_SOL_RESERVED_FOR_FEES,
  MIN_TRADE_USD,
  validateAnyTokenAmount,
  validateBuyAmount,
  validateSellAmount,
} from "@/lib/trade-limits";
import { CoinImage } from "./CoinImage";
import { ConfirmDialog } from "./ConfirmDialog";
import { useSettings } from "./SettingsProvider";
import { useActiveAccountId } from "./AccountsProvider";
import {
  fetchJupiterQuote,
  fetchJupiterUsdPrice,
  getKnownTokenMeta,
  jupiterSimulateAndSend,
  shortTokenLabel,
  type JupiterQuote,
} from "@/lib/jupiter";
import { fetchMintDecimals, getSolUsd } from "@/lib/token-value";
import { useWalletData } from "./WalletDataProvider";
import { notify } from "./NotificationProvider";
import type { WalletToken } from "@/lib/portfolio";

type HoldingLike = WalletToken & {
  name: string;
  symbol: string;
  imageUri?: string;
  source: "cache" | "lookup" | "unknown";
};

type Venue = "bonding-curve" | "pump-amm" | "jupiter";

type Props = {
  mint: string;
  name?: string;
  symbol?: string;
  imageUri?: string;
  initialSide?: "buy" | "sell";
  onClose?: () => void;
  /** Compact mode for use inside modals on the markets list. */
  compact?: boolean;
  /**
   * If the parent already has the wallet's token holdings, pass them here so
   * the user can pick the input/output mint (USDC, BONK, SOL, etc.) instead of
   * being forced to use SOL.
   */
  holdings?: HoldingLike[];
};

type ErrorHint = {
  title: string;
  detail: string;
  fixes: string[];
};

type QuoteView = {
  venue: Venue;
  inMint: string;
  inSymbol: string;
  inDecimals: number;
  inAmountRaw: string;
  outMint: string;
  outSymbol: string;
  outDecimals: number;
  outAmountRaw: string;
  priceImpactPct: number | null;
  feesLamports: string;
  usdValue: number | null;
  notes: string[];
  /** Pump-program specific flag (kept for UI labelling). */
  graduated: boolean;
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const FALLBACK_DECIMALS = 9;

function classifyError(raw: string): ErrorHint {
  const lower = raw.toLowerCase();
  if (lower.includes("insufficient sol")) {
    const m = raw.match(/wallet has ([\d.]+) SOL.*need[^\d]*([\d.]+) SOL/);
    const have = m?.[1] ?? "?";
    const need = m?.[2] ?? "?";
    return {
      title: "Insufficient SOL balance",
      detail: `Wallet has ${have} SOL but this trade needs ~${need} SOL (size + ~${MIN_SOL_RESERVED_FOR_FEES} SOL for rent + fees).`,
      fixes: [
        `Top up the wallet by at least ${(Number(need) - Number(have)).toFixed(4)} SOL.`,
        `Lower the trade size (app minimum is $${MIN_TRADE_USD.toFixed(2)} USD).`,
        `Sell an existing position to free up SOL.`,
      ],
    };
  }
  if (lower.includes("pool account not found") || lower.includes("doesn't look like a pump.fun")) {
    return {
      title: "Not a pump.fun bonding-curve token",
      detail: raw,
      fixes: [
        "Double-check the mint address from pump.fun.",
        "If the coin graduated to pump-amm, use the AMM tab instead.",
        "Use the search box on Markets to find the right mint.",
      ],
    };
  }
  if (lower.includes("simulation failed") || lower.includes("instructionerror")) {
    return {
      title: "Transaction would fail on-chain",
      detail: raw,
      fixes: [
        "Increase slippage in Settings (the pool is moving).",
        "Try a smaller size to reduce price impact.",
        "Wait a few seconds and retry — the curve is updating.",
      ],
    };
  }
  if (lower.includes("slippage") || lower.includes("exceeded")) {
    return {
      title: "Slippage exceeded",
      detail: raw,
      fixes: [
        "Raise slippage % in Settings (default 5%, try 10%).",
        "Split the trade into smaller chunks.",
      ],
    };
  }
  if (lower.includes("minimum buy") || lower.includes("minimum is")) {
    return {
      title: "Trade size too small",
      detail: raw,
      fixes: [
        `App minimum is $${MIN_TRADE_USD.toFixed(2)} USD per trade.`,
        `On-chain minimum is ${MIN_BUY_SOL} SOL on pump.fun's bonding curve.`,
        "Raise the size, or trade on pump-amm if the coin graduated.",
      ],
    };
  }
  if (lower.includes("blockhash") || lower.includes("expired") || lower.includes("block height")) {
    return {
      title: "Network — blockhash expired",
      detail: raw,
      fixes: [
        "Retry — the network dropped the transaction.",
        "Check your RPC connection (Settings → RPC URL).",
      ],
    };
  }
  if (lower.includes("user rejected") || lower.includes("user canceled")) {
    return {
      title: "Cancelled in wallet",
      detail: raw,
      fixes: ["Approve the transaction in Phantom to send it."],
    };
  }
  if (lower.includes("403") || lower.includes("forbidden") || lower.includes("429")) {
    return {
      title: "RPC / aggregator rate-limited",
      detail: raw,
      fixes: [
        "The public mainnet RPC and free aggregator endpoints are rate-limited.",
        "Set a private RPC in Settings (Helius, QuickNode, Triton).",
        "Set NEXT_PUBLIC_SOLANA_RPC_URL in your .env.local.",
        "Wait a few seconds and try again.",
      ],
    };
  }
  if (lower.includes("graduat")) {
    return {
      title: "Coin graduated off the curve",
      detail: raw,
      fixes: [
        "This trade needs the pump-amm pool, not the bonding curve.",
        "Refresh — the quote will switch venues automatically.",
      ],
    };
  }
  if (lower.includes("no route") || lower.includes("could not find")) {
    return {
      title: "No route found",
      detail: raw,
      fixes: [
        "Jupiter could not find a route for this pair right now.",
        "Try a different input token (SOL, USDC).",
        "Retry in a few seconds — routes update continuously.",
      ],
    };
  }
  return {
    title: "Trade failed",
    detail: raw,
    fixes: [
      "Retry in a few seconds.",
      "Check Settings → RPC URL is reachable.",
      "If this keeps happening, switch to SIMULATE mode to debug.",
    ],
  };
}

function isPumpTokenError(err: unknown): boolean {
  if (isLikelyNotPumpCoin(err)) return true;
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (m.includes("doesn't look like a pump")) return true;
  }
  return false;
}

export function QuickTradePanel(props: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { settings } = useSettings();
  const accountId = useActiveAccountId();
  const walletData = useWalletData();
  const decimals = TOKEN_DECIMALS;
  const symbol = props.symbol ?? "???";

  const [side, setSide] = useState<"buy" | "sell">(props.initialSide ?? "buy");
  const [amount, setAmount] = useState(props.initialSide === "sell" ? "1000000" : "0.02");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [errorInfo, setErrorInfo] = useState<ErrorHint | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receipt, setReceipt] = useState<{ note: string; url?: string } | null>(null);
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [outDecimals, setOutDecimals] = useState<number>(decimals);
  const [pumpSupported, setPumpSupported] = useState<boolean | null>(null);
  const [inMint, setInMint] = useState<string>(SOL_MINT);
  const [inDecimals, setInDecimals] = useState<number>(9);
  const [inBalance, setInBalance] = useState<number | null>(null);

  const inputOptions = useMemo(() => {
    const opts: Array<{ mint: string; symbol: string; balance: number | null }> = [
      { mint: SOL_MINT, symbol: "SOL", balance: null },
    ];
    const seen = new Set([SOL_MINT]);
    for (const h of props.holdings ?? []) {
      if (seen.has(h.mint)) continue;
      seen.add(h.mint);
      opts.push({
        mint: h.mint,
        symbol: shortTokenLabel(h.mint, h.symbol),
        balance: Number.isFinite(h.amount) ? h.amount : null,
      });
    }
    return opts;
  }, [props.holdings]);

  useEffect(() => {
    fetch("/api/sol-price", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { usd?: number | null }) => {
        if (j.usd && Number.isFinite(j.usd)) setSolPrice(j.usd);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetchMintDecimals(connection, props.mint);
        if (!cancelled) setOutDecimals(d);
      } catch {
        if (!cancelled) setOutDecimals(TOKEN_DECIMALS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, props.mint]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const probe = await quoteTrade({
          connection,
          mint: props.mint,
          user: wallet.publicKey ?? null,
          side: "sell",
          tokenAmountRaw: new BN(1),
          slippagePct: settings.slippagePct,
        });
        if (!cancelled) {
          setPumpSupported(true);
          setQuote((q) =>
            q && q.venue !== "jupiter"
              ? { ...q, graduated: probe.graduated, venue: probe.venue }
              : q,
          );
        }
      } catch (err) {
        if (cancelled) return;
        if (isPumpTokenError(err)) {
          setPumpSupported(false);
        } else {
          setPumpSupported(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, props.mint, wallet.publicKey, settings.slippagePct]);

  // Track input mint decimals and balance
  useEffect(() => {
    let cancelled = false;
    if (inMint === SOL_MINT) {
      setInDecimals(9);
      return;
    }
    void (async () => {
      try {
        const d = await fetchMintDecimals(connection, inMint);
        if (!cancelled) setInDecimals(d);
      } catch {
        if (!cancelled) setInDecimals(FALLBACK_DECIMALS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, inMint]);

  useEffect(() => {
    // Use the shared WalletDataProvider so we don't re-hit RPCs in every
    // trade panel. The provider is also WebSocket-subscribed so the
    // balance updates the moment a tx lands.
    if (inMint === SOL_MINT) {
      setInBalance(walletData.sol);
    } else {
      const found = walletData.holdings.find((h) => h.mint === inMint);
      setInBalance(found ? (Number.isFinite(found.uiAmount) ? found.uiAmount : null) : null);
    }
  }, [inMint, walletData.sol, walletData.holdings]);

  const inSymbol = useMemo(() => {
    return shortTokenLabel(inMint, inputOptions.find((o) => o.mint === inMint)?.symbol);
  }, [inMint, inputOptions]);

  function parsedAmounts(): { inRaw: BN; outRaw?: BN } {
    if (side === "buy") {
      // Pump bonding-curve buys have a hard on-chain minimum (~0.0011 SOL) and
      // also a practical floor in `validateBuyAmount`. For Jupiter swaps there
      // is no minimum: users can buy $0.10 of a token if they have the input
      // token for it. We dispatch based on which venue we'll actually use.
      const usePump = pumpSupported !== false && inMint === SOL_MINT;
      if (usePump) {
        const v = validateBuyAmount(amount);
        if (!v.ok || !v.lamports) throw new Error(v.error ?? "Invalid SOL amount.");
        // $1 USD floor for any trade.
        if (solPrice != null && Number.isFinite(solPrice) && solPrice > 0) {
          const usd = (Number(v.lamports.toString()) / 1e9) * solPrice;
          if (usd < MIN_TRADE_USD) {
            throw new Error(
              `Minimum trade size is $${MIN_TRADE_USD.toFixed(2)} USD (~${(MIN_TRADE_USD / solPrice).toFixed(4)} SOL at $${solPrice.toFixed(2)}/SOL).`,
            );
          }
        }
        return { inRaw: v.lamports };
      }
      const v = validateAnyTokenAmount(amount, inDecimals);
      if (!v.ok || !v.raw) throw new Error(v.error ?? "Invalid amount.");
      // $1 USD floor for any trade. We need the USD price of the *input* mint.
      // Fetch it lazily; if the price is unknown we let the user proceed and
      // surface the check in the quote step instead of blocking here.
      return { inRaw: v.raw };
    }
    const v = validateSellAmount(amount, outDecimals);
    if (!v.ok || !v.raw) throw new Error(v.error ?? "Invalid token amount.");
    return { inRaw: v.raw };
  }

  async function runQuote() {
    setBusy(true);
    setErrorInfo(null);
    setReceipt(null);
    try {
      const parsed = parsedAmounts();
      const outSymbol = symbol;
      // Decide venue
      const tryPump = pumpSupported !== false && inMint === SOL_MINT;
      if (tryPump) {
        try {
          if (side === "buy") {
            const q = await quoteTrade({
              connection,
              mint: props.mint,
              user: wallet.publicKey,
              side,
              solLamports: parsed.inRaw,
              slippagePct: settings.slippagePct,
            });
            setQuote({
              venue: q.venue,
              inMint: SOL_MINT,
              inSymbol: "SOL",
              inDecimals: 9,
              inAmountRaw: parsed.inRaw.toString(),
              outMint: props.mint,
              outSymbol,
              outDecimals,
              outAmountRaw: q.tokenAmountRaw,
              priceImpactPct: q.priceImpactBps == null ? null : q.priceImpactBps / 100,
              feesLamports: q.feesLamports,
              usdValue: solPrice != null ? Number(lamportsToSol(parsed.inRaw)) * solPrice : null,
              notes: q.notes,
              graduated: q.graduated,
            });
            return;
          }
          const q = await quoteTrade({
            connection,
            mint: props.mint,
            user: wallet.publicKey,
            side,
            tokenAmountRaw: parsed.inRaw,
            slippagePct: settings.slippagePct,
          });
          setQuote({
            venue: q.venue,
            inMint: props.mint,
            inSymbol,
            inDecimals: outDecimals,
            inAmountRaw: parsed.inRaw.toString(),
            outMint: SOL_MINT,
            outSymbol: "SOL",
            outDecimals: 9,
            outAmountRaw: q.solLamports,
            priceImpactPct: q.priceImpactBps == null ? null : q.priceImpactBps / 100,
            feesLamports: q.feesLamports,
            usdValue: solPrice != null ? Number(lamportsToSol(new BN(q.solLamports))) * solPrice : null,
            notes: q.notes,
            graduated: q.graduated,
          });
          return;
        } catch (err) {
          if (!isPumpTokenError(err)) {
            throw new Error(friendlyOnchainError(err, props.mint));
          }
          // falls through to jupiter
          setPumpSupported(false);
        }
      }
      // Jupiter path (always available)
      const jupQuote = await jupQuoteFor(parsed.inRaw);
      const outMint = side === "buy" ? props.mint : SOL_MINT;
      const outSymbolResolved = side === "buy" ? symbol : "SOL";
      const outDecimalsResolved = side === "buy" ? outDecimals : 9;
      const prices = await fetchJupiterUsdPrice([inMint, outMint]);
      const inUsd = prices[inMint] ?? (inMint === SOL_MINT ? solPrice : null);
      const usd = inUsd != null
        ? inUsd * Number(uiToTokensDisplay(amount, inDecimals))
        : null;
      setQuote({
        venue: "jupiter",
        inMint,
        inSymbol,
        inDecimals,
        inAmountRaw: parsed.inRaw.toString(),
        outMint,
        outSymbol: outSymbolResolved,
        outDecimals: outDecimalsResolved,
        outAmountRaw: jupQuote.outAmount,
        priceImpactPct: jupQuote.priceImpactPct
          ? Number(jupQuote.priceImpactPct)
          : null,
        feesLamports: "0",
        usdValue: usd,
        notes: [],
        graduated: false,
      });
    } catch (err) {
      setQuote(null);
      setErrorInfo(classifyError(friendlyOnchainError(err, props.mint)));
    } finally {
      setBusy(false);
    }
  }

  async function jupQuoteFor(inputRaw: BN): Promise<JupiterQuote> {
    if (side === "buy") {
      return fetchJupiterQuote({
        inputMint: inMint,
        outputMint: props.mint,
        amountRaw: inputRaw.toString(),
        slippageBps: Math.round(settings.slippagePct * 100),
        swapMode: "ExactIn",
      });
    }
    return fetchJupiterQuote({
      inputMint: props.mint,
      outputMint: SOL_MINT,
      amountRaw: inputRaw.toString(),
      slippageBps: Math.round(settings.slippagePct * 100),
      swapMode: "ExactIn",
    });
  }

  async function execute() {
    setBusy(true);
    setErrorInfo(null);
    try {
      const parsed = parsedAmounts();
      // $1 USD minimum gate, applied to both pump and Jupiter. Uses the
      // current SOL price for SOL input; for non-SOL input we look up the
      // mint's USD price.
      {
        const usdPrice = solPrice ?? (await getSolUsd());
        if (usdPrice != null && Number.isFinite(usdPrice) && usdPrice > 0) {
          let usd: number | null = null;
          if (side === "buy") {
            if (inMint === SOL_MINT) {
              usd = (Number(parsed.inRaw.toString()) / 1e9) * usdPrice;
            } else {
              const prices = await fetchJupiterUsdPrice([inMint]);
              const p = prices[inMint];
              if (p != null && Number.isFinite(p) && p > 0) {
                const ui = Number(tokensToUi(parsed.inRaw, inDecimals));
                usd = ui * p;
              }
            }
          } else {
            // Sell: we know the output SOL value is approx the inAmount's USD
            // divided by SOL/USD. The trade is meaningful only if the position
            // is worth at least $1 to begin with.
            const ui = Number(tokensToUi(parsed.inRaw, outDecimals));
            const known = getKnownTokenMeta(props.mint);
            const p =
              known?.symbol === "USDC" || known?.symbol === "USDT"
                ? 1
                : (await fetchJupiterUsdPrice([props.mint]))[props.mint] ?? null;
            if (p != null && Number.isFinite(p) && p > 0) usd = ui * p;
          }
          if (usd != null && usd < MIN_TRADE_USD) {
            throw new Error(
              `Minimum trade size is $${MIN_TRADE_USD.toFixed(2)} USD. This trade is ≈ $${usd.toFixed(2)}.`,
            );
          }
        }
      }
      // Pre-flight SOL balance (only relevant for SOL input or pump program ATA rent).
      if (side === "buy" && !settings.simulateMode && wallet.publicKey && inMint === SOL_MINT) {
        const lamports = parsed.inRaw;
        const { getBalanceWithFallback } = await import("@/lib/connection");
        const { lamports: bal } = await getBalanceWithFallback(connection, wallet.publicKey);
        const bufferLamports = Math.round(MIN_SOL_RESERVED_FOR_FEES * 1e9);
        const need = lamports.toNumber() + bufferLamports;
        if (bal < need) {
          const have = (bal / 1e9).toFixed(4);
          const want = (need / 1e9).toFixed(4);
          throw new Error(`Insufficient SOL: wallet has ${have} SOL, trade needs ~${want} SOL.`);
        }
      }
      const tryPump = pumpSupported !== false && inMint === SOL_MINT && quote?.venue !== "jupiter";
      let result: { receipt: { signature: string | null; simulated: boolean; paper: boolean; side: "buy" | "sell"; mint: string; solLamports: string; tokenAmountRaw: string }; quote: { solLamports: string; tokenAmountRaw: string; feesLamports: string; priceImpactBps: number | null; venue: Venue; graduated: boolean } } | null = null;
      if (tryPump) {
        try {
          result = await simulateAndSend({
            connection,
            wallet,
            mint: props.mint,
            side,
            slippagePct: settings.slippagePct,
            paper: settings.simulateMode,
            ...(side === "buy"
              ? { solLamports: parsed.inRaw }
              : { tokenAmountRaw: parsed.inRaw }),
          });
        } catch (err) {
          if (!isPumpTokenError(err)) throw new Error(friendlyOnchainError(err, props.mint));
          setPumpSupported(false);
        }
      }
      if (!result) {
        // Jupiter path
        if (settings.simulateMode) {
          // paper fill
          const q = await jupQuoteFor(parsed.inRaw);
          const solEquivalentLamports = await computeSolEquivalentLamports(
            connection,
            side,
            inMint,
            parsed.inRaw,
            q.outAmount,
            solPrice,
          );
          const effectiveCost = solEquivalentLamports ?? parsed.inRaw.toString();
          result = {
            receipt: {
              signature: null,
              simulated: true,
              paper: true,
              side,
              mint: props.mint,
              solLamports: effectiveCost,
              tokenAmountRaw: side === "buy" ? q.outAmount : parsed.inRaw.toString(),
            },
            quote: {
              solLamports: effectiveCost,
              tokenAmountRaw: side === "buy" ? q.outAmount : parsed.inRaw.toString(),
              feesLamports: "0",
              priceImpactBps: null,
              venue: "jupiter",
              graduated: false,
            },
          };
        } else {
          const q = await jupQuoteFor(parsed.inRaw);
          const { signature } = await jupiterSimulateAndSend({
            connection,
            wallet,
            quote: q,
            paper: false,
          });
          // For Jupiter buys paid in non-SOL, the "solLamports" cost in the
          // local position ledger should still be the SOL-equivalent value so
          // the PnL math (cost → SOL value) is consistent.
          const solEquivalentLamports = await computeSolEquivalentLamports(
            connection,
            side,
            inMint,
            parsed.inRaw,
            q.outAmount,
            solPrice,
          );
          const effectiveCost = solEquivalentLamports ?? parsed.inRaw.toString();
          result = {
            receipt: {
              signature,
              simulated: true,
              paper: false,
              side,
              mint: props.mint,
              solLamports: effectiveCost,
              tokenAmountRaw: side === "buy" ? q.outAmount : parsed.inRaw.toString(),
            },
            quote: {
              solLamports: effectiveCost,
              tokenAmountRaw: side === "buy" ? q.outAmount : parsed.inRaw.toString(),
              feesLamports: "0",
              priceImpactBps: q.priceImpactPct ? Math.round(Number(q.priceImpactPct) * 100) : null,
              venue: "jupiter",
              graduated: false,
            },
          };
        }
      }
      setQuote((prev) =>
        prev
          ? {
              ...prev,
              outAmountRaw: result!.quote.tokenAmountRaw,
              venue: result!.quote.venue,
            }
          : prev,
      );
      upsertPositionFromFill({
        accountId,
        mint: props.mint,
        name: props.name ?? symbol,
        symbol,
        decimals: outDecimals,
        side,
        tokenAmountRaw: new BN(result.receipt.tokenAmountRaw),
        solLamports: new BN(result.receipt.solLamports),
        signature: result.receipt.signature,
        paper: result.receipt.paper,
      });
      // Trigger wallet balance / holdings refresh so the header and Positions
      // page reflect the fill immediately. The WebSocket subscription will
      // also fire on-chain; this is just an immediate UI nudge.
      walletData.refresh();
      const notifLevel = result.receipt.paper ? "info" : "success";
      notify({
        level: notifLevel,
        category: "trade",
        title: result.receipt.paper
          ? `Paper ${side} recorded`
          : `Confirmed ${side} on mainnet`,
        body: `${amount} ${inSymbol} → ${tokensToUi(new BN(result.receipt.tokenAmountRaw), outDecimals)} ${symbol}`,
        key: `trade:${props.mint}:${result.receipt.signature ?? result.receipt.solLamports}`,
        href: "/positions",
        actions: [
          {
            id: "view",
            label: "View positions",
            href: "/positions",
            handler: "open-positions",
            tone: "default",
          },
        ],
        push: true,
        persistent: !result.receipt.paper,
      });
      if (result.receipt.paper) {
        setReceipt({ note: "Paper fill — no transaction sent. Recorded locally for tracking." });
      } else if (result.receipt.signature) {
        setReceipt({
          note: "Confirmed on-chain.",
          url: `${SOLSCAN_TX}${result.receipt.signature}`,
        });
      } else {
        setReceipt({ note: "Submitted to the network." });
      }
      setConfirmOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorInfo(classifyError(msg));
    } finally {
      setBusy(false);
    }
  }

  const amountUi = Number(amount);
  const isValidAmount =
    Number.isFinite(amountUi) && amountUi > 0;
  const amountSol = side === "buy" && inMint === SOL_MINT ? Number(amount) : null;
  const amountUsd =
    solPrice != null && amountSol != null ? amountSol * solPrice : null;
  const venueLabel =
    quote?.venue === "jupiter"
      ? "Jupiter aggregator"
      : quote?.venue === "pump-amm"
        ? "pump-amm"
        : "pump.fun bonding curve";

  return (
    <div className="relative overflow-hidden rounded-xl border border-line glass">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 h-36 w-36 rounded-full bg-neon/10 blur-3xl"
      />
      <div className="relative p-4">
      {!wallet.connected ? (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn/5 p-2.5 text-xs text-warn">
          <p className="font-mono font-semibold">Wallet not connected</p>
          <p className="mt-1 text-mute">
            You can still see live quotes. To execute a trade, connect Phantom (or another
            supported wallet) from the header.
          </p>
        </div>
      ) : null}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CoinImage src={props.imageUri ?? null} alt={symbol} size={32} className="shadow-neon-sm" />
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-semibold">{props.name ?? symbol}</p>
            <p className="font-mono text-[11px] text-mute">${symbol}</p>
          </div>
        </div>
        <div className="text-right">
          {solPrice ? (
            <p className="font-mono text-[11px] text-mute">SOL ≈ <span className="text-info">${solPrice.toFixed(2)}</span></p>
          ) : (
            <p className="font-mono text-[11px] text-mute">SOL price …</p>
          )}
          {props.onClose ? (
            <button
              type="button"
              onClick={props.onClose}
              className="font-mono text-[11px] text-mute hover:text-danger"
            >
              close
            </button>
          ) : null}
        </div>
      </div>

      <div className="mb-3 flex gap-1">
        <button
          type="button"
          onClick={() => {
            setSide("buy");
            setAmount("0.02");
            setQuote(null);
            setErrorInfo(null);
            setReceipt(null);
          }}
          className={`press relative flex-1 overflow-hidden rounded-md py-2.5 font-mono text-sm font-semibold uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon ${
            side === "buy"
              ? "border border-neon/50 bg-gradient-to-r from-neon to-emerald-400 text-ink-950 shadow-[0_0_18px_-4px_rgba(57,255,136,0.6)]"
              : "border border-line bg-ink-850 text-mute hover:border-neon/40 hover:text-white"
          }`}
        >
          Buy {symbol}
        </button>
        <button
          type="button"
          onClick={() => {
            setSide("sell");
            setAmount("1000000");
            setQuote(null);
            setErrorInfo(null);
            setReceipt(null);
          }}
          className={`press relative flex-1 overflow-hidden rounded-md py-2.5 font-mono text-sm font-semibold uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger ${
            side === "sell"
              ? "border border-danger/50 bg-gradient-to-r from-danger to-rose-400 text-white shadow-[0_0_18px_-4px_rgba(255,71,87,0.5)]"
              : "border border-line bg-ink-850 text-mute hover:border-danger/40 hover:text-white"
          }`}
        >
          Sell {symbol}
        </button>
      </div>

      <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-mute">
        {side === "buy" ? "Spend (SOL)" : `Sell amount (${symbol})`}
      </label>
      <div className="mb-1 flex gap-2">
        <input
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setQuote(null);
            setErrorInfo(null);
          }}
          inputMode="decimal"
          placeholder={side === "buy" ? "0.0" : "amount of token"}
          className="min-w-0 flex-1 rounded-md border border-line bg-ink-850 px-3 py-2.5 font-mono text-base outline-none focus:border-neon focus:bg-ink-900 sm:text-sm"
        />
      </div>
      {side === "buy" ? (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {["0.001", "0.01", "0.05", "0.1", "0.5", "1"].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setAmount(preset);
                setQuote(null);
                setErrorInfo(null);
              }}
              className={`press inline-flex min-h-[36px] items-center rounded-md border px-2.5 py-1.5 font-mono text-xs hover:border-neon hover:text-neon focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon ${
                amount === preset
                  ? "border-neon/50 bg-neon/10 text-neon"
                  : "border-line bg-ink-850 text-mute"
              }`}
            >
              {preset}
            </button>
          ))}
          {inMint === SOL_MINT && walletData.sol != null && walletData.sol > 0.005 ? (
            <button
              type="button"
              onClick={() => {
                const max = Math.max(0, (walletData.sol ?? 0) - MIN_SOL_RESERVED_FOR_FEES);
                if (max <= 0) return;
                setAmount(max.toFixed(4));
                setQuote(null);
                setErrorInfo(null);
              }}
              className="press ml-auto inline-flex min-h-[36px] items-center rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 font-mono text-xs text-warn hover:border-warn hover:bg-warn/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn"
              title="Use entire balance minus fees"
            >
              MAX
            </button>
          ) : null}
        </div>
      ) : null}
      {amountUsd != null ? (
        <p className="mb-2 font-mono text-[11px] text-mute">
          ≈ <span className="text-info">${amountUsd.toFixed(2)}</span> USD
        </p>
      ) : (
        <div className="mb-2" />
      )}

      {side === "buy" ? (
        <label className="mb-3 block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-mute">
            Pay with
          </span>
          <select
            value={inMint}
            onChange={(e) => {
              setInMint(e.target.value);
              setQuote(null);
              setErrorInfo(null);
              if (e.target.value !== SOL_MINT) {
                setPumpSupported(false);
              }
            }}
            className="w-full rounded-md border border-line bg-ink-850 px-3 py-2 font-mono text-sm focus:border-neon focus:outline-none"
          >
            {inputOptions.map((o) => (
              <option key={o.mint} value={o.mint}>
                {o.symbol} · {shortenAddress(o.mint, 4, 4)}
              </option>
            ))}
          </select>
          {inBalance != null ? (
            <p className="mt-1 font-mono text-[11px] text-mute">
              Balance:{" "}
              <span className="text-zinc-200">
                {inBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {inSymbol}
              </span>
            </p>
          ) : null}
          {inMint !== SOL_MINT ? (
            <p className="mt-1 rounded-md border border-warn/30 bg-warn/5 px-2 py-1 font-mono text-[11px] text-warn">
              Will route through Jupiter. The pump program only accepts SOL.
            </p>
          ) : pumpSupported === false ? (
            <p className="mt-1 rounded-md border border-warn/30 bg-warn/5 px-2 py-1 font-mono text-[11px] text-warn">
              This token is not on pump.fun. Buy will route through Jupiter.
            </p>
          ) : null}
        </label>
      ) : null}

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => void runQuote()}
          disabled={busy || !isValidAmount}
          className="press flex-1 rounded-md border border-line bg-ink-850 py-2.5 font-mono text-xs hover:border-neon hover:text-neon focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon disabled:opacity-40"
        >
          {busy ? "Quoting…" : "Get quote"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={busy || !quote}
          className={`press relative flex-1 overflow-hidden rounded-md py-2.5 font-mono text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 disabled:opacity-40 ${
            side === "buy"
              ? "border border-neon/50 bg-gradient-to-r from-neon to-emerald-400 text-ink-950 focus-visible:ring-neon"
              : "border border-danger/50 bg-gradient-to-r from-danger to-rose-400 focus-visible:ring-danger"
          }`}
        >
          {settings.simulateMode ? "Paper fill" : `Confirm ${side === "buy" ? "buy" : "sell"}`}
        </button>
      </div>

      {quote ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-line bg-ink-850 p-2.5 font-mono text-xs">
          <dt className="text-mute">You receive</dt>
          <dd className="text-right text-white">
            {side === "buy"
              ? `${tokensToUi(new BN(quote.outAmountRaw), quote.outDecimals)} ${quote.outSymbol}`
              : `${lamportsToSol(new BN(quote.outAmountRaw))} SOL`}
            {quote.usdValue != null ? (
              <span className="block text-[10px] text-info">≈ ${quote.usdValue.toFixed(2)}</span>
            ) : null}
          </dd>
          <dt className="text-mute">Venue</dt>
          <dd className="text-right text-white">
            {venueLabel}
            {quote.graduated ? " · graduated" : ""}
          </dd>
          <dt className="text-mute">Pay with</dt>
          <dd className="text-right text-white">
            {quote.inSymbol} · {shortenAddress(quote.inMint, 4, 4)}
          </dd>
          <dt className="text-mute">Impact</dt>
          <dd className="text-right text-white">
            {quote.priceImpactPct == null
              ? "—"
              : `${quote.priceImpactPct.toFixed(2)}%`}
          </dd>
          <dt className="text-mute">Slippage</dt>
          <dd className="text-right text-white">{settings.slippagePct}%</dd>
        </dl>
      ) : (
        <p className="rounded-md border border-dashed border-line bg-ink-850 p-3 text-center font-mono text-xs text-mute">
          {side === "buy"
            ? inMint === SOL_MINT && pumpSupported !== false
              ? `Pick how much SOL to spend. Min $${MIN_TRADE_USD.toFixed(2)} USD (~${solPrice ? (MIN_TRADE_USD / solPrice).toFixed(4) : "0.0001"} SOL).`
              : `Pick how much to spend. Min $${MIN_TRADE_USD.toFixed(2)} USD. Routes through Jupiter.`
            : `Pick how many tokens to sell. Min $${MIN_TRADE_USD.toFixed(2)} USD.`}
        </p>
      )}

      {receipt ? (
        <div className="mt-3 space-y-1 rounded-md border border-neon/40 bg-neon/5 p-2.5 text-xs text-neon">
          <p className="font-mono">{receipt.note}</p>
          {receipt.url ? (
            <a
              href={receipt.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono underline hover:no-underline"
            >
              View on Solscan ↗
            </a>
          ) : null}
        </div>
      ) : null}

      {errorInfo ? (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger/5 p-3 text-xs">
          <p className="font-mono font-semibold text-danger">{errorInfo.title}</p>
          <p className="mt-1 font-mono text-mute">{errorInfo.detail}</p>
          {errorInfo.fixes.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-mute">
              {errorInfo.fixes.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={
          settings.simulateMode
            ? "Record paper fill?"
            : side === "buy"
              ? `Confirm BUY on mainnet`
              : `Confirm SELL on mainnet`
        }
        danger={!settings.simulateMode}
        busy={busy}
        confirmLabel={
          settings.simulateMode
            ? "Record paper"
            : side === "buy"
              ? `Buy ${symbol}`
              : `Sell ${symbol}`
        }
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void execute()}
        body={
          <div className="space-y-2 font-mono text-xs">
            <p>
              {settings.simulateMode
                ? "Simulate mode — no transaction is broadcast."
                : `Live mainnet trade. Wallet must sign in Phantom. This app never asks for a private key.`}
            </p>
            {quote ? (
              <>
                <p>
                  {side === "buy"
                    ? `Spend ${amount} ${quote.inSymbol} → ~${tokensToUi(new BN(quote.outAmountRaw), quote.outDecimals)} ${quote.outSymbol}`
                    : `Sell ${tokensToUi(new BN(quote.inAmountRaw), quote.inDecimals)} ${quote.inSymbol} → ~${lamportsToSol(new BN(quote.outAmountRaw))} SOL`}
                </p>
                <p>Via {venueLabel} · slippage {settings.slippagePct}%</p>
                {quote.usdValue != null ? (
                  <p>≈ ${quote.usdValue.toFixed(2)}</p>
                ) : null}
              </>
            ) : null}
          </div>
        }
      />
      </div>
    </div>
  );
}

function uiToTokensDisplay(input: string, decimals: number): string {
  try {
    const raw = uiToTokens(input, decimals);
    return tokensToUi(raw, decimals);
  } catch {
    return "0";
  }
}

// Backwards-compat re-export
export { QuickTradePanel as TradePanel };

/**
 * Convert the input or output amount of a Jupiter quote into a SOL-denominated
 * lamports value, so the local position ledger stays in SOL terms.
 *
 *  - For SOL input/output: the raw amount is already in lamports.
 *  - For non-SOL: we use the Jupiter USD price feed for that mint and divide
 *    by the current SOL price. This is good enough for tracking PnL on the
 *    local positions page; for the actual on-chain fill the user already paid
 *    in whatever token they chose.
 */
async function computeSolEquivalentLamports(
  connection: Connection,
  side: "buy" | "sell",
  inMint: string,
  inRaw: BN,
  outRaw: string,
  solPriceUsd: number | null,
): Promise<string | null> {
  if (inMint === SOL_MINT) return inRaw.toString();
  if (side === "sell" && outRaw) {
    // Selling any token → receiving SOL. The output from Jupiter is in
    // SOL lamports already.
    return outRaw;
  }
  // side === "buy" with non-SOL input: USD value of input / SOL USD price.
  const inDecimals = await fetchMintDecimals(connection, inMint);
  const uiAmount = Number(tokensToUi(inRaw, inDecimals));
  if (!Number.isFinite(uiAmount) || uiAmount <= 0) return null;
  const prices = await fetchJupiterUsdPrice([inMint]);
  const usdPrice = prices[inMint];
  if (usdPrice == null || !Number.isFinite(usdPrice) || usdPrice <= 0) return null;
  let usd: number;
  if (inMint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" || inMint === "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB") {
    usd = uiAmount; // stablecoin
  } else {
    usd = uiAmount * usdPrice;
  }
  const solUsd = solPriceUsd;
  if (solUsd == null || !Number.isFinite(solUsd) || solUsd <= 0) return null;
  const solAmount = usd / solUsd;
  return new BN(Math.max(0, Math.floor(solAmount * 1e9)).toString()).toString();
}
