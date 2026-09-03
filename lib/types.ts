export type TradeSide = "buy" | "sell";
export type Venue = "bonding-curve" | "pump-amm";

export type PumpCoin = {
  mint: string;
  name: string;
  symbol: string;
  description?: string;
  imageUri?: string;
  usdMarketCap?: number | null;
  marketCapSol?: number | null;
  complete?: boolean;
  createdAt?: number | null;
  lastTradeAt?: number | null;
  creator?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
  nsfw?: boolean;
  virtualSolReserves?: number | null;
  virtualTokenReserves?: number | null;
  realSolReserves?: number | null;
  replyCount?: number | null;
  uniqueBuyers?: number | null;
  username?: string | null;
  isCurrentlyLive?: boolean;
  kingOfTheHillAt?: number | null;
  metadataUri?: string | null;
  isBanned?: boolean;
  raw?: Record<string, unknown>;
};

export type QuoteResult = {
  side: TradeSide;
  venue: Venue;
  solLamports: string;
  tokenAmountRaw: string;
  feesLamports: string;
  priceImpactBps: number | null;
  slippagePct: number;
  graduated: boolean;
  progressBps: number | null;
  marketCapLamports: string | null;
  notes: string[];
};

export type CoinOnchain = {
  mint: string;
  graduated: boolean;
  complete: boolean;
  progressBps: number;
  marketCapLamports: string;
  buyPriceLamportsPerToken: string;
  sellPriceLamportsPerToken: string;
  realSolReserves: string;
  realTokenReserves: string;
  tokenTotalSupply: string;
  creator: string | null;
};

export type Position = {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  tokenAmountRaw: string;
  costLamports: string;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  lastSignature?: string;
  paper: boolean;
  updatedAt: number;
};

export type TradeReceipt = {
  signature: string | null;
  simulated: boolean;
  paper: boolean;
  side: TradeSide;
  mint: string;
  solLamports: string;
  tokenAmountRaw: string;
  error?: string;
  logs?: string[];
};

export type AppAlert = {
  id: string;
  mint: string;
  symbol: string;
  kind: "take-profit" | "stop-loss";
  pnlPct: number;
  at: number;
  autoSold: boolean;
  message: string;
};

export type PipelineStage =
  | "filter"
  | "risk"
  | "narrative"
  | "score"
  | "risk_limit"
  | "queued"
  | "approved"
  | "rejected";

export type PipelineScores = {
  risk_score: number;
  risk_inverse: number;
  social_signal: number;
  narrative_fit: number;
  curve_health: number;
  wallet_diversity: number;
  timing: number;
  momentum: number;
  total: number;
};

export type PipelineLogEntry = {
  mint: string;
  name: string;
  symbol: string;
  stage: PipelineStage;
  reason: string;
  scores: PipelineScores | null;
  timestamp: number;
};

export type PipelineCandidate = {
  mint: string;
  name: string;
  symbol: string;
  imageUri?: string;
  ageMinutes: number;
  uniqueBuyers: number;
  uniqueBuyersEstimated: boolean;
  bondingCurvePct: number;
  riskScore: number;
  narrativeNote: string;
  totalScore: number;
  scores: PipelineScores;
  reasonsNotToBuy: string[];
  sizeSol: number;
  queuedAt: number;
  coin: PumpCoin;
};
