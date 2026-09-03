"use client";

import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { quoteTrade, buildTradeInstructions } from "./sdk";
import type { QuoteResult, TradeReceipt, TradeSide } from "./types";

async function composeVersionedTx(args: {
  connection: Connection;
  payer: PublicKey;
  ixs: TransactionInstruction[];
}): Promise<{ tx: VersionedTransaction; blockhash: string; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } =
    await args.connection.getLatestBlockhash("confirmed");
  const budget = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
  ];
  const message = new TransactionMessage({
    payerKey: args.payer,
    recentBlockhash: blockhash,
    instructions: [...budget, ...args.ixs],
  }).compileToV0Message();
  return {
    tx: new VersionedTransaction(message),
    blockhash,
    lastValidBlockHeight,
  };
}

export async function simulateAndSend(args: {
  connection: Connection;
  wallet: WalletContextState;
  mint: string;
  side: TradeSide;
  solLamports?: BN;
  tokenAmountRaw?: BN;
  slippagePct: number;
  paper: boolean;
  preQuote?: QuoteResult;
}): Promise<{ receipt: TradeReceipt; quote: QuoteResult }> {
  const user = args.wallet.publicKey;
  if (!user) throw new Error("Connect a Solana wallet first. This app never asks for a private key.");

  let quote = args.preQuote;
  if (!quote) {
    quote = await quoteTrade({
      connection: args.connection,
      mint: args.mint,
      user,
      side: args.side,
      solLamports: args.solLamports,
      tokenAmountRaw: args.tokenAmountRaw,
      slippagePct: args.slippagePct,
    });
  }

  if (args.paper) {
    return {
      quote,
      receipt: {
        signature: null,
        simulated: true,
        paper: true,
        side: args.side,
        mint: args.mint,
        solLamports: quote.solLamports,
        tokenAmountRaw: quote.tokenAmountRaw,
      },
    };
  }

  if (args.side === "buy" && quote.graduated) {
    throw new Error("Coin graduated after quote. Pipeline will not buy.");
  }

  const { ixs } = await buildTradeInstructions({
    connection: args.connection,
    mint: args.mint,
    user,
    side: args.side,
    solLamports:
      args.side === "buy"
        ? args.solLamports
        : new BN(quote.solLamports),
    tokenAmountRaw:
      args.side === "sell"
        ? args.tokenAmountRaw
        : new BN(quote.tokenAmountRaw),
    slippagePct: args.slippagePct,
  });

  if (args.side === "buy" && quote.graduated) {
    throw new Error(
      `Coin graduated during execution. Graduated: ${quote.graduated}, venue: ${quote.venue}. Aborting.`,
    );
  }

  const { tx, blockhash, lastValidBlockHeight } = await composeVersionedTx({
    connection: args.connection,
    payer: user,
    ixs,
  });

  const sim = await args.connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  if (sim.value.err) {
    const logs = sim.value.logs ?? [];
    throw new Error(
      `Simulation failed: ${JSON.stringify(sim.value.err)}\n${logs.slice(-8).join("\n")}`,
    );
  }

  if (!args.wallet.sendTransaction) {
    throw new Error("Wallet does not support sendTransaction.");
  }

  const signature = await args.wallet.sendTransaction(tx, args.connection, {
    skipPreflight: false,
    maxRetries: 3,
  });
  const confirmation = await args.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(
      `Transaction confirmed but failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }

  return {
    quote,
    receipt: {
      signature,
      simulated: true,
      paper: false,
      side: args.side,
      mint: args.mint,
      solLamports: quote.solLamports,
      tokenAmountRaw: quote.tokenAmountRaw,
      logs: sim.value.logs ?? [],
    },
  };
}
