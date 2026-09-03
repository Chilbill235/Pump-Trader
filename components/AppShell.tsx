"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { appendBotLog } from "@/lib/bot-log";
import { useSettings } from "./SettingsProvider";
import { StartBotModal } from "./StartBotModal";
import { isPublicRpc } from "@/lib/settings";
import { PUBLIC_RPC_WARNING } from "@/lib/constants";

const NAV = [
  { href: "/", label: "Markets" },
  { href: "/watch", label: "Watch" },
  { href: "/positions", label: "Positions" },
  { href: "/bot", label: "Bot" },
  { href: "/settings", label: "Settings" },
];

const BOT_SESSION_KEY = "pump-trader:bot-session:v1";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { settings, update } = useSettings();
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [sol, setSol] = useState<number | null>(null);
  const [solErr, setSolErr] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [botModalOpen, setBotModalOpen] = useState(false);
  const [botSession, setBotSession] = useState<null | {
    startedAt: number;
    durationHours: number;
    simulate: boolean;
  }>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BOT_SESSION_KEY);
      if (raw) setBotSession(JSON.parse(raw));
    } catch {
      setBotSession(null);
    }
    const onStorage = () => {
      try {
        const raw = window.localStorage.getItem(BOT_SESSION_KEY);
        setBotSession(raw ? JSON.parse(raw) : null);
      } catch {
        setBotSession(null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const walletOk = publicKey && connected;
  const autoTradeActive = settings.autoTrade && settings.pipelineEnabled;
  const botRunning = autoTradeActive && !!botSession;

  useEffect(() => {
    const key = publicKey;
    if (!key) {
      setSol(null);
      return;
    }
    let cancelled = false;
    let retries = 0;
    const maxRetries = 2;
    async function fetchBalance() {
      try {
        const lamports = await connection.getBalance(key!);
        if (!cancelled) {
          setSol(lamports / LAMPORTS_PER_SOL);
          setSolErr(null);
        }
      } catch (err) {
        retries++;
        const msg = err instanceof Error ? err.message : String(err);
        const isForbidden = msg.includes("403") || msg.toLowerCase().includes("forbidden");
        if (isForbidden && retries <= maxRetries && !cancelled) {
          setTimeout(fetchBalance, 1000 * retries);
          return;
        }
        if (!cancelled) {
          setSolErr(isForbidden ? "Public RPC blocked" : msg);
        }
      }
    }
    void fetchBalance();
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

  function stopBot() {
    appendBotLog({
      kind: "stop",
      message: botSession
        ? `stopped after ${Math.round((Date.now() - botSession.startedAt) / 60000)}m`
        : "stopped",
    });
    update({ autoTrade: false, autoSell: false, pipelineEnabled: false });
    window.localStorage.removeItem(BOT_SESSION_KEY);
    setBotSession(null);
  }

  return (
    <div className="min-h-screen bg-ink-950 text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-line bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-2.5">
          <Link href="/" className="shrink-0 font-mono text-sm tracking-widest text-neon">
            PUMP TRADER
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/" || pathname.startsWith("/coin/")
                  : pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded px-3 py-1.5 ${
                    active
                      ? "bg-ink-700 text-white"
                      : "text-mute hover:bg-ink-700 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {connected ? (
              botRunning ? (
                <button
                  type="button"
                  onClick={stopBot}
                  className="rounded border border-danger/60 bg-danger/10 px-3 py-1 font-mono text-[11px] text-danger hover:bg-danger/20"
                  title={`Started ${new Date(botSession!.startedAt).toLocaleTimeString()}`}
                >
                  STOP BOT
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setBotModalOpen(true)}
                  className="rounded border border-neon/60 bg-neon/10 px-3 py-1 font-mono text-[11px] text-neon hover:bg-neon/20"
                >
                  START BOT
                </button>
              )
            ) : null}
            <span
              className={`rounded border px-2 py-0.5 font-mono text-[11px] ${
                settings.simulateMode
                  ? "border-warn/40 bg-warn/10 text-warn"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}
            >
              {settings.simulateMode ? "SIMULATE / PAPER" : "LIVE MAINNET"}
            </span>
            {botRunning ? (
              <span className="rounded border border-neon/40 bg-neon/10 px-2 py-0.5 font-mono text-[11px] text-neon animate-pulse">
                BOT RUNNING
              </span>
            ) : autoTradeActive ? (
              <span className="rounded border border-neon/40 bg-neon/10 px-2 py-0.5 font-mono text-[11px] text-neon animate-pulse">
                AUTO-TRADE ON
              </span>
            ) : null}
            {publicKey ? (
              <span className="font-mono text-xs text-mute">
                {solErr
                  ? "RPC err"
                  : sol == null
                    ? "SOL …"
                    : `${sol.toFixed(4)} SOL`}
              </span>
            ) : (
              <span className="font-mono text-[11px] text-danger">
                {botRunning ? "CONNECT WALLET" : "No wallet"}
              </span>
            )}
            {mounted ? (
              <div suppressHydrationWarning>
                <WalletMultiButton />
              </div>
            ) : (
              <div className="h-[34px] w-[140px] rounded border border-line bg-ink-700" />
            )}
          </div>
        </div>
        {isPublicRpc(settings.rpcUrl) ? (
          <div className="border-t border-warn/20 bg-warn/5 px-4 py-1 text-center font-mono text-[11px] text-warn">
            {PUBLIC_RPC_WARNING}
          </div>
        ) : null}
      </header>
      {botRunning && !walletOk ? (
        <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-center font-mono text-xs text-danger">
          BOT IS RUNNING BUT WALLET IS NOT CONNECTED. Connect Phantom to enable autonomous trading.
        </div>
      ) : null}
      <main className="mx-auto max-w-[1400px] px-4 py-4">{children}</main>

      <StartBotModal open={botModalOpen} onClose={() => setBotModalOpen(false)} />
    </div>
  );
}