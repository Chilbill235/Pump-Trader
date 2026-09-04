"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useEffect, useRef, useState } from "react";
import { appendBotLog } from "@/lib/bot-log";
import { useSettings } from "./SettingsProvider";
import { useAccounts } from "./AccountsProvider";
import { StartBotModal } from "./StartBotModal";
import { isPublicRpc } from "@/lib/settings";
import { PUBLIC_RPC_WARNING } from "@/lib/constants";
import { BOT_SESSION_KEY } from "@/lib/constants";
import { safeReadScoped, removeScoped } from "@/lib/accounts";
import { SUPPORTED_MOBILE_WALLETS, deepLinkOpen, openUniversal } from "@/lib/mobile";
import { useWalletHoldings } from "./useWalletHoldings";

const NAV = [
  { href: "/", label: "Markets" },
  { href: "/watch", label: "Watch" },
  { href: "/positions", label: "Positions" },
  { href: "/bot", label: "Bot" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { settings, update } = useSettings();
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const { activeAccount, lock, accounts, switchTo, remove } = useAccounts();
  const [sol, setSol] = useState<number | null>(null);
  const [solErr, setSolErr] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [botModalOpen, setBotModalOpen] = useState(false);
  const { holdings } = useWalletHoldings();
  type BotSessionInfo = {
    startedAt: number;
    durationHours: number;
    simulate: boolean;
  };

  const [botSession, setBotSession] = useState<BotSessionInfo | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [acctMenuOpen, setAcctMenuOpen] = useState(false);
  const [showMobileConnect, setShowMobileConnect] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!activeAccount) {
      setBotSession(null);
      return;
    }
    try {
      const raw = safeReadScoped<BotSessionInfo | null>(activeAccount.id, BOT_SESSION_KEY, null);
      if (raw) setBotSession(raw);
      else setBotSession(null);
    } catch {
      setBotSession(null);
    }
    const onStorage = () => {
      try {
        const raw = safeReadScoped<BotSessionInfo | null>(activeAccount.id, BOT_SESSION_KEY, null);
        setBotSession(raw);
      } catch {
        setBotSession(null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [activeAccount]);

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
    appendBotLog(
      activeAccount?.id ?? null,
      {
        kind: "stop",
        message: botSession
          ? `stopped after ${Math.round((Date.now() - botSession.startedAt) / 60000)}m`
          : "stopped",
      },
    );
    update({ autoTrade: false, autoSell: false, pipelineEnabled: false });
    if (activeAccount) removeScoped(activeAccount.id, BOT_SESSION_KEY);
    setBotSession(null);
  }

  // Safety: if the wallet disconnects while auto-trade is on, immediately
  // disable auto-trade / auto-sell. Without a connected wallet, the bot
  // cannot sign transactions — leaving auto-trade on would just burn RPC
  // and confuse the user.
  useEffect(() => {
    if (!connected && (settings.autoTrade || settings.autoSell || botSession)) {
      update({ autoTrade: false, autoSell: false });
      if (activeAccount) removeScoped(activeAccount.id, BOT_SESSION_KEY);
      setBotSession(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  return (
    <div className="min-h-screen bg-ink-950 text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-line bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          <button
            type="button"
            className="shrink-0 rounded border border-line px-2 py-1 text-sm sm:hidden"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {navOpen ? "✕" : "☰"}
          </button>
          <Link href="/" className="shrink-0 font-mono text-sm tracking-widest text-neon">
            PUMP TRADER
          </Link>
          <nav
            className={`${navOpen ? "flex" : "hidden"} w-full flex-col gap-1 text-sm sm:!flex sm:w-auto sm:flex-row sm:items-center`}
          >
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/" || pathname.startsWith("/coin/")
                  : pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setNavOpen(false)}
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
          <div className="ml-auto flex shrink-0 items-center gap-2 overflow-x-auto scroll-thin">
            {connected ? (
              botRunning ? (
                <button
                  type="button"
                  onClick={stopBot}
                  className="shrink-0 rounded border border-danger/60 bg-danger/10 px-2 py-1 font-mono text-[11px] text-danger hover:bg-danger/20"
                  title={`Started ${new Date(botSession!.startedAt).toLocaleTimeString()}`}
                >
                  STOP BOT
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setBotModalOpen(true)}
                  className="shrink-0 rounded border border-neon/60 bg-neon/10 px-2 py-1 font-mono text-[11px] text-neon hover:bg-neon/20"
                >
                  START BOT
                </button>
              )
            ) : null}
            <span
              className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[11px] ${
                settings.simulateMode
                  ? "border-warn/40 bg-warn/10 text-warn"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}
            >
              {settings.simulateMode ? "SIMULATE" : "LIVE MAINNET"}
            </span>
            {botRunning ? (
              <span className="hidden shrink-0 rounded border border-neon/40 bg-neon/10 px-2 py-0.5 font-mono text-[11px] text-neon animate-pulse sm:inline">
                BOT RUNNING
              </span>
            ) : autoTradeActive ? (
              <span className="hidden shrink-0 rounded border border-neon/40 bg-neon/10 px-2 py-0.5 font-mono text-[11px] text-neon animate-pulse sm:inline">
                AUTO-TRADE ON
              </span>
            ) : null}
            {publicKey ? (
              <span
                className="shrink-0 font-mono text-xs text-mute"
                title={
                  holdings.length > 0
                    ? `${holdings.length} SPL token${holdings.length === 1 ? "" : "s"} in this wallet`
                    : "Wallet SPL tokens will load once connected"
                }
              >
                {solErr
                  ? "RPC err"
                  : sol == null
                    ? "SOL …"
                    : `${sol.toFixed(4)} SOL${holdings.length > 0 ? ` · ${holdings.length} SPL` : ""}`}
              </span>
            ) : null}
            {mounted ? (
              <div className="shrink-0" suppressHydrationWarning>
                <WalletMultiButton />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setShowMobileConnect(true)}
              className="shrink-0 rounded border border-line bg-ink-800 px-2 py-1 font-mono text-[11px] text-mute hover:border-neon hover:text-neon sm:hidden"
              title="Open in a wallet app"
            >
              Open in wallet ↗
            </button>
            <AccountMenu
              open={acctMenuOpen}
              onToggle={() => setAcctMenuOpen((v) => !v)}
              onClose={() => setAcctMenuOpen(false)}
              onLock={() => {
                lock();
                setAcctMenuOpen(false);
              }}
              onSwitch={(id) => {
                switchTo(id);
                setAcctMenuOpen(false);
              }}
              onRemove={(id) => {
                if (confirm("Delete this account and all its data? This cannot be undone.")) {
                  remove(id);
                  setAcctMenuOpen(false);
                }
              }}
              accounts={accounts}
              activeId={activeAccount?.id ?? null}
            />
          </div>
        </div>
        {isPublicRpc(settings.rpcUrl) ? (
          <div className="border-t border-warn/20 bg-warn/5 px-3 py-1 text-center font-mono text-[11px] text-warn sm:px-4">
            {PUBLIC_RPC_WARNING}
          </div>
        ) : null}
      </header>
      {botRunning && !walletOk ? (
        <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-center font-mono text-xs text-danger">
          BOT IS RUNNING BUT WALLET IS NOT CONNECTED. Connect Phantom to enable autonomous trading.
        </div>
      ) : null}
      <main className="mx-auto max-w-[1400px] px-3 py-4 sm:px-4">{children}</main>

      <StartBotModal open={botModalOpen} onClose={() => setBotModalOpen(false)} />

      {showMobileConnect ? (
        <MobileConnectSheet onClose={() => setShowMobileConnect(false)} />
      ) : null}
    </div>
  );
}

function AccountMenu(props: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onLock: () => void;
  onSwitch: (id: string) => void;
  onRemove: (id: string) => void;
  accounts: Array<{ id: string; username: string }>;
  activeId: string | null;
}) {
  const { activeAccount } = useAccounts();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!props.open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [props]);
  if (!activeAccount) return null;
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={props.onToggle}
        className="flex items-center gap-1 rounded border border-line bg-ink-800 px-2 py-1 font-mono text-xs text-mute hover:border-neon hover:text-neon"
        title="Account"
      >
        <span className="hidden sm:inline">@</span>
        <span className="max-w-[10ch] truncate">{activeAccount.username}</span>
        <span className="text-[10px]">▾</span>
      </button>
      {props.open ? (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded border border-line bg-ink-800 p-2 shadow-2xl">
          <p className="px-2 pb-1 font-mono text-[10px] uppercase text-mute">Active account</p>
          <p className="px-2 pb-2 text-sm">
            <span className="font-mono text-neon">@{activeAccount.username}</span>
            <span className="block font-mono text-[11px] text-mute">
              {new Date(activeAccount.createdAt).toLocaleDateString()}
            </span>
          </p>
          {props.accounts.length > 1 ? (
            <>
              <p className="px-2 pb-1 font-mono text-[10px] uppercase text-mute">Switch</p>
              <ul className="space-y-1 pb-2">
                {props.accounts
                  .filter((a) => a.id !== props.activeId)
                  .map((a) => (
                    <li key={a.id} className="flex items-center justify-between rounded px-2 py-1 hover:bg-ink-700">
                      <button
                        type="button"
                        className="flex-1 truncate text-left text-sm"
                        onClick={() => props.onSwitch(a.id)}
                      >
                        @{a.username}
                      </button>
                      <button
                        type="button"
                        className="font-mono text-[10px] text-mute hover:text-danger"
                        onClick={() => props.onRemove(a.id)}
                        title="Delete account"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          ) : null}
          <button
            type="button"
            onClick={props.onLock}
            className="w-full rounded border border-danger/40 bg-danger/5 px-3 py-1.5 text-left font-mono text-xs text-danger hover:bg-danger/10"
          >
            🔒 Lock account
          </button>
          <p className="mt-2 px-1 text-[11px] text-mute">
            Locking signs you out of this device. All data stays here — it is just hidden until you
            enter your PIN again.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function MobileConnectSheet(props: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [props]);
  const url = typeof window !== "undefined" ? window.location.href : "";
  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-t-2xl border border-line bg-ink-900 shadow-2xl sm:rounded-2xl"
        style={{
          maxHeight:
            "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b border-line/60 px-4 py-3"
          style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
        >
          <h2 className="font-mono text-sm text-neon">Connect on mobile</h2>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded border border-line px-2 py-1 font-mono text-xs text-mute"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto p-4 scroll-thin"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <p className="text-xs text-mute">
            Pick a wallet. The page will open inside the wallet&apos;s browser with the
            connection already prepared.
          </p>
          <div className="mt-3 space-y-2">
            {SUPPORTED_MOBILE_WALLETS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => openUniversal(deepLinkOpen(w))}
                className="flex w-full items-center justify-between rounded border border-line bg-ink-800 px-4 py-3 text-left text-base active:border-neon"
              >
                <span className="font-mono">Open in {w}</span>
                <span className="font-mono text-sm text-mute">↗</span>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded border border-line bg-ink-800 p-3">
            <p className="font-mono text-[11px] uppercase text-mute">URL</p>
            <p className="mt-1 break-all font-mono text-xs">{url}</p>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  // ignore
                }
              }}
              className="mt-2 rounded border border-line px-3 py-1.5 font-mono text-xs text-mute"
            >
              {copied ? "Copied" : "Copy URL"}
            </button>
          </div>
        </div>
        <div
          className="shrink-0 border-t border-line/60 px-4 py-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={props.onClose}
            className="w-full rounded border border-line py-2.5 font-mono text-sm text-mute"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}