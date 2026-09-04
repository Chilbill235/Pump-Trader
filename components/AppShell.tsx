"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { appendBotLog } from "@/lib/bot-log";
import { useSettings } from "./SettingsProvider";
import { useAccounts } from "./AccountsProvider";
import { StartBotModal } from "./StartBotModal";
import { isPublicRpc } from "@/lib/settings";
import { PUBLIC_RPC_WARNING } from "@/lib/constants";
import { BOT_SESSION_KEY } from "@/lib/constants";
import { safeReadScoped, removeScoped } from "@/lib/accounts";
import { SUPPORTED_MOBILE_WALLETS, deepLinkOpen, openUniversal } from "@/lib/mobile";
import { useWalletData } from "./WalletDataProvider";
import { NotificationBell, ToastBanner } from "./NotificationCenter";
import { notify } from "./NotificationProvider";
import { useInstallPrompt } from "./useInstallPrompt";
import { loadAccountProfile, saveAccountProfile } from "@/lib/profile";

const NAV = [
  { href: "/", label: "Markets" },
  { href: "/watch", label: "Watch" },
  { href: "/wallet", label: "Wallet" },
  { href: "/positions", label: "Positions" },
  { href: "/bot", label: "Bot" },
];

const BOTTOM_NAV = [
  { href: "/", label: "Markets", icon: "📈" },
  { href: "/watch", label: "Watch", icon: "👀" },
  { href: "/wallet", label: "Wallet", icon: "💳" },
  { href: "/positions", label: "Pos", icon: "💼" },
  { href: "/bot", label: "Bot", icon: "🤖" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { settings, update } = useSettings();
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const { activeAccount, lock, accounts, switchTo, remove } = useAccounts();
  const walletData = useWalletData();
  const { sol, holdings, live, endpoint } = walletData;
  const [mounted, setMounted] = useState(false);
  const [botModalOpen, setBotModalOpen] = useState(false);
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
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

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
    notify({
      level: "warn",
      category: "bot",
      title: "Bot stopped",
      body: "Auto-trade is off. Run the bot again whenever you're ready.",
      key: "bot:stopped",
    });
  }

  // Listen for in-app action events (from notification buttons).
  useEffect(() => {
    const onAction = (e: Event) => {
      const detail = (e as CustomEvent<{ type: string }>).detail;
      if (detail?.type === "stop-bot" && botRunning) stopBot();
    };
    window.addEventListener("pump-trader:action", onAction as EventListener);
    return () => window.removeEventListener("pump-trader:action", onAction as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botRunning]);

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
      <header className="sticky top-0 z-30 border-b border-line bg-ink-900/95 backdrop-blur safe-top">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          <button
            type="button"
            className="touch-target press shrink-0 rounded border border-line px-2 py-1 text-base sm:hidden"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={navOpen}
          >
            {navOpen ? "✕" : "☰"}
          </button>
          <Link href="/" className="shrink-0 font-mono text-sm tracking-widest text-neon press">
            PUMP TRADER
          </Link>
          <nav
            className={`${navOpen ? "flex" : "hidden"} w-full flex-col gap-1 rounded border border-line/40 bg-ink-800/80 p-2 text-sm shadow-xl sm:!flex sm:w-auto sm:flex-row sm:items-center sm:gap-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`}
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
                  className={`touch-target press rounded px-3 py-2 sm:py-1.5 ${
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
                  className="touch-target press shrink-0 rounded border border-danger/60 bg-danger/10 px-2.5 py-1 font-mono text-[11px] text-danger hover:bg-danger/20"
                  title={`Started ${new Date(botSession!.startedAt).toLocaleTimeString()}`}
                >
                  STOP BOT
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setBotModalOpen(true)}
                  className="touch-target press shrink-0 rounded border border-neon/60 bg-neon/10 px-2.5 py-1 font-mono text-[11px] text-neon hover:bg-neon/20"
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
              <span className="live-pulse hidden shrink-0 rounded border border-neon/40 bg-neon/10 px-2 py-0.5 font-mono text-[11px] text-neon sm:inline">
                BOT RUNNING
              </span>
            ) : autoTradeActive ? (
              <span className="live-pulse hidden shrink-0 rounded border border-neon/40 bg-neon/10 px-2 py-0.5 font-mono text-[11px] text-neon sm:inline">
                AUTO-TRADE ON
              </span>
            ) : null}
            {publicKey ? (
              <Link
                href="/wallet"
                className="shrink-0 font-mono text-xs text-mute hover:text-neon"
                title={
                  endpoint
                    ? `via ${endpoint}${live ? " · live" : " · polled"}`
                    : "Wallet balance"
                }
              >
                {sol == null
                  ? "SOL …"
                  : `${sol.toFixed(4)} SOL${holdings.length > 0 ? ` · ${holdings.length} SPL` : ""}`}
                {live ? (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-neon live-pulse align-middle" />
                ) : null}
              </Link>
            ) : null}
            <NotificationBell />
            {mounted ? (
              <div className="shrink-0" suppressHydrationWarning>
                <WalletMultiButton />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setShowMobileConnect(true)}
              className="touch-target press shrink-0 rounded border border-line bg-ink-800 px-2 py-1 font-mono text-[11px] text-mute hover:border-neon hover:text-neon sm:hidden"
              title="Open in a wallet app"
            >
              Wallet ↗
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
      <main className="mx-auto max-w-[1400px] px-3 pb-24 pt-4 sm:px-4 sm:pb-6">{children}</main>

      <BottomTabBar />

      <ToastBanner />

      <StartBotModal open={botModalOpen} onClose={() => setBotModalOpen(false)} />

      {showMobileConnect ? (
        <MobileConnectSheet onClose={() => setShowMobileConnect(false)} />
      ) : null}
    </div>
  );
}

function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-ink-900/95 px-1 pt-1 backdrop-blur safe-bottom sm:hidden"
      aria-label="Primary"
    >
      {BOTTOM_NAV.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/" || pathname.startsWith("/coin/")
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`press touch-target flex flex-1 flex-col items-center justify-center rounded text-[10px] uppercase ${
              active ? "text-neon" : "text-mute"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span className="mt-0.5">{item.label}</span>
          </Link>
        );
      })}
    </nav>
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
  const install = useInstallPrompt();
  const profile = useMemo(
    () => loadAccountProfile(props.activeId),
    [props.activeId],
  );
  const accent = profile?.color ?? "#39ff88";
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!props.open) return;
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    // Use pointerdown so we react before any click handler below us.
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [props]);
  if (!activeAccount) return null;
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          props.onToggle();
        }}
        className="press flex h-8 items-center gap-1 rounded border border-line bg-ink-800 px-2 font-mono text-xs text-mute hover:border-neon hover:text-neon"
        title="Account menu"
        aria-haspopup="menu"
        aria-expanded={props.open}
      >
        <span
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: accent, boxShadow: `0 0 8px ${accent}` }}
        />
        <span className="max-w-[10ch] truncate">{activeAccount.username}</span>
        <span aria-hidden className="text-[10px]">▾</span>
      </button>
      {props.open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-72 rounded border border-line bg-ink-800 p-2 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
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
                    <li
                      key={a.id}
                      className="flex items-center justify-between rounded px-2 py-1 hover:bg-ink-700"
                    >
                      <button
                        type="button"
                        className="press flex-1 truncate rounded px-2 py-1 text-left text-sm hover:bg-ink-700"
                        onClick={() => props.onSwitch(a.id)}
                      >
                        @{a.username}
                      </button>
                      <button
                        type="button"
                        className="press rounded px-2 py-1 font-mono text-[10px] text-mute hover:bg-danger/20 hover:text-danger"
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
            className="press w-full rounded border border-danger/40 bg-danger/5 px-3 py-1.5 text-left font-mono text-xs text-danger hover:bg-danger/10"
          >
            🔒 Lock account
          </button>
          <Link
            href="/settings"
            onClick={props.onClose}
            className="press mt-1 block w-full rounded border border-line bg-ink-900 px-3 py-1.5 text-left font-mono text-xs text-mute hover:border-neon hover:text-neon"
          >
            ⚙ Settings
          </Link>
          {install.canInstall ? (
            <button
              type="button"
              onClick={() => void install.install()}
              className="press mt-1 w-full rounded border border-neon/40 bg-neon/5 px-3 py-1.5 text-left font-mono text-xs text-neon hover:bg-neon/15"
            >
              📲 Install app
            </button>
          ) : null}
          <ProfileEditor activeId={props.activeId} />

          <p className="mt-2 px-1 text-[11px] text-mute">
            Locking signs you out of this device. All data stays here — it is just hidden until you
            enter your PIN again.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ProfileEditor({ activeId }: { activeId: string | null }) {
  const profile = useMemo(() => loadAccountProfile(activeId), [activeId]);
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [color, setColor] = useState(profile?.color ?? "#39ff88");
  useEffect(() => {
    setBio(profile?.bio ?? "");
    setColor(profile?.color ?? "#39ff88");
  }, [profile?.bio, profile?.color]);
  function save() {
    if (!activeId) return;
    saveAccountProfile(activeId, {
      username: profile?.username ?? "",
      bio: bio.trim() || undefined,
      color,
      updatedAt: Date.now(),
    });
    notify({
      level: "success",
      category: "system",
      title: "Profile saved",
      body: bio.trim() ? `Bio updated.` : `Color updated.`,
    });
  }
  return (
    <div className="mt-2 space-y-2 rounded border border-line bg-ink-900 p-2">
      <p className="font-mono text-[10px] uppercase text-mute">Customize</p>
      <label className="block">
        <span className="block font-mono text-[10px] uppercase text-mute">Accent</span>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {["#39ff88", "#0ea5e9", "#f59e0b", "#ec4899", "#a855f7", "#ef4444"].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="press h-5 w-5 rounded-full border-2"
              style={{
                backgroundColor: c,
                borderColor: color === c ? "white" : "transparent",
                boxShadow: color === c ? `0 0 6px ${c}` : undefined,
              }}
              aria-label={`Set accent ${c}`}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="ml-1 h-5 w-7 cursor-pointer rounded border border-line bg-transparent"
            title="Pick custom color"
          />
        </div>
      </label>
      <label className="block">
        <span className="block font-mono text-[10px] uppercase text-mute">Bio</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 120))}
          maxLength={120}
          rows={2}
          className="mt-1 w-full rounded border border-line bg-ink-800 px-2 py-1 font-mono text-xs"
          placeholder="Trading style, focus, or notes…"
        />
        <p className="mt-0.5 text-[10px] text-mute">{bio.length}/120</p>
      </label>
      <button
        type="button"
        onClick={save}
        className="press w-full rounded border border-neon/40 bg-neon/10 px-2 py-1 font-mono text-[11px] text-neon hover:bg-neon/20"
      >
        Save
      </button>
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