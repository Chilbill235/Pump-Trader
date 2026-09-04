"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { appendBotLog } from "@/lib/bot-log";
import { useSettings } from "./SettingsProvider";
import { useAccounts } from "./AccountsProvider";
import { StartBotModal } from "./StartBotModal";
import { isPublicRpc } from "@/lib/settings";
import { PUBLIC_RPC_WARNING, BOT_SESSION_KEY } from "@/lib/constants";
import { safeReadScoped, removeScoped } from "@/lib/accounts";
import { useWalletData } from "./WalletDataProvider";
import { NotificationBell, ToastBanner } from "./NotificationCenter";
import { notify } from "./NotificationProvider";
import { useInstallPrompt } from "./useInstallPrompt";
import { loadAccountProfile, saveAccountProfile } from "@/lib/profile";
import { ConnectWalletButton } from "./ConnectWalletButton";

type NavItem = { href: string; label: string; short: string; icon: string };

const NAV: NavItem[] = [
  { href: "/", label: "Markets", short: "Markets", icon: "M" },
  { href: "/watch", label: "Watch", short: "Watch", icon: "W" },
  { href: "/wallet", label: "Wallet", short: "Wallet", icon: "₿" },
  { href: "/positions", label: "Positions", short: "Pos", icon: "P" },
  { href: "/bot", label: "Bot", short: "Bot", icon: "B" },
];

type BotSessionInfo = {
  startedAt: number;
  durationHours: number;
  simulate: boolean;
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { settings, update } = useSettings();
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const { activeAccount, lock, accounts, switchTo, remove } = useAccounts();
  const walletData = useWalletData();
  const { sol, holdings, live, endpoint } = walletData;
  const [botModalOpen, setBotModalOpen] = useState(false);
  const [botSession, setBotSession] = useState<BotSessionInfo | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [acctMenuOpen, setAcctMenuOpen] = useState(false);

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
    const read = () => {
      try {
        const raw = safeReadScoped<BotSessionInfo | null>(activeAccount.id, BOT_SESSION_KEY, null);
        setBotSession(raw);
      } catch {
        setBotSession(null);
      }
    };
    read();
    const onStorage = () => read();
    window.addEventListener("storage", onStorage);
    const t = window.setInterval(read, 3000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(t);
    };
  }, [activeAccount]);

  const walletOk = publicKey && connected;
  const autoTradeActive = settings.autoTrade && settings.pipelineEnabled;
  const botRunning = autoTradeActive && !!botSession;

  function stopBot() {
    appendBotLog(activeAccount?.id ?? null, {
      kind: "stop",
      message: botSession
        ? `stopped after ${Math.round((Date.now() - botSession.startedAt) / 60000)}m`
        : "stopped",
    });
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

  useEffect(() => {
    const onAction = (e: Event) => {
      const detail = (e as CustomEvent<{ type: string }>).detail;
      if (detail?.type === "stop-bot" && botRunning) stopBot();
    };
    window.addEventListener("pump-trader:action", onAction as EventListener);
    return () => window.removeEventListener("pump-trader:action", onAction as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botRunning]);

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
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          <button
            type="button"
            className="press shrink-0 rounded border border-line bg-ink-800 px-2.5 py-1.5 text-base text-mute hover:border-neon hover:text-neon sm:hidden"
            onClick={() => setNavOpen((v) => !v)}
            aria-label={navOpen ? "Close menu" : "Open menu"}
            aria-expanded={navOpen}
          >
            <span aria-hidden>{navOpen ? "✕" : "☰"}</span>
          </button>
          <Link href="/" className="shrink-0 font-mono text-base font-semibold tracking-widest text-neon press">
            PUMP TRADER
          </Link>
          <nav
            aria-label="Primary"
            className={`${navOpen ? "flex" : "hidden"} absolute left-3 right-3 top-[calc(100%+2px)] z-40 flex-col gap-1 rounded-lg border border-line bg-ink-900/95 p-2 shadow-2xl backdrop-blur sm:!static sm:!flex sm:w-auto sm:flex-row sm:items-center sm:gap-1 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`}
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
                  className={`press flex items-center gap-2 rounded-md px-3 py-2 text-sm sm:py-1.5 ${
                    active
                      ? "bg-neon/15 text-neon"
                      : "text-mute hover:bg-ink-800 hover:text-white"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <span aria-hidden className="hidden h-5 w-5 items-center justify-center rounded border border-current text-[10px] font-bold sm:flex">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <StatusPill
              simulate={settings.simulateMode}
              botRunning={botRunning}
              autoTrade={autoTradeActive}
            />
            {publicKey ? (
              <Link
                href="/wallet"
                className="hidden shrink-0 items-center gap-1 rounded-md border border-line bg-ink-800 px-2.5 py-1.5 font-mono text-xs text-mute hover:border-neon hover:text-neon sm:inline-flex"
                title={
                  endpoint
                    ? `via ${endpoint}${live ? " · live" : " · polled"}`
                    : "Wallet balance"
                }
              >
                <span aria-hidden className="text-neon">◎</span>
                <span>
                  {sol == null ? "…" : `${sol.toFixed(4)}`}
                  <span className="text-mute">{holdings.length > 0 ? ` · ${holdings.length}` : ""}</span>
                </span>
                {live ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-neon live-pulse" aria-label="live" />
                ) : null}
              </Link>
            ) : null}
            <NotificationBell />
            <ConnectWalletButton />
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

      {botRunning ? (
        <div className="border-b border-neon/30 bg-gradient-to-r from-neon/10 via-neon/5 to-neon/10">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-3 py-2 sm:px-4">
            <div className="flex items-center gap-2 text-xs">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-neon" />
              </span>
              <span className="font-mono text-neon">
                BOT RUNNING · {settings.simulateMode ? "SIMULATE" : "LIVE"}
                {botSession ? ` · ${humanizeAge(Date.now() - botSession.startedAt)}` : ""}
              </span>
              {!walletOk ? (
                <span className="font-mono text-warn">· wallet disconnected</span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={stopBot}
              className="press rounded border border-danger/60 bg-danger/10 px-3 py-1 font-mono text-[11px] font-semibold text-danger hover:bg-danger/20"
            >
              STOP
            </button>
          </div>
        </div>
      ) : null}

      {connected && !botRunning && !autoTradeActive && pathname !== "/bot" && pathname !== "/" ? (
        <StartBotBanner onStart={() => setBotModalOpen(true)} walletOk={!!walletOk} />
      ) : null}

      <main className="mx-auto max-w-[1400px] px-3 pb-24 pt-4 sm:px-4 sm:pb-6">{children}</main>

      <BottomTabBar />

      <ToastBanner />

      <StartBotModal open={botModalOpen} onClose={() => setBotModalOpen(false)} />
    </div>
  );
}

function StatusPill(props: { simulate: boolean; botRunning: boolean; autoTrade: boolean }) {
  if (props.botRunning) {
    return (
      <span className="hidden items-center gap-1.5 rounded-md border border-neon/40 bg-neon/10 px-2 py-1 font-mono text-[11px] font-semibold text-neon sm:inline-flex">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-neon" />
        </span>
        BOT
      </span>
    );
  }
  if (props.autoTrade) {
    return (
      <span className="hidden items-center gap-1.5 rounded-md border border-warn/40 bg-warn/10 px-2 py-1 font-mono text-[11px] font-semibold text-warn sm:inline-flex">
        AUTO
      </span>
    );
  }
  return (
    <span
      className={`hidden items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] sm:inline-flex ${
        props.simulate
          ? "border-warn/40 bg-warn/10 text-warn"
          : "border-danger/40 bg-danger/10 text-danger"
      }`}
    >
      {props.simulate ? "SIM" : "LIVE"}
    </span>
  );
}

function StartBotBanner({ onStart, walletOk }: { onStart: () => void; walletOk: boolean }) {
  return (
    <div className="border-b border-line/60 bg-ink-900/60">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-widest text-mute">Autonomous trading</p>
          <p className="mt-0.5 text-sm">
            Turn on the watch pipeline and let it score new launches while you&apos;re away.{" "}
            <span className="text-mute">Simulate mode is on by default.</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="press inline-flex shrink-0 items-center gap-2 rounded-md border border-neon bg-neon px-4 py-2 font-mono text-sm font-semibold text-ink-950 shadow-[0_0_18px_rgba(57,255,136,0.45)] transition-all hover:shadow-[0_0_24px_rgba(57,255,136,0.7)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="currentColor">
            <path d="M3 1.5v11l9-5.5z" />
          </svg>
          Start Bot
        </button>
        {!walletOk ? (
          <p className="basis-full text-right text-[11px] text-warn">Connect a wallet first to sign live trades.</p>
        ) : null}
      </div>
    </div>
  );
}

function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-ink-900/95 backdrop-blur safe-bottom sm:hidden"
      aria-label="Mobile"
    >
      {NAV.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/" || pathname.startsWith("/coin/")
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`press flex flex-1 flex-col items-center justify-center py-1.5 text-[10px] uppercase tracking-wide ${
              active ? "text-neon" : "text-mute"
            }`}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
          >
            <span aria-hidden className="text-base font-bold leading-none">{item.icon}</span>
            <span className="mt-0.5">{item.short}</span>
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
  const profile = useMemo(() => loadAccountProfile(props.activeId), [props.activeId]);
  const accent = profile?.color ?? "#39ff88";
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current && wrapRef.current.contains(t)) return;
      if (buttonRef.current && buttonRef.current.contains(t)) return;
      props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [props.open, props]);

  if (!activeAccount) return null;
  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          props.onToggle();
        }}
        className="press flex h-9 items-center gap-2 rounded-md border border-line bg-ink-800 px-2.5 font-mono text-xs text-mute hover:border-neon hover:text-neon focus:outline-none focus-visible:ring-2 focus-visible:ring-neon"
        title="Account menu"
        aria-haspopup="menu"
        aria-expanded={props.open}
      >
        <span
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: accent, boxShadow: `0 0 8px ${accent}` }}
        />
        <span className="max-w-[12ch] truncate">@{activeAccount.username}</span>
        <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 4l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {props.open ? (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-line bg-ink-900 p-3 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center gap-2">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold text-ink-950"
              style={{ backgroundColor: accent }}
            >
              {activeAccount.username.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm font-semibold">@{activeAccount.username}</p>
              <p className="truncate font-mono text-[11px] text-mute">
                Joined {new Date(activeAccount.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {props.accounts.length > 1 ? (
            <div className="mb-2 rounded-md border border-line/60 bg-ink-950/40 p-2">
              <p className="px-1 pb-1 font-mono text-[10px] uppercase text-mute">Switch account</p>
              <ul className="space-y-0.5">
                {props.accounts
                  .filter((a) => a.id !== props.activeId)
                  .map((a) => (
                    <li key={a.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        role="menuitem"
                        className="press flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-ink-800"
                        onClick={() => props.onSwitch(a.id)}
                      >
                        <span
                          aria-hidden
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-700 font-mono text-[11px] font-bold text-mute"
                        >
                          {a.username.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="truncate">@{a.username}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete @${a.username}`}
                        className="press shrink-0 rounded p-1.5 text-mute hover:bg-danger/20 hover:text-danger"
                        onClick={() => props.onRemove(a.id)}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
                        </svg>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-1">
            <Link
              href="/settings"
              onClick={props.onClose}
              role="menuitem"
              className="press flex items-center gap-2 rounded-md border border-line bg-ink-800 px-3 py-2 text-sm text-mute hover:border-neon hover:text-neon"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <circle cx="7" cy="7" r="2.5" />
                <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.7 2.7l1 1M10.3 10.3l1 1M2.7 11.3l1-1M10.3 3.7l1-1" strokeLinecap="round" />
              </svg>
              Settings
            </Link>
            {install.canInstall ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void install.install();
                  props.onClose();
                }}
                className="press flex w-full items-center gap-2 rounded-md border border-neon/40 bg-neon/10 px-3 py-2 text-sm text-neon hover:bg-neon/20"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <rect x="3" y="1.5" width="8" height="11" rx="1.5" />
                  <path d="M6 10h2" strokeLinecap="round" />
                </svg>
                Install app
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={props.onLock}
              className="press flex w-full items-center gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger hover:bg-danger/15"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <rect x="2.5" y="6.5" width="9" height="6" rx="1" />
                <path d="M4.5 6.5V4a2.5 2.5 0 015 0v2.5" />
              </svg>
              Lock account
            </button>
          </div>

          <ProfileEditor activeId={props.activeId} accent={accent} />
        </div>
      ) : null}
    </div>
  );
}

function ProfileEditor({ activeId, accent }: { activeId: string | null; accent: string }) {
  const profile = useMemo(() => loadAccountProfile(activeId), [activeId]);
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [color, setColor] = useState(profile?.color ?? "#39ff88");
  useEffect(() => {
    setBio(profile?.bio ?? "");
    setColor(profile?.color ?? "#39ff88");
  }, [profile?.bio, profile?.color]);
  const [saved, setSaved] = useState(false);
  function save() {
    if (!activeId) return;
    saveAccountProfile(activeId, {
      username: profile?.username ?? "",
      bio: bio.trim() || undefined,
      color,
      updatedAt: Date.now(),
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
    notify({
      level: "success",
      category: "system",
      title: "Profile saved",
      body: bio.trim() ? "Bio and color updated." : "Color updated.",
    });
  }
  return (
    <div className="mt-3 space-y-2 rounded-md border border-line/60 bg-ink-950/40 p-2.5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase text-mute">Customize</p>
        {saved ? <span className="font-mono text-[10px] text-neon">saved</span> : null}
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] uppercase text-mute">Accent</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {["#39ff88", "#0ea5e9", "#f59e0b", "#ec4899", "#a855f7", "#ef4444"].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="press h-6 w-6 rounded-full border-2"
              style={{
                backgroundColor: c,
                borderColor: color === c ? "white" : "transparent",
                boxShadow: color === c ? `0 0 8px ${c}` : undefined,
              }}
              aria-label={`Set accent ${c}`}
              aria-pressed={color === c}
            />
          ))}
          <label className="ml-1 cursor-pointer rounded border border-line bg-ink-800 px-1.5 py-1 font-mono text-[10px] text-mute hover:border-neon hover:text-neon">
            custom
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="sr-only"
            />
          </label>
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block font-mono text-[10px] uppercase text-mute">Bio</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 120))}
          maxLength={120}
          rows={2}
          className="w-full resize-none rounded border border-line bg-ink-800 px-2 py-1.5 font-mono text-xs"
          placeholder="Trading style, focus, notes…"
        />
        <p className="mt-0.5 text-right text-[10px] text-mute">{bio.length}/120</p>
      </label>
      <button
        type="button"
        onClick={save}
        className="press w-full rounded-md border border-neon/40 bg-neon/10 px-2 py-1.5 font-mono text-[11px] font-semibold text-neon hover:bg-neon/20"
        style={{ boxShadow: `inset 0 0 0 1px ${accent}22` }}
      >
        Save profile
      </button>
    </div>
  );
}

function humanizeAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
