import type { AppSettings } from "./settings";

/**
 * Auto-tune: derive sane trading/bot settings from the user's actual balance.
 *
 * Rationale: most users don't know what "max_position_sol" should be. These
 * formulas scale risk to what they actually hold, so a 0.5 SOL wallet and a
 * 20 SOL wallet both get proportionally sane defaults instead of the static
 * 0.1 SOL default (which is 20% risk for the small wallet and 0.5% for the
 * big one).
 */

export type TuneProfile = "safe" | "balanced" | "degen";

export type TuneResult = {
  patch: Partial<AppSettings>;
  rationale: string[];
};

const PROFILE_RISK: Record<TuneProfile, { perPosition: number; totalExposure: number }> = {
  safe: { perPosition: 0.03, totalExposure: 0.5 },
  balanced: { perPosition: 0.07, totalExposure: 0.8 },
  degen: { perPosition: 0.15, totalExposure: 1.2 },
};

const PROFILE_TP_SL: Record<TuneProfile, { tp: number; sl: number }> = {
  // Asymmetric: memecoins pump harder than they dump slowly — TP above SL.
  safe: { tp: 25, sl: 10 },
  balanced: { tp: 35, sl: 15 },
  degen: { tp: 50, sl: 20 },
};

export function autoTuneSettings(
  balanceSol: number,
  profile: TuneProfile,
): TuneResult {
  const rationale: string[] = [];
  if (!Number.isFinite(balanceSol) || balanceSol <= 0) {
    return {
      patch: {},
      rationale: ["Wallet balance unavailable — connect a wallet or fund it, then retry."],
    };
  }

  const risk = PROFILE_RISK[profile];
  const tpsl = PROFILE_TP_SL[profile];

  // Per-position size: percentage of balance, clamped to practical trade sizes.
  const maxPositionSol = Math.min(0.5, Math.max(0.01, balanceSol * risk.perPosition));
  rationale.push(
    `Per-position cap: ${maxPositionSol.toFixed(3)} SOL (${Math.round(risk.perPosition * 100)}% of your ${balanceSol.toFixed(3)} SOL)`,
  );

  // How many positions fit inside the total exposure budget.
  const maxOpenPositions = Math.max(
    1,
    Math.min(10, Math.floor((balanceSol * risk.totalExposure) / maxPositionSol)),
  );
  rationale.push(
    `Max open positions: ${maxOpenPositions} (total exposure ≤ ${Math.round(risk.totalExposure * 100)}% of balance)`,
  );

  // Daily loss limit: a fraction of balance you can afford to lose in a day.
  const lossFraction = profile === "safe" ? 0.1 : profile === "balanced" ? 0.2 : 0.3;
  const dailyLossLimit = Math.max(0.02, balanceSol * lossFraction);
  rationale.push(
    `Daily loss limit: ${dailyLossLimit.toFixed(3)} SOL (${Math.round(lossFraction * 100)}% of balance)`,
  );

  // Slippage: pump.fun moves fast; tighter is cheaper but risks failed txs.
  const slippagePct = profile === "safe" ? 3 : profile === "balanced" ? 5 : 8;
  rationale.push(`Slippage: ${slippagePct}%`);

  rationale.push(
    `Take profit ${tpsl.tp}% / Stop loss ${tpsl.sl}% (asymmetric — memecoins spike harder than they bleed)`,
  );

  const minScore = profile === "safe" ? 0.65 : profile === "balanced" ? 0.55 : 0.45;
  rationale.push(`Pipeline min score: ${minScore.toFixed(2)} (${profile === "safe" ? "only high-conviction" : profile === "degen" ? "loose" : "moderate"} filter)`);

  return {
    patch: {
      maxPositionSol: Number(maxPositionSol.toFixed(4)),
      maxOpenPositions,
      dailyLossLimit: Number(dailyLossLimit.toFixed(4)),
      slippagePct,
      takeProfitPct: tpsl.tp,
      stopLossPct: tpsl.sl,
      minScore,
    },
    rationale,
  };
}

/** Short human label for what a profile is for. */
export function profileLabel(p: TuneProfile): { title: string; desc: string } {
  switch (p) {
    case "safe":
      return { title: "Safe", desc: "Small bets, tight stops, high bar for entries" };
    case "balanced":
      return { title: "Balanced", desc: "Moderate risk, recommended for most users" };
    case "degen":
      return { title: "Degen", desc: "Full sends, wide limits, low bar for entries" };
  }
}
