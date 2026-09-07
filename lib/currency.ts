"use client";

import { useMemo } from "react";

export type Currency = "SOL" | "USD" | "USDC";

export function useCurrency(currency: Currency = "SOL") {
  return useMemo(
    () => ({
      currency,
      formatSol: (lamports: string | number | bigint, decimals = 4): string => {
        const sol = Number(lamports) / 1e9;
        if (!Number.isFinite(sol)) return "0";
        if (currency === "SOL") return `${sol.toFixed(decimals)} SOL`;
        if (currency === "USD" || currency === "USDC") return `$${sol.toFixed(decimals)}`;
        return `${sol.toFixed(decimals)} SOL`;
      },
      formatUsd: (usd: number | null, decimals = 2): string => {
        if (usd == null || !Number.isFinite(usd)) return "—";
        if (currency === "SOL") return `≈ ${(usd / 101).toFixed(4)} SOL`;
        if (currency === "USD" || currency === "USDC") return `$${usd.toFixed(decimals)}`;
        return `$${usd.toFixed(decimals)}`;
      },
      formatToken: (amount: string | number, decimals: number): string => {
        const ui = Number(amount) / Math.pow(10, decimals);
        if (!Number.isFinite(ui)) return "0";
        if (currency === "SOL") return `${ui.toFixed(decimals > 6 ? 4 : 2)}`;
        if (currency === "USD" || currency === "USDC") return `$${ui.toFixed(decimals > 6 ? 4 : 2)}`;
        return `${ui.toFixed(decimals > 6 ? 4 : 2)}`;
      },
      convertSolToCurrency: (lamports: string | number | bigint): number => {
        const sol = Number(lamports) / 1e9;
        if (!Number.isFinite(sol)) return 0;
        if (currency === "SOL") return sol;
        const price = 101;
        return sol * price;
      },
      symbol: currency === "SOL" ? "SOL" : currency === "USD" ? "USD" : "USDC",
    }),
    [currency],
  );
}

export function formatSol(lamports: string | number | bigint, currency: Currency = "SOL", decimals = 4): string {
  const sol = Number(lamports) / 1e9;
  if (!Number.isFinite(sol)) return "0";
  if (currency === "SOL") return `${sol.toFixed(decimals)} SOL`;
  if (currency === "USD" || currency === "USDC") return `$${sol.toFixed(decimals)}`;
  return `${sol.toFixed(decimals)} SOL`;
}

export function formatUsd(usd: number | null, currency: Currency = "SOL", decimals = 2): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (currency === "SOL") return `≈ ${(usd / 101).toFixed(4)} SOL`;
  if (currency === "USD" || currency === "USDC") return `$${usd.toFixed(decimals)}`;
  return `$${usd.toFixed(decimals)}`;
}

export function formatToken(amount: string | number, decimals: number, currency: Currency = "SOL"): string {
  const ui = Number(amount) / Math.pow(10, decimals);
  if (!Number.isFinite(ui)) return "0";
  if (currency === "SOL") return `${ui.toFixed(decimals > 6 ? 4 : 2)}`;
  if (currency === "USD" || currency === "USDC") return `$${ui.toFixed(decimals > 6 ? 4 : 2)}`;
  return `${ui.toFixed(decimals > 6 ? 4 : 2)}`;
}

