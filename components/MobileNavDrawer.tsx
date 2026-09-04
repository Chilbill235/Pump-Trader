"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAccounts } from "./AccountsProvider";
import { useInstallPrompt } from "./useInstallPrompt";
import { NavIcon, type NavIconName } from "./icons/NavIcon";
import { useWallet } from "@solana/wallet-adapter-react";
import { shortenAddress } from "@/lib/format";

type NavItem = { href: string; label: string; icon: NavIconName };

const NAV: NavItem[] = [
  { href: "/", label: "Markets", icon: "markets" },
  { href: "/watch", label: "Watch", icon: "watch" },
  { href: "/wallet", label: "Wallet", icon: "wallet" },
  { href: "/positions", label: "Positions", icon: "positions" },
  { href: "/bot", label: "Bot", icon: "bot" },
];

export function MobileNavDrawer({
  open,
  onClose,
  onOpenProfile,
}: {
  open: boolean;
  onClose: () => void;
  onOpenProfile?: () => void;
}) {
  const pathname = usePathname();
  const { accounts, activeAccount, switchTo, lock } = useAccounts();
  const install = useInstallPrompt();
  const wallet = useWallet();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    setTimeout(() => closeRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!open) return null;
  return (
    <div
      className="fade-in fixed inset-0 z-50 sm:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close menu"
      />
      <aside className="slide-in-left absolute left-0 top-0 flex h-full w-[85%] max-w-sm flex-col border-r border-line-soft bg-ink-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-line-soft bg-ink-850/80 px-4 py-3 backdrop-blur">
          <Link
            href="/"
            onClick={onClose}
            className="press flex items-center gap-2"
            aria-label="Home"
          >
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-md border border-neon/30 bg-gradient-to-br from-neon/20 via-info/10 to-transparent text-neon"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path
                  d="M2 11l3-6 3 3 3-7 3 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="font-mono text-sm font-semibold tracking-widest">
              <span className="text-gradient">PUMP</span>
              <span className="ml-1 text-white">TRADER</span>
            </span>
          </Link>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="press flex h-9 w-9 items-center justify-center rounded-md border border-line bg-ink-800 text-mute hover:border-neon hover:text-neon"
            aria-label="Close menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {activeAccount ? (
          onOpenProfile ? (
            <button
              type="button"
              onClick={onOpenProfile}
              className="press border-b border-line-soft bg-ink-850/40 px-4 py-3 text-left transition-colors hover:bg-ink-800"
              aria-label="Open profile"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-10 items-center justify-center rounded-full font-mono text-base font-bold text-ink-950 ring-2 ring-ink-900"
                  style={{
                    backgroundColor: "var(--neon)",
                    boxShadow: "0 0 14px rgba(57,255,136,0.4)",
                  }}
                >
                  {activeAccount.username.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-semibold">@{activeAccount.username}</p>
                  <p className="truncate font-mono text-[11px] text-mute">
                    Joined {new Date(activeAccount.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <svg
                  aria-hidden
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  className="text-mute"
                >
                  <path d="M5 3l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              {wallet.publicKey ? (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-neon/30 bg-neon/5 px-2 py-1.5">
                  <span aria-hidden className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-neon" />
                  </span>
                  <p className="truncate font-mono text-[11px] text-neon">
                    {shortenAddress(wallet.publicKey.toBase58(), 4, 4)} · {wallet.wallet?.adapter?.name ?? "Wallet"}
                  </p>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-warn/30 bg-warn/5 px-2 py-1.5">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warn" />
                  <p className="font-mono text-[11px] text-warn">No wallet connected · tap to connect</p>
                </div>
              )}
            </button>
          ) : (
            <div className="border-b border-line-soft bg-ink-850/40 px-4 py-3">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-10 items-center justify-center rounded-full font-mono text-base font-bold text-ink-950 ring-2 ring-ink-900"
                  style={{
                    backgroundColor: "var(--neon)",
                    boxShadow: "0 0 14px rgba(57,255,136,0.4)",
                  }}
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
              {wallet.publicKey ? (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-neon/30 bg-neon/5 px-2 py-1.5">
                  <span aria-hidden className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-neon" />
                  </span>
                  <p className="truncate font-mono text-[11px] text-neon">
                    {shortenAddress(wallet.publicKey.toBase58(), 4, 4)} · {wallet.wallet?.adapter?.name ?? "Wallet"}
                  </p>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-warn/30 bg-warn/5 px-2 py-1.5">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warn" />
                  <p className="font-mono text-[11px] text-warn">No wallet connected</p>
                </div>
              )}
            </div>
          )
        ) : null}

        <nav className="flex-1 overflow-y-auto p-2" aria-label="Primary mobile">
          <ul className="space-y-1">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/" || pathname.startsWith("/coin/")
                  : pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={`press flex items-center gap-3 rounded-lg border px-3 py-3 text-sm ${
                      active
                        ? "border-neon/40 bg-neon/10 text-neon shadow-[inset_0_0_0_1px_rgba(57,255,136,0.3)]"
                        : "border-transparent text-mute hover:border-line hover:bg-ink-850 hover:text-white"
                    }`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-md border ${
                        active
                          ? "border-neon/40 bg-neon/10 text-neon"
                          : "border-line bg-ink-850 text-mute"
                      }`}
                    >
                      <NavIcon name={item.icon} className="h-4 w-4" />
                    </span>
                    <span className="flex-1 font-medium">{item.label}</span>
                    {active ? <span aria-hidden className="text-neon">●</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>

          {accounts.length > 1 ? (
            <div className="mt-4">
              <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-widest text-mute">
                Switch account
              </p>
              <ul className="space-y-0.5">
                {accounts
                  .filter((a) => a.id !== activeAccount?.id)
                  .map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        className="press flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm text-mute hover:border-line hover:bg-ink-850 hover:text-white"
                        onClick={() => {
                          switchTo(a.id);
                          onClose();
                        }}
                      >
                        <span
                          aria-hidden
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-700 font-mono text-xs font-bold text-mute"
                        >
                          {a.username.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="flex-1 truncate">@{a.username}</span>
                        <span aria-hidden className="text-mute-2">→</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </nav>

        <footer className="space-y-1 border-t border-line-soft bg-ink-850/40 p-3">
          <Link
            href="/settings"
            onClick={onClose}
            className="press flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm text-mute hover:border-line hover:bg-ink-850 hover:text-white"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-ink-850 text-mute">
              <NavIcon name="settings" className="h-4 w-4" />
            </span>
            <span className="flex-1">Settings</span>
            <span aria-hidden className="text-mute-2">›</span>
          </Link>
          {install.canInstall ? (
            <button
              type="button"
              onClick={() => {
                void install.install();
                onClose();
              }}
              className="press flex w-full items-center gap-3 rounded-lg border border-neon/30 bg-neon/10 px-3 py-2.5 text-left text-sm text-neon hover:bg-neon/20"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md border border-neon/30 bg-neon/10 text-neon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <rect x="3" y="1.5" width="8" height="11" rx="1.5" />
                  <path d="M6 10h2" strokeLinecap="round" />
                </svg>
              </span>
              <span className="flex-1">Install app</span>
              <span aria-hidden className="text-neon">↗</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              lock();
              onClose();
            }}
            className="press flex w-full items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-left text-sm text-danger hover:bg-danger/10"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-danger/30 text-danger">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <rect x="2.5" y="6.5" width="9" height="6" rx="1" />
                <path d="M4.5 6.5V4a2.5 2.5 0 015 0v2.5" />
              </svg>
            </span>
            <span className="flex-1">Lock account</span>
            <span aria-hidden className="text-danger/70">→</span>
          </button>
        </footer>
      </aside>
    </div>
  );
}
