# Pump Trader

Personal pump.fun buy/sell dashboard for Solana. Honest trading client, not a sniper, sandwich bot, wash trader, or pump-and-dump engine. It does not auto-buy new coins and does not front-run.

Most memecoins go to zero. This is not financial advice. You can lose everything. Start in simulate / paper mode (on by default) with tiny size.

## What it does

- **Local accounts.** Every user creates an account on this device with a username + PIN. All settings, positions, alerts, the bot session, closed trades, the equity curve, and the pipeline log are namespaced per account. One account cannot read or stop another account's bot. Accounts auto-lock after 15 minutes of inactivity.
- **Connect Phantom / Solflare via the Solana wallet adapter.** Signing stays in the browser. The UI never asks for a secret key.
- **Mobile-friendly.** Works in iPhone Safari and Android Chrome. Open it inside Phantom / Solflare / Trust Wallet / Coinbase Wallet's in-app browser for one-tap connect via Mobile Wallet Adapter. From regular mobile Safari, use the "Connect" sheet to deep-link into a wallet.
- Browse/search live pump.fun coins (trending, newest, mint/name/ticker).
- Coin page: price, market cap, bonding-curve vs graduated, graduation percent, buy/sell quotes (tokens, fees, impact).
- Execute buy/sell after an explicit confirm. Live trades are simulated before send. Signatures link to Solscan.
- Positions: wallet SOL, tokens filled through this app, PnL vs entry.
- Optional per-position take-profit and stop-loss percents. A watcher polls and alerts. Auto-sell is OFF unless you enable it in Settings.
- Simulate/paper mode ON by default: quotes and pretend fills, no transactions.
- Watch pipeline: newest-launch scan with heuristic filter/score. Human must approve before any live buy.

## Safety

- **Per-account isolation.** Each account stores under `pump-trader:acct:<id>:*` in localStorage. Switching accounts immediately disables the previous account's auto-trade / auto-sell so one account cannot leave a bot running while the owner looks at another.
- **Wallet-disconnect safety.** If the connected wallet drops while auto-trade is on, the bot auto-stops — there is no wallet to sign transactions with.
- **Idle auto-lock.** 15 minutes of no mouse/keyboard/touch/scroll and the active account re-locks. The vault key never persists.
- **PIN is not stored.** A PBKDF2-derived key encrypts a random vault key. The PIN itself never leaves memory. There is no recovery — losing the PIN means losing that account's data on this device.
- **No server.** All data is browser-local. Clearing site data wipes everything. Exporting a backup is per-account and can only be re-imported into the same account.

## Setup

cd /workspace/pump-trader
npm install
npm run dev

Open http://localhost:3000

## Env
- NEXT_PUBLIC_SOLANA_RPC_URL — Solana RPC. Falls back to public mainnet (rate-limited). Use a dedicated RPC.
- NEXT_PUBLIC_PUMP_API_BASE — optional pump.fun HTTP API.
- No custodial backend. Env files gitignored except .env.example.

## How to use
1. Click Select Wallet (Phantom or Solflare). Approve in the extension. Never paste a secret key.
2. Leave SIMULATE / PAPER on. Quote a coin, confirm a paper fill, inspect Positions.
3. Tiny live trade: turn simulate off, slippage 5 percent, size you can lose, confirm, sign. Simulation runs first.
4. Optional TP/SL on a position alerts. Auto-sell stays off unless enabled.

## Trading path
- OnlinePumpSdk fetches curve/AMM state.
- If bondingCurve.complete is false: quoteBuy + buyInstructions (spread ...buyState). Sell quotes use curve math; live sells spread ...sellState into sellInstructions.
- If graduated: ammQuoteBuy/ammQuoteSell and ammBuyInstructions/ammSellInstructions.
- Amounts are BN. Instructions go into a VersionedTransaction, simulateTransaction, then wallet adapter sign/send.


## Watch pipeline
I (the Grok Watcher) scan launches; this page is the same pipeline locally; live buys need human approval.

Path: MONITOR (newest launch stream, polled ~20s) -> AUDITOR (risk / wallet diversity) -> NARRATIVE (meme potential) -> TIMING (hour + crowding) -> CHECKER (reasons not to buy) -> you approve -> EXECUTOR (lib/trade.ts buy on the curve).

Defaults: unique_buyers >= 5, bonding_curve_pct < 40, has metadata, age > 2 minutes, min_score 0.55, max_position_sol 0.1, daily_loss_limit 0.3 SOL. Simulate/paper is on. No sniping, no sandwich/MEV, no wash trading, no auto-buy of every new coin. Heuristics only -- no Grok API key, no private keys.

Open http://localhost:3000/watch

## Markets HTTP API
Listings proxy frontend-api-v3.pump.fun from Next.js routes. If HTTP fails, paste a mint and trade from on-chain reads on the coin page.

## Risks
- Almost every pump.fun coin goes to zero.
- Quotes can be stale. Slippage can fill worse than quoted.
- Public RPC and pump HTTP fail often.
- Auto-sell can fire on a wick. Keep it off until you understand it.
- You are responsible for every signature. Not financial advice. No guaranteed profit.
- Live 2026-09-02: GET /coins (trending/newest) and GET /coins/{mint} and GET /sol-price return 200. GET /coins/search and /coins/latest return 404; search filters the live lists and mint lookup still works. Paste a mint if HTTP is down — on-chain quotes still work.
"# Pump-Trader" 
