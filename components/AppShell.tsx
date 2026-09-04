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
import { NotificationBell, ToastBanner, NotificationPanel } from "./NotificationCenter";
import { notify } from "./NotificationProvider";
import { useInstallPrompt } from "./useInstallPrompt";
import { loadAccountProfile, saveAccountProfile } from "@/lib/profile";
import { ConnectWalletButton } from "./ConnectWalletButton";
import { NavIcon, type NavIconName } from "./icons/NavIcon";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { MobileProfileSheet } from "./MobileProfileSheet";
import { QuickMintFAB } from "./QuickMintFAB";

type NavItem = { href: string; label: string; short: string; icon: NavIconName };

const NAV: NavItem[] = [
  { href: "/", label: "Markets", short: "Markets", icon: "markets" },
  { href: "/watch", label: "Watch", short: "Watch", icon: "watch" },
  { href: "/wallet", label: "Wallet", short: "Wallet", icon: "wallet" },
  { href: "/positions", label: "Positions", short: "Pos", icon: "positions" },
  { href: "/bot", label: "Bot", short: "Bot", icon: "bot" },
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
  const { publicKey, connected, wallet: activeWallet } = wallet;
  const { activeAccount, lock, accounts, switchTo, remove } = useAccounts();
  const walletData = useWalletData();
  const { sol, holdings, live, endpoint, solUsd } = walletData;
  const [botModalOpen, setBotModalOpen] = useState(false);
  const [botSession, setBotSession] = useState<BotSessionInfo | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!navOpen && !mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavOpen(false);
        setMobileNavOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen, mobileNavOpen]);

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

  const walletOk = !!publicKey && connected;
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
    <div className="min-h-screen text-zinc-100">
      <Header
        pathname={pathname}
        navOpen={navOpen}
        setNavOpen={setNavOpen}
        mobileNavOpen={mobileNavOpen}
        setMobileNavOpen={setMobileNavOpen}
        profileOpen={profileOpen}
        setProfileOpen={setProfileOpen}
        mobileProfileOpen={mobileProfileOpen}
        setMobileProfileOpen={setMobileProfileOpen}
        notifOpen={notifOpen}
        setNotifOpen={setNotifOpen}
        isMobile={isMobile}
        settings={settings}
        walletOk={walletOk}
        botRunning={botRunning}
        autoTradeActive={autoTradeActive}
        publicKey={publicKey?.toBase58() ?? null}
        walletName={activeWallet?.adapter?.name ?? null}
        sol={sol}
        solUsd={solUsd}
        holdingsCount={holdings.length}
        live={live}
        endpoint={endpoint}
        accounts={accounts}
        activeId={activeAccount?.id ?? null}
        onLock={() => {
          lock();
          setProfileOpen(false);
          setMobileProfileOpen(false);
        }}
        onSwitch={(id) => {
          switchTo(id);
          setProfileOpen(false);
          setMobileProfileOpen(false);
        }}
        onRemove={(id) => {
          remove(id);
          setProfileOpen(false);
          setMobileProfileOpen(false);
        }}
      />

      {isPublicRpc(settings.rpcUrl) ? (
        <div className="border-b border-warn/20 bg-gradient-to-r from-warn/10 via-warn/5 to-warn/10 px-3 py-1.5 text-center font-mono text-[11px] text-warn sm:px-4">
          {PUBLIC_RPC_WARNING}
        </div>
      ) : null}

      {botRunning ? (
        <BotRunningStrip
          session={botSession}
          simulate={settings.simulateMode}
          walletOk={walletOk}
          onStop={stopBot}
        />
      ) : null}

      {connected && !botRunning && !autoTradeActive && pathname !== "/bot" && pathname !== "/" ? (
        <StartBotBanner onStart={() => setBotModalOpen(true)} walletOk={walletOk} />
      ) : null}

      <main className="mx-auto max-w-[1400px] px-3 pb-24 pt-4 sm:px-4 sm:pb-6">{children}</main>

      <BottomTabBar pathname={pathname} />

      <ToastBanner />
      <NotificationPanel open={notifOpen} onClose={() => setNotifOpen(false)} />

      <StartBotModal open={botModalOpen} onClose={() => setBotModalOpen(false)} />

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        onOpenProfile={() => {
          setMobileNavOpen(false);
          setMobileProfileOpen(true);
        }}
      />
      <MobileProfileSheet open={mobileProfileOpen} onClose={() => setMobileProfileOpen(false)} />
      <QuickMintFAB
        visible={
          pathname === "/" ||
          pathname === "/markets" ||
          pathname === "/watch" ||
          pathname === "/positions" ||
          pathname.startsWith("/coin/")
        }
      />
    </div>
  );
}

function Header(props: {
  pathname: string;
  navOpen: boolean;
  setNavOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  profileOpen: boolean;
  setProfileOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  mobileProfileOpen: boolean;
  setMobileProfileOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  notifOpen: boolean;
  setNotifOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  isMobile: boolean;
  settings: ReturnType<typeof useSettings>["settings"];
  walletOk: boolean;
  botRunning: boolean;
  autoTradeActive: boolean;
  publicKey: string | null;
  walletName: string | null;
  sol: number | null;
  solUsd: number | null;
  holdingsCount: number;
  live: boolean;
  endpoint: string | null;
  accounts: Array<{ id: string; username: string }>;
  activeId: string | null;
  onLock: () => void;
  onSwitch: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { activeAccount: headerAccount } = useAccounts();
  const headerProfile = useMemo(() => loadAccountProfile(props.activeId), [props.activeId]);
  const mobileAccent = headerProfile?.color ?? "#39ff88";
  const mobileInitial = (headerAccount?.username ?? "?").slice(0, 1).toUpperCase();
  return (
    <header className="sticky top-0 z-30 border-b border-line-soft/80 glass safe-top">
      <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
        <button
          type="button"
          className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-ink-800 text-mute hover:border-neon hover:text-neon sm:hidden"
          onClick={() => props.setMobileNavOpen(true)}
          aria-label="Open menu"
          aria-expanded={props.mobileNavOpen}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round" />
          </svg>
        </button>

        <Link
          href="/"
          className="press group flex shrink-0 items-center gap-2"
          aria-label="Pump Trader home"
        >
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-md border border-neon/30 bg-gradient-to-br from-neon/20 via-info/10 to-transparent text-neon shadow-[0_0_18px_-4px_rgba(57,255,136,0.5)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M2 11l3-6 3 3 3-7 3 9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="font-mono text-base font-semibold tracking-[0.18em]">
            <span className="text-gradient">PUMP</span>
            <span className="ml-1.5 text-white">TRADER</span>
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className={`${props.navOpen ? "flex" : "hidden"} absolute left-3 right-3 top-[calc(100%+6px)] z-40 flex-col gap-1 rounded-xl border border-line bg-ink-900/95 p-2 shadow-2xl backdrop-blur-xl sm:!static sm:!flex sm:w-auto sm:flex-row sm:items-center sm:gap-1 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`}
        >
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? props.pathname === "/" || props.pathname.startsWith("/coin/")
                : props.pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => props.setNavOpen(false)}
                className={`press relative flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors sm:py-1.5 ${
                  active
                    ? "bg-neon/15 text-neon shadow-[inset_0_0_0_1px_rgba(57,255,136,0.25)]"
                    : "text-mute hover:bg-ink-800 hover:text-white"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <NavIcon name={item.icon} className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <StatusPill
            simulate={props.settings.simulateMode}
            botRunning={props.botRunning}
            autoTrade={props.autoTradeActive}
          />
          {props.publicKey ? <BalanceChip
            sol={props.sol}
            solUsd={props.solUsd}
            holdingsCount={props.holdingsCount}
            live={props.live}
            endpoint={props.endpoint}
          /> : null}
          <NotificationBell onOpenChange={props.setNotifOpen} open={props.notifOpen} />
          {props.activeId ? (
            <>
              <button
                type="button"
                onClick={() => props.setMobileProfileOpen(true)}
                className="press relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-ink-800/80 sm:hidden"
                title="Account"
                aria-label="Account"
                aria-haspopup="dialog"
                style={{ borderColor: `${mobileAccent}66` }}
              >
                <span
                  aria-hidden
                  className="flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs font-bold text-ink-950"
                  style={{ backgroundColor: mobileAccent, boxShadow: `0 0 10px ${mobileAccent}55` }}
                >
                  {mobileInitial}
                </span>
                {props.walletOk ? (
                  <span aria-hidden className="live-pulse absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-ink-900 bg-neon" />
                ) : null}
              </button>
              <div className="hidden sm:block">
                <ProfileMenu
                  open={props.profileOpen}
                  onToggle={() => {
                    props.setProfileOpen((v) => !v);
                    props.setNotifOpen(false);
                  }}
                  onClose={() => props.setProfileOpen(false)}
                  onMobileOpen={() => props.setMobileProfileOpen(true)}
                  mobileOnlyTrigger={false}
                  walletName={props.walletName}
                  publicKey={props.publicKey}
                  walletOk={props.walletOk}
                  accounts={props.accounts}
                  activeId={props.activeId}
                  onLock={props.onLock}
                  onSwitch={props.onSwitch}
                  onRemove={props.onRemove}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function BalanceChip(props: {
  sol: number | null;
  solUsd: number | null;
  holdingsCount: number;
  live: boolean;
  endpoint: string | null;
}) {
  const usd = props.sol != null && props.solUsd != null ? props.sol * props.solUsd : null;
  return (
    <Link
      href="/wallet"
      data-tip={
        props.endpoint
          ? `via ${props.endpoint}${props.live ? " · live" : " · polled"}`
          : "Wallet balance"
      }
      className="press hidden items-center gap-1.5 rounded-md border border-line bg-ink-800/80 px-2.5 py-1.5 font-mono text-xs hover:border-neon hover:bg-ink-800 sm:inline-flex"
    >
      <span aria-hidden className="relative flex h-1.5 w-1.5">
        {props.live ? (
          <>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-neon" />
          </>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-mute-2" />
        )}
      </span>
      <span aria-hidden className="text-neon">◎</span>
      <span className="text-zinc-100">
        {props.sol == null ? (
          <span className="inline-block h-3 w-12 rounded skeleton align-middle" />
        ) : (
          props.sol.toFixed(4)
        )}
      </span>
      {usd != null ? (
        <span className="text-mute-2">${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}</span>
      ) : null}
      {props.holdingsCount > 0 ? (
        <span className="rounded bg-neon/15 px-1 font-mono text-[10px] text-neon">
          +{props.holdingsCount}
        </span>
      ) : null}
    </Link>
  );
}

function StatusPill(props: { simulate: boolean; botRunning: boolean; autoTrade: boolean }) {
  if (props.botRunning) {
    return (
      <span
        data-tip="Auto-trade bot is running"
        className="hidden items-center gap-1.5 rounded-md border border-neon/40 bg-neon/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-neon sm:inline-flex"
      >
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
      <span
        data-tip="Auto-trade armed"
        className="hidden items-center gap-1.5 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-warn sm:inline-flex"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-warn" />
        AUTO
      </span>
    );
  }
  return (
    <span
      data-tip={props.simulate ? "Simulate mode — paper trades only" : "Live mode — real SOL trades"}
      className={`hidden items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold sm:inline-flex ${
        props.simulate
          ? "border-warn/40 bg-warn/10 text-warn"
          : "border-danger/40 bg-danger/10 text-danger"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${props.simulate ? "bg-warn" : "bg-danger"}`} />
      {props.simulate ? "SIM" : "LIVE"}
    </span>
  );
}

function BotRunningStrip(props: {
  session: BotSessionInfo | null;
  simulate: boolean;
  walletOk: boolean;
  onStop: () => void;
}) {
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const age = props.session ? humanizeAge(now - props.session.startedAt) : "—";
  return (
    <div className="relative overflow-hidden border-b border-neon/30 bg-gradient-to-r from-neon/15 via-neon/5 to-neon/15">
      <div aria-hidden className="pointer-events-none absolute inset-0 marquee whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.4em] text-neon/15">
        AUTO TRADING · PUMP TRADER · BOT ACTIVE · AUTO TRADING · PUMP TRADER · BOT ACTIVE · AUTO TRADING · PUMP TRADER · BOT ACTIVE ·
      </div>
      <div className="relative mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-neon" />
          </span>
          <span className="font-mono text-neon">
            BOT RUNNING · {props.simulate ? "SIMULATE" : "LIVE"}
            {age !== "—" ? ` · ${age}` : ""}
          </span>
          {!props.walletOk ? (
            <span className="font-mono text-warn">· wallet disconnected</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={props.onStop}
          className="press rounded border border-danger/60 bg-danger/10 px-3 py-1 font-mono text-[11px] font-semibold text-danger hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          STOP
        </button>
      </div>
    </div>
  );
}

function StartBotBanner({ onStart, walletOk }: { onStart: () => void; walletOk: boolean }) {
  return (
    <div className="relative overflow-hidden border-b border-line/60 bg-gradient-to-r from-ink-900 via-ink-850 to-ink-900">
      <div aria-hidden className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div className="relative mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-widest text-neon">Autonomous trading</p>
          <p className="mt-0.5 text-sm text-mute">
            Turn on the watch pipeline and let it score new launches while you&apos;re away.{" "}
            <span className="text-mute-2">Simulate mode is on by default.</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="press inline-flex shrink-0 items-center gap-2 rounded-md border border-neon bg-gradient-to-br from-neon to-emerald-400 px-4 py-2 font-mono text-sm font-semibold text-ink-950 shadow-neon transition-all hover:shadow-[0_0_28px_rgba(57,255,136,0.6)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
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

function BottomTabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line-soft bg-ink-900/95 backdrop-blur-xl safe-bottom sm:hidden"
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
            className={`press relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] uppercase tracking-wide ${
              active ? "text-neon" : "text-mute"
            }`}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
          >
            {active ? (
              <span aria-hidden className="absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-full bg-neon shadow-[0_0_8px_rgba(57,255,136,0.6)]" />
            ) : null}
            <NavIcon name={item.icon} className="h-5 w-5" />
            <span>{item.short}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ProfileMenu(props: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onMobileOpen: () => void;
  mobileOnlyTrigger: boolean;
  walletName: string | null;
  publicKey: string | null;
  walletOk: boolean;
  accounts: Array<{ id: string; username: string }>;
  activeId: string | null;
  onLock: () => void;
  onSwitch: (id: string) => void;
  onRemove: (id: string) => void;
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
        onClick={props.mobileOnlyTrigger ? props.onMobileOpen : props.onToggle}
        className="press relative flex h-9 items-center gap-2 rounded-md border border-line bg-ink-800/80 pl-1.5 pr-2.5 font-mono text-xs hover:border-neon hover:bg-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon"
        title="Account menu"
        aria-haspopup={props.mobileOnlyTrigger ? "dialog" : "menu"}
        aria-expanded={props.mobileOnlyTrigger ? undefined : props.open}
      >
        <span
          aria-hidden
          className="flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold text-ink-950 ring-2 ring-ink-900"
          style={{ backgroundColor: accent, boxShadow: `0 0 10px ${accent}55` }}
        >
          {activeAccount.username.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden max-w-[10ch] truncate text-mute sm:inline">@{activeAccount.username}</span>
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className={`text-mute-2 transition-transform ${props.open ? "rotate-180" : ""}`}
        >
          <path d="M2 4l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {props.open ? (
        <div
          ref={menuRef}
          role="menu"
          className="slide-in-right absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line glass-strong shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            aria-hidden
            className="h-1.5 w-full"
            style={{
              background: `linear-gradient(90deg, ${accent} 0%, transparent 100%)`,
            }}
          />
          <div className="space-y-3 p-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold text-ink-950 ring-2 ring-ink-900"
                style={{ backgroundColor: accent, boxShadow: `0 0 16px ${accent}66` }}
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

            {profile?.bio ? (
              <p className="rounded-md border border-line/60 bg-ink-950/40 p-2 text-xs text-mute">
                {profile.bio}
              </p>
            ) : null}

            <WalletSection
              walletOk={props.walletOk}
              walletName={props.walletName}
              publicKey={props.publicKey}
            />

            {props.accounts.length > 1 ? (
              <div className="rounded-md border border-line/60 bg-ink-950/40 p-2">
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

            <div className="grid grid-cols-1 gap-1">
              <Link
                href="/settings"
                onClick={props.onClose}
                role="menuitem"
                className="press flex items-center gap-2 rounded-md border border-line bg-ink-800 px-3 py-2 text-sm text-mute hover:border-neon hover:text-neon"
              >
                <NavIcon name="settings" className="h-4 w-4" />
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
                  className="press flex items-center gap-2 rounded-md border border-neon/40 bg-neon/10 px-3 py-2 text-sm text-neon hover:bg-neon/20"
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
                className="press flex items-center gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger hover:bg-danger/15"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <rect x="2.5" y="6.5" width="9" height="6" rx="1" />
                  <path d="M4.5 6.5V4a2.5 2.5 0 015 0v2.5" />
                </svg>
                Lock account
              </button>
            </div>

            <ProfileEditor activeId={props.activeId} onClose={props.onClose} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WalletSection(props: {
  walletOk: boolean;
  walletName: string | null;
  publicKey: string | null;
}) {
  if (props.walletOk && props.publicKey) {
    return (
      <div className="rounded-md border border-neon/30 bg-neon/5 p-2.5">
        <div className="flex items-center gap-2">
          <span aria-hidden className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-neon" />
          </span>
          <p className="font-mono text-[10px] uppercase tracking-widest text-neon">Wallet connected</p>
        </div>
        <p className="mt-1 break-all font-mono text-sm">{props.publicKey}</p>
        <p className="mt-0.5 font-mono text-[11px] text-mute">via {props.walletName ?? "Wallet"}</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(props.publicKey!);
                notify({ level: "info", category: "system", title: "Copied", body: "Address copied." });
              } catch {
                // ignore
              }
            }}
            className="press rounded border border-line bg-ink-800 px-2 py-1.5 font-mono text-[11px] text-mute hover:border-neon hover:text-neon"
          >
            Copy
          </button>
          <Link
            href="/wallet"
            className="press rounded border border-line bg-ink-800 px-2 py-1.5 text-center font-mono text-[11px] text-mute hover:border-neon hover:text-neon"
          >
            Manage
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-warn/30 bg-warn/5 p-2.5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-warn">No wallet connected</p>
      <p className="mt-1 text-[11px] text-mute">
        Connect a wallet to sign live trades. You can still paper-trade without one.
      </p>
      <div className="mt-2">
        <ConnectWalletButton className="w-full" variant="wide" />
      </div>
    </div>
  );
}

function ProfileEditor({
  activeId,
  onClose,
}: {
  activeId: string | null;
  onClose: () => void;
}) {
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
    <div className="rounded-md border border-line/60 bg-ink-950/40 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase text-mute">Customize</p>
        {saved ? (
          <span className="flex items-center gap-1 font-mono text-[10px] text-neon">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M2 5l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            saved
          </span>
        ) : null}
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] uppercase text-mute">Accent</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {["#39ff88", "#0ea5e9", "#f59e0b", "#ec4899", "#a855f7", "#ef4444"].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="press h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: c,
                borderColor: color === c ? "white" : "transparent",
                boxShadow: color === c ? `0 0 10px ${c}` : undefined,
              }}
              aria-label={`Set accent ${c}`}
              aria-pressed={color === c}
            />
          ))}
          <label className="press ml-1 cursor-pointer rounded border border-line bg-ink-800 px-1.5 py-1 font-mono text-[10px] text-mute hover:border-neon hover:text-neon">
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
      <label className="mt-2 block">
        <span className="mb-1 block font-mono text-[10px] uppercase text-mute">Bio</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 120))}
          maxLength={120}
          rows={2}
          className="w-full resize-none rounded border border-line bg-ink-800 px-2 py-1.5 font-mono text-xs focus:border-neon focus:outline-none"
          placeholder="Trading style, focus, notes…"
        />
        <p className="mt-0.5 text-right text-[10px] text-mute-2">{bio.length}/120</p>
      </label>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={save}
          className="press flex-1 rounded-md border border-neon/40 bg-neon/10 px-2 py-1.5 font-mono text-[11px] font-semibold text-neon hover:bg-neon/20"
        >
          Save profile
        </button>
        <button
          type="button"
          onClick={onClose}
          className="press rounded-md border border-line bg-ink-800 px-2 py-1.5 font-mono text-[11px] text-mute hover:border-danger hover:text-danger"
        >
          Close
        </button>
      </div>
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
