"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAccounts } from "./AccountsProvider";
import { loadAccountProfile, saveAccountProfile } from "@/lib/profile";
import { useInstallPrompt } from "./useInstallPrompt";
import { ConnectWalletButton } from "./ConnectWalletButton";
import { notify } from "./NotificationProvider";
import { NavIcon } from "./icons/NavIcon";
import Link from "next/link";

export function MobileProfileSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { activeAccount, lock, switchTo, accounts, remove } = useAccounts();
  const wallet = useWallet();
  const install = useInstallPrompt();
  const profile = useMemo(
    () => (activeAccount ? loadAccountProfile(activeAccount.id) : null),
    [activeAccount],
  );
  const accent = profile?.color ?? "#39ff88";
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

  if (!open || !activeAccount) return null;
  return (
    <div
      className="fade-in fixed inset-0 z-50 sm:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Account menu"
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close account menu"
      />
      <div className="slide-up absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-2xl border-t border-line-soft bg-ink-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line-soft bg-ink-850/80 px-4 py-3 backdrop-blur">
          <p className="font-mono text-[10px] uppercase tracking-widest text-mute">
            Account
          </p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="press flex h-9 w-9 items-center justify-center rounded-md border border-line bg-ink-800 text-mute hover:border-neon hover:text-neon"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 scroll-thin">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-mono text-lg font-bold text-ink-950 ring-2 ring-ink-900"
              style={{ backgroundColor: accent, boxShadow: `0 0 18px ${accent}66` }}
            >
              {activeAccount.username.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-base font-semibold">@{activeAccount.username}</p>
              <p className="truncate font-mono text-[11px] text-mute">
                Joined {new Date(activeAccount.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {profile?.bio ? (
            <p className="rounded-lg border border-line-soft bg-ink-850/60 p-3 text-sm text-mute">
              {profile.bio}
            </p>
          ) : null}

          {wallet.publicKey ? (
            <div className="rounded-xl border border-neon/30 bg-neon/5 p-3">
              <div className="flex items-center gap-2">
                <span aria-hidden className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-neon" />
                </span>
                <p className="font-mono text-[10px] uppercase tracking-widest text-neon">
                  Wallet connected
                </p>
              </div>
              <p className="mt-1 break-all font-mono text-sm">{wallet.publicKey.toBase58()}</p>
              <p className="mt-0.5 font-mono text-[11px] text-mute">
                via {wallet.wallet?.adapter?.name ?? "Wallet"}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(wallet.publicKey!.toBase58());
                      notify({ level: "info", category: "system", title: "Copied", body: "Address copied." });
                    } catch {
                      // ignore
                    }
                  }}
                  className="press rounded-md border border-line bg-ink-800 px-3 py-2 font-mono text-xs text-mute hover:border-neon hover:text-neon"
                >
                  Copy address
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await wallet.disconnect();
                      notify({ level: "info", category: "wallet", title: "Disconnected" });
                    } catch {
                      // ignore
                    }
                  }}
                  className="press rounded-md border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-xs text-danger hover:bg-danger/10"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-warn/30 bg-warn/5 p-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-warn">
                No wallet connected
              </p>
              <p className="mt-1 text-[11px] text-mute">
                Connect a wallet to sign live trades. You can still paper-trade without one.
              </p>
              <div className="mt-2">
                <ConnectWalletButton className="w-full" variant="wide" />
              </div>
            </div>
          )}

          {accounts.length > 1 ? (
            <div className="rounded-xl border border-line-soft bg-ink-850/60 p-3">
              <p className="px-1 pb-1.5 font-mono text-[10px] uppercase tracking-widest text-mute">
                Switch account
              </p>
              <ul className="space-y-0.5">
                {accounts
                  .filter((a) => a.id !== activeAccount.id)
                  .map((a) => (
                    <li key={a.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        className="press flex flex-1 items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-ink-800"
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
                        <span className="truncate">@{a.username}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete @${a.username}`}
                        className="press shrink-0 rounded-md p-2 text-mute hover:bg-danger/10 hover:text-danger"
                        onClick={async () => {
                          if (confirm(`Delete @${a.username}? This cannot be undone.`)) {
                            remove(a.id);
                            onClose();
                          }
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                          <path d="M3 3l8 8M11 3L3 11" strokeLinecap="round" />
                        </svg>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-1.5">
            <Link
              href="/settings"
              onClick={onClose}
              className="press flex items-center justify-center gap-2 rounded-lg border border-line bg-ink-850 px-3 py-3 text-sm text-mute hover:border-neon hover:text-neon"
            >
              <NavIcon name="settings" className="h-4 w-4" />
              Settings
            </Link>
            {install.canInstall ? (
              <button
                type="button"
                onClick={() => {
                  void install.install();
                  onClose();
                }}
                className="press flex items-center justify-center gap-2 rounded-lg border border-neon/30 bg-neon/10 px-3 py-3 text-sm text-neon hover:bg-neon/20"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <rect x="3" y="1.5" width="8" height="11" rx="1.5" />
                  <path d="M6 10h2" strokeLinecap="round" />
                </svg>
                Install
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  lock();
                  onClose();
                }}
                className="press flex items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-3 text-sm text-danger hover:bg-danger/10"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <rect x="2.5" y="6.5" width="9" height="6" rx="1" />
                  <path d="M4.5 6.5V4a2.5 2.5 0 015 0v2.5" />
                </svg>
                Lock
              </button>
            )}
          </div>

          {install.canInstall ? (
            <button
              type="button"
              onClick={() => {
                lock();
                onClose();
              }}
              className="press flex w-full items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-3 text-sm text-danger hover:bg-danger/10"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <rect x="2.5" y="6.5" width="9" height="6" rx="1" />
                <path d="M4.5 6.5V4a2.5 2.5 0 015 0v2.5" />
              </svg>
              Lock account
            </button>
          ) : null}

          <MobileProfileEditor
            activeId={activeAccount.id}
            initialBio={profile?.bio ?? ""}
            initialColor={profile?.color ?? "#39ff88"}
          />
        </div>
      </div>
    </div>
  );
}

function MobileProfileEditor({
  activeId,
  initialBio,
  initialColor,
}: {
  activeId: string;
  initialBio: string;
  initialColor: string;
}) {
  const [bio, setBio] = useState(initialBio);
  const [color, setColor] = useState(initialColor);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setBio(initialBio);
    setColor(initialColor);
  }, [initialBio, initialColor]);
  function save() {
    saveAccountProfile(activeId, {
      username: "",
      bio: bio.trim() || undefined,
      color,
      updatedAt: Date.now(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    notify({
      level: "success",
      category: "system",
      title: "Profile saved",
      body: bio.trim() ? "Bio and color updated." : "Color updated.",
    });
  }
  return (
    <div className="rounded-xl border border-line-soft bg-ink-850/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-mute">Customize</p>
        {saved ? (
          <span className="flex items-center gap-1 font-mono text-[10px] text-neon">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M2 5l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            saved
          </span>
        ) : null}
      </div>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-mute">Accent</p>
      <div className="flex flex-wrap items-center gap-2">
        {["#39ff88", "#0ea5e9", "#f59e0b", "#ec4899", "#a855f7", "#ef4444"].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className="press h-8 w-8 rounded-full border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: c,
              borderColor: color === c ? "white" : "transparent",
              boxShadow: color === c ? `0 0 10px ${c}` : undefined,
            }}
            aria-label={`Set accent ${c}`}
            aria-pressed={color === c}
          />
        ))}
        <label className="press ml-1 cursor-pointer rounded-md border border-line bg-ink-800 px-2.5 py-1.5 font-mono text-[10px] text-mute hover:border-neon hover:text-neon">
          custom
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="sr-only"
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-mute">
          Bio
        </span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 120))}
          maxLength={120}
          rows={2}
          className="w-full resize-none rounded-md border border-line bg-ink-900 px-2.5 py-2 font-mono text-sm outline-none focus:border-neon"
          placeholder="Trading style, focus, notes…"
        />
        <p className="mt-0.5 text-right text-[10px] text-mute-2">{bio.length}/120</p>
      </label>
      <button
        type="button"
        onClick={save}
        className="press mt-2 w-full rounded-md border border-neon/40 bg-neon/10 px-3 py-2 font-mono text-sm font-semibold text-neon hover:bg-neon/20"
      >
        Save profile
      </button>
    </div>
  );
}
