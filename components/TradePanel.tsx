"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { useState } from "react";
import { SOLSCAN_TX, TOKEN_DECIMALS } from "@/lib/constants";
import { lamportsToSol, solToLamports, tokensToUi, uiToTokens } from "@/lib/format";
import { upsertPositionFromFill } from "@/lib/positions";
import { quoteTrade } from "@/lib/sdk";
import { simulateAndSend } from "@/lib/trade";
import {
  MIN_BUY_SOL,
  MIN_SOL_RESERVED_FOR_FEES,
  validateBuyAmount,
  validateSellAmount,
} from "@/lib/trade-limits";
import type { QuoteResult, TradeSide } from "@/lib/types";
import { useSettings } from "./SettingsProvider";
import { ConfirmDialog } from "./ConfirmDialog";

export function TradePanel(props: {
  mint: string;
  name: string;
  symbol: string;
  decimals?: number;
}) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { settings } = useSettings();
  const decimals = props.decimals ?? TOKEN_DECIMALS;
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("0.01");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptNote, setReceiptNote] = useState<string | null>(null);

  function parsedAmounts(): { solLamports?: BN; tokenAmountRaw?: BN } {
    if (side === "buy") {
      const v = validateBuyAmount(amount);
      if (!v.ok || !v.lamports) {
        throw new Error(v.error ?? "Invalid SOL amount.");
      }
      return { solLamports: v.lamports };
    }
    const v = validateSellAmount(amount, decimals);
    if (!v.ok || !v.raw) {
      throw new Error(v.error ?? "Invalid token amount.");
    }
    return { tokenAmountRaw: v.raw };
  }

  async function runQuote() {
    setBusy(true);
    setError(null);
    setReceiptUrl(null);
    setReceiptNote(null);
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
      setQuote(q);
    } catch (err) {
      setQuote(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    setBusy(true);
    setError(null);
    try {
      const parsed = parsedAmounts();
      if (
        side === "buy" &&
        !settings.simulateMode &&
        wallet.publicKey
      ) {
        const lamports = parsed.solLamports!;
        const bal = await connection.getBalance(wallet.publicKey, "confirmed");
        const bufferLamports = Math.round(MIN_SOL_RESERVED_FOR_FEES * 1e9);
        const need = lamports.toNumber() + bufferLamports;
        if (bal < need) {
          const have = (bal / 1e9).toFixed(4);
          const want = (need / 1e9).toFixed(4);
          throw new Error(
            `Insufficient SOL: wallet has ${have} SOL, trade needs ~${want} SOL (size + ~${MIN_SOL_RESERVED_FOR_FEES} SOL for ATA rent + fees). Top up or lower the size.`,
          );
        }
      }
      const { receipt, quote: filled } = await simulateAndSend({
        connection,
        wallet,
        mint: props.mint,
        side,
        slippagePct: settings.slippagePct,
        paper: settings.simulateMode,
        ...parsed,
      });
      setQuote(filled);
      upsertPositionFromFill({
        mint: props.mint,
        name: props.name,
        symbol: props.symbol,
        decimals,
        side,
        tokenAmountRaw: new BN(receipt.tokenAmountRaw),
        solLamports: new BN(receipt.solLamports),
        signature: receipt.signature,
        paper: receipt.paper,
      });
      if (receipt.paper) {
        setReceiptNote("Paper fill recorded. No transaction was sent.");
        setReceiptUrl(null);
      } else if (receipt.signature) {
        setReceiptNote("Confirmed on-chain.");
        setReceiptUrl(`${SOLSCAN_TX}${receipt.signature}`);
      }
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-line bg-ink-800 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase text-mute">Trade</span>
        <span className="font-mono text-[11px] text-mute">{props.symbol}</span>
      </div>
      <div className="mb-3 flex gap-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSide(s);
              setQuote(null);
              setAmount(s === "buy" ? "0.01" : "1000");
            }}
            className={`flex-1 rounded py-2 font-mono text-sm uppercase ${
              side === s
                ? s === "buy"
                  ? "bg-neon text-ink-950"
                  : "bg-danger text-white"
                : "bg-ink-700 text-mute"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <label className="mb-1 block font-mono text-[11px] uppercase text-mute">
        {side === "buy" ? "SOL in" : `${props.symbol} in`}
      </label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="mb-3 w-full rounded border border-line bg-ink-900 px-3 py-2 font-mono text-sm outline-none focus:border-neon"
      />

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => void runQuote()}
          disabled={busy}
          className="flex-1 rounded border border-line py-2 font-mono text-xs hover:border-neon"
        >
          {busy ? "Quoting…" : "Quote"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={busy || !quote}
          className="flex-1 rounded bg-ink-600 py-2 font-mono text-xs text-white disabled:opacity-40"
        >
          {settings.simulateMode ? "Paper fill" : "Review live trade"}
        </button>
      </div>

      {quote ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs">
          <dt className="text-mute">Venue</dt>
          <dd>{quote.venue}</dd>
          <dt className="text-mute">{side === "buy" ? "Tokens out" : "SOL out"}</dt>
          <dd>
            {side === "buy"
              ? `${tokensToUi(new BN(quote.tokenAmountRaw), decimals)} ${props.symbol}`
              : `${lamportsToSol(new BN(quote.solLamports))} SOL`}
          </dd>
          <dt className="text-mute">Fees</dt>
          <dd>{lamportsToSol(new BN(quote.feesLamports))} SOL</dd>
          <dt className="text-mute">Impact</dt>
          <dd>
            {quote.priceImpactBps == null
              ? "—"
              : `${(quote.priceImpactBps / 100).toFixed(2)}%`}
          </dd>
          <dt className="text-mute">Slippage</dt>
          <dd>{quote.slippagePct}%</dd>
        </dl>
      ) : (
        <p className="font-mono text-xs text-mute">Quote a size before trading.</p>
      )}

      {error ? (
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-danger/10 p-2 font-mono text-[11px] text-danger">
          {error}
        </pre>
      ) : null}
      {receiptNote ? (
        <p className="mt-3 text-xs text-neon">
          {receiptNote}{" "}
          {receiptUrl ? (
            <a href={receiptUrl} target="_blank" rel="noreferrer" className="underline">
              Solscan
            </a>
          ) : null}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={settings.simulateMode ? "Confirm paper fill" : "Confirm LIVE trade"}
        danger={!settings.simulateMode}
        busy={busy}
        confirmLabel={
          settings.simulateMode
            ? "Record paper fill"
            : side === "buy"
              ? "Buy on mainnet"
              : "Sell on mainnet"
        }
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void execute()}
        body={
          <div className="space-y-2 font-mono text-xs">
            <p>
              {settings.simulateMode
                ? "Simulate mode is ON. No transaction will be sent."
                : "This spends real SOL / tokens on Solana mainnet. Simulation runs first; the wallet still must sign."}
            </p>
            <p>
              {side.toUpperCase()} {props.symbol} @ slippage {settings.slippagePct}%
            </p>
            {quote ? (
              <p>
                {side === "buy"
                  ? `Spend ${lamportsToSol(new BN(quote.solLamports))} SOL → ~${tokensToUi(new BN(quote.tokenAmountRaw), decimals)} tokens`
                  : `Sell ${tokensToUi(new BN(quote.tokenAmountRaw), decimals)} → ~${lamportsToSol(new BN(quote.solLamports))} SOL`}
              </p>
            ) : null}
            <p>Wallet signs in the browser. This app never asks for a private key.</p>
          </div>
        }
      />
    </div>
  );
}
