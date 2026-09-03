"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { useEffect, useState } from "react";
import { SOLSCAN_TX, TOKEN_DECIMALS } from "@/lib/constants";
import { lamportsToSol, tokensToUi } from "@/lib/format";
import { upsertPositionFromFill } from "@/lib/positions";
import { friendlyOnchainError, quoteTrade } from "@/lib/sdk";
import { simulateAndSend } from "@/lib/trade";
import {
  MIN_BUY_SOL,
  MIN_SOL_RESERVED_FOR_FEES,
  validateBuyAmount,
  validateSellAmount,
} from "@/lib/trade-limits";
import { CoinImage } from "./CoinImage";
import { ConfirmDialog } from "./ConfirmDialog";
import { useSettings } from "./SettingsProvider";

type Props = {
  mint: string;
  name?: string;
  symbol?: string;
  imageUri?: string;
  initialSide?: "buy" | "sell";
  onClose?: () => void;
  /** Compact mode for use inside modals on the markets list. */
  compact?: boolean;
};

type ErrorHint = {
  title: string;
  detail: string;
  fixes: string[];
};

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
        `Lower the trade size (minimum is ${MIN_BUY_SOL} SOL).`,
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
        `Minimum buy is ${MIN_BUY_SOL} SOL on pump.fun's bonding curve.`,
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
  if (lower.includes("403") || lower.includes("forbidden")) {
    return {
      title: "RPC blocked your request",
      detail: raw,
      fixes: [
        "The public mainnet RPC is rate-limited.",
        "Set a private RPC in Settings (Helius, QuickNode, Triton).",
        "Set NEXT_PUBLIC_SOLANA_RPC_URL in your .env.local.",
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

export function QuickTradePanel(props: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { settings } = useSettings();
  const decimals = TOKEN_DECIMALS;
  const symbol = props.symbol ?? "???";

  const [side, setSide] = useState<"buy" | "sell">(props.initialSide ?? "buy");
  const [amount, setAmount] = useState(props.initialSide === "sell" ? "1000000" : "0.02");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<{ tokensOut: string; solOut: string; fees: string; impact: number | null; venue: string; graduated: boolean } | null>(null);
  const [errorInfo, setErrorInfo] = useState<ErrorHint | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receipt, setReceipt] = useState<{ note: string; url?: string } | null>(null);
  const [solPrice, setSolPrice] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/sol-price", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { usd?: number | null }) => {
        if (j.usd && Number.isFinite(j.usd)) setSolPrice(j.usd);
      })
      .catch(() => undefined);
  }, []);

  function parsedAmounts(): { solLamports?: BN; tokenAmountRaw?: BN } {
    if (side === "buy") {
      const v = validateBuyAmount(amount);
      if (!v.ok || !v.lamports) throw new Error(v.error ?? "Invalid SOL amount.");
      return { solLamports: v.lamports };
    }
    const v = validateSellAmount(amount, decimals);
    if (!v.ok || !v.raw) throw new Error(v.error ?? "Invalid token amount.");
    return { tokenAmountRaw: v.raw };
  }

  async function runQuote() {
    setBusy(true);
    setErrorInfo(null);
    setReceipt(null);
    try {
      const parsed = parsedAmounts();
      const q = await quoteTrade({
        connection,
        mint: props.mint,
        user: wallet.publicKey,
        side,
        slippagePct: settings.slippagePct,
        ...parsed,
      });
      setQuote({
        tokensOut: q.tokenAmountRaw,
        solOut: q.solLamports,
        fees: q.feesLamports,
        impact: q.priceImpactBps,
        venue: q.venue,
        graduated: q.graduated,
      });
    } catch (err) {
      setQuote(null);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorInfo(classifyError(friendlyOnchainError(err, props.mint)));
      void msg;
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    setBusy(true);
    setErrorInfo(null);
    try {
      const parsed = parsedAmounts();
      if (side === "buy" && !settings.simulateMode && wallet.publicKey) {
        const lamports = parsed.solLamports!;
        const bal = await connection.getBalance(wallet.publicKey, "confirmed");
        const bufferLamports = Math.round(MIN_SOL_RESERVED_FOR_FEES * 1e9);
        const need = lamports.toNumber() + bufferLamports;
        if (bal < need) {
          const have = (bal / 1e9).toFixed(4);
          const want = (need / 1e9).toFixed(4);
          throw new Error(
            `Insufficient SOL: wallet has ${have} SOL, trade needs ~${want} SOL.`,
          );
        }
      }
      let r;
      try {
        r = await simulateAndSend({
          connection,
          wallet,
          mint: props.mint,
          side,
          slippagePct: settings.slippagePct,
          paper: settings.simulateMode,
          ...parsed,
        });
      } catch (inner) {
        throw new Error(friendlyOnchainError(inner, props.mint));
      }
      setQuote({
        tokensOut: r.quote.tokenAmountRaw,
        solOut: r.quote.solLamports,
        fees: r.quote.feesLamports,
        impact: r.quote.priceImpactBps,
        venue: r.quote.venue,
        graduated: r.quote.graduated,
      });
      upsertPositionFromFill({
        mint: props.mint,
        name: props.name ?? symbol,
        symbol,
        decimals,
        side,
        tokenAmountRaw: new BN(r.receipt.tokenAmountRaw),
        solLamports: new BN(r.receipt.solLamports),
        signature: r.receipt.signature,
        paper: r.receipt.paper,
      });
      if (r.receipt.paper) {
        setReceipt({ note: "Paper fill — no transaction sent. Recorded locally for tracking." });
      } else if (r.receipt.signature) {
        setReceipt({
          note: "Confirmed on-chain.",
          url: `${SOLSCAN_TX}${r.receipt.signature}`,
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

  const amountSol = side === "buy" ? Number(amount) : null;
  const amountUsd = solPrice != null && amountSol != null ? amountSol * solPrice : null;

  return (
    <div className="rounded border border-line bg-ink-800 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CoinImage src={props.imageUri ?? null} alt={symbol} size={28} />
          <div className="min-w-0">
            <p className="truncate font-mono text-sm">{props.name ?? symbol}</p>
            <p className="font-mono text-[11px] text-mute">{symbol}</p>
          </div>
        </div>
        <div className="text-right">
          {solPrice ? (
            <p className="font-mono text-[11px] text-mute">SOL ≈ ${solPrice.toFixed(2)}</p>
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
          className={`flex-1 rounded py-2 font-mono text-sm uppercase ${
            side === "buy" ? "bg-neon text-ink-950" : "bg-ink-700 text-mute hover:text-white"
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
          className={`flex-1 rounded py-2 font-mono text-sm uppercase ${
            side === "sell" ? "bg-danger text-white" : "bg-ink-700 text-mute hover:text-white"
          }`}
        >
          Sell {symbol}
        </button>
      </div>

      <label className="mb-1 block font-mono text-[11px] uppercase text-mute">
        {side === "buy" ? "Spend (SOL)" : `Sell amount (${symbol})`}
      </label>
      <div className="mb-3 flex gap-2">
        <input
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setQuote(null);
            setErrorInfo(null);
          }}
          inputMode="decimal"
          className="flex-1 rounded border border-line bg-ink-900 px-3 py-2 font-mono text-sm outline-none focus:border-neon"
        />
        {side === "buy" ? (
          <div className="flex gap-1">
            {["0.01", "0.05", "0.1", "0.5"].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setAmount(preset);
                  setQuote(null);
                  setErrorInfo(null);
                }}
                className="rounded border border-line px-2 font-mono text-[11px] text-mute hover:border-neon hover:text-neon"
              >
                {preset}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {amountUsd != null ? (
        <p className="-mt-2 mb-2 font-mono text-[11px] text-mute">
          ≈ ${amountUsd.toFixed(2)} USD
        </p>
      ) : null}

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => void runQuote()}
          disabled={busy}
          className="flex-1 rounded border border-line py-2 font-mono text-xs hover:border-neon disabled:opacity-40"
        >
          {busy ? "Quoting…" : "Get quote"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={busy || !quote}
          className={`flex-1 rounded py-2 font-mono text-xs text-white disabled:opacity-40 ${
            side === "buy" ? "bg-neon text-ink-950" : "bg-danger"
          }`}
        >
          {settings.simulateMode ? "Paper fill" : `Confirm ${side === "buy" ? "buy" : "sell"}`}
        </button>
      </div>

      {quote ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded border border-line bg-ink-900 p-2 font-mono text-xs">
          <dt className="text-mute">{side === "buy" ? "You receive" : "You receive"}</dt>
          <dd>
            {side === "buy"
              ? `${tokensToUi(new BN(quote.tokensOut), decimals)} ${symbol}`
              : `${lamportsToSol(new BN(quote.solOut))} SOL`}
            {solPrice != null && side === "buy"
              ? ` (≈ $${(lamportsToSol(new BN(quote.solOut), 9).includes(".")
                  ? Number(lamportsToSol(new BN(quote.solOut), 9)) * solPrice
                  : 0
                ).toFixed(2)})`
              : null}
          </dd>
          <dt className="text-mute">Venue</dt>
          <dd>{quote.venue}{quote.graduated ? " · graduated" : " · bonding curve"}</dd>
          <dt className="text-mute">Fees</dt>
          <dd>{lamportsToSol(new BN(quote.fees))} SOL</dd>
          <dt className="text-mute">Impact</dt>
          <dd>{quote.impact == null ? "—" : `${(quote.impact / 100).toFixed(2)}%`}</dd>
          <dt className="text-mute">Slippage</dt>
          <dd>{settings.slippagePct}%</dd>
        </dl>
      ) : (
        <p className="rounded border border-dashed border-line bg-ink-900 p-3 text-center font-mono text-xs text-mute">
          {side === "buy"
            ? `Pick how much SOL to spend. Min ${MIN_BUY_SOL} SOL.`
            : "Pick how many tokens to sell."}
        </p>
      )}

      {receipt ? (
        <div className="mt-3 rounded border border-neon/40 bg-neon/5 p-2 text-xs text-neon">
          {receipt.note}
          {receipt.url ? (
            <>
              {" "}
              <a href={receipt.url} target="_blank" rel="noreferrer" className="underline">
                View on Solscan
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      {errorInfo ? (
        <div className="mt-3 rounded border border-danger/40 bg-danger/5 p-3 text-xs">
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
              <p>
                {side === "buy"
                  ? `Spend ${amount} SOL → ~${tokensToUi(new BN(quote.tokensOut), decimals)} ${symbol}`
                  : `Sell ${tokensToUi(new BN(quote.tokensOut), decimals)} ${symbol} → ~${lamportsToSol(new BN(quote.solOut))} SOL`}
              </p>
            ) : null}
          </div>
        }
      />
    </div>
  );
}

// Backwards-compat re-export
export { QuickTradePanel as TradePanel };