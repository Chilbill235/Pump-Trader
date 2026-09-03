export const DEFAULT_RPC =
  "https://api.mainnet-beta.solana.com";

export const PUMP_API_BASE =
  process.env.NEXT_PUBLIC_PUMP_API_BASE?.trim() ||
  "https://frontend-api-v3.pump.fun";

export const PUMP_API_FALLBACKS = [
  "https://frontend-api-v3.pump.fun",
  "https://frontend-api.pump.fun",
  "https://advanced-api-v2.pump.fun",
] as const;

export const TOKEN_DECIMALS = 6;
export const SOL_DECIMALS = 9;
export const DEFAULT_SLIPPAGE_PCT = 5;
export const PUBLIC_RPC_WARNING =
  "Public mainnet RPC is rate-limited. Set NEXT_PUBLIC_SOLANA_RPC_URL or a custom RPC in Settings.";

export const SOLSCAN_TX = "https://solscan.io/tx/";
export const SOLSCAN_TOKEN = "https://solscan.io/token/";
export const PUMP_FUN_COIN = "https://pump.fun/coin/";

export const SETTINGS_KEY = "pump-trader:settings:v1";
export const POSITIONS_KEY = "pump-trader:positions:v1";
export const ALERTS_KEY = "pump-trader:alerts:v1";

export const TPSL_FIRED_KEY = "pump-trader:tpsl-fired:v1";

export const PIPELINE_LOG_KEY = "pump-trader:pipeline-log:v1";
export const PIPELINE_CANDIDATES_KEY = "pump-trader:pipeline-candidates:v1";
export const PIPELINE_DAILY_KEY = "pump-trader:pipeline-daily:v1";

export const DEFAULT_MIN_SCORE = 0.55;
export const DEFAULT_MAX_POSITION_SOL = 0.1;
export const DEFAULT_MAX_OPEN_POSITIONS = 5;
export const DEFAULT_DAILY_LOSS_LIMIT = 0.3;
export const DEFAULT_MIN_UNIQUE_BUYERS = 5;
export const DEFAULT_MAX_BONDING_CURVE_PCT = 40;
export const DEFAULT_MIN_AGE_MINUTES = 2;

/** Pump.fun curve starts ~30 virtual SOL and graduates near 85 real SOL. */
export const PUMP_INITIAL_VIRTUAL_SOL = 30;
export const PUMP_GRADUATION_SOL = 85;

