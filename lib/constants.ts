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

/**
 * Per-account storage keys. Each account's data is namespaced under its own
 * prefix by lib/accounts.ts. These constants are the trailing part of the key.
 *
 * NEVER use these raw — go through lib/accounts.ts scoped helpers, or one of
 * the lib/* modules that takes an account id. This is the wall that keeps
 * account A from reading/writing account B's data.
 */
export const SETTINGS_KEY = "settings:v1";
export const POSITIONS_KEY = "positions:v1";
export const ALERTS_KEY = "alerts:v1";

export const TPSL_FIRED_KEY = "tpsl-fired:v1";

export const PIPELINE_LOG_KEY = "pipeline-log:v1";
export const PIPELINE_CANDIDATES_KEY = "pipeline-candidates:v1";
export const PIPELINE_DAILY_KEY = "pipeline-daily:v1";

export const BANKROLL_KEY = "bankroll-config:v1";
export const BOT_LOG_KEY = "bot-log:v1";
export const BOT_SESSION_KEY = "bot-session:v1";
export const BOT_DRAFT_KEY = "bot-draft:v1";
export const CLOSED_TRADES_KEY = "closed-trades:v1";
export const EQUITY_KEY = "equity:v1";
export const PEAK_KEY = "peak-equity:v1";
export const START_BANKROLL_KEY = "start-bankroll:v1";
export const MOMENTUM_KEY = "momentum:v1";

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

