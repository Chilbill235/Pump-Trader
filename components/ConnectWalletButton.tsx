"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { shortenAddress } from "@/lib/format";
import { detectWallets, type DetectedWallet, type WalletId } from "@/lib/wallet-detect";

type Status = "idle" | "opening" | "opening-app" | "connecting";

export function ConnectWalletButton({ className }: { className?: string }) {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setWallets(detectWallets());
    const onFocus = () => setWallets(detectWallets());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (connected) {
      setStatus("idle");
      setOpen(false);
    }
  }, [connected]);

  const label = useMemo(() => {
    if (connected && publicKey) return shortenAddress(publicKey.toBase58(), 4, 4);
    if (connecting) return "Connecting…";
    if (status === "opening-app") return "Opening…";
    if (status === "opening") return "Opening…";
    return "Connect";
  }, [connected, publicKey, connecting, status]);

  const busy = connecting || status !== "idle";

  function handleMainClick() {
    if (connected) {
      setOpen((v) => !v);
      return;
    }
    setOpen(true);
  }

  async function pickInstalled(w: DetectedWallet) {
    if (!w.installed) return;
    setStatus("opening");
    try {
      if (w.id === "phantom") {
        const phantom = (window as Window & { solana?: { connect?: () => Promise<unknown> } }).solana;
        if (phantom?.connect) await phantom.connect();
        setOpen(false);
        return;
      }
      if (w.id === "solflare") {
        const solflare = (window as Window & { solflare?: { connect?: () => Promise<unknown> } }).solflare;
        if (solflare?.connect) await solflare.connect();
        setOpen(false);
        return;
      }
      if (w.id === "trust") {
        const trust = (window as Window & { trustwallet?: { connect?: () => Promise<unknown> } }).trustwallet;
        if (trust?.connect) {
          await trust.connect();
          setOpen(false);
          return;
        }
      }
      if (w.id === "coinbase") {
        const cb = (window as Window & { coinbaseSolana?: { connect?: () => Promise<unknown> } }).coinbaseSolana;
        if (cb?.connect) {
          await cb.connect();
          setOpen(false);
          return;
        }
      }
      setStatus("idle");
    } catch {
      setStatus("idle");
    }
  }

  function openDeeplink(w: DetectedWallet) {
    if (!w.deeplink) return;
    setStatus("opening-app");
    const a = document.createElement("a");
    a.href = w.deeplink;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => setStatus("idle"), 1500);
  }

  function openInstall(w: DetectedWallet) {
    window.open(w.installUrl, "_blank", "noopener,noreferrer");
  }

  async function copyAddress() {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey.toBase58());
    } catch {
      // ignore
    }
  }

  async function disconnectWallet() {
    try {
      await disconnect();
    } catch {
      // ignore
    }
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleMainClick}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={connected ? `Wallet ${label}` : "Connect wallet"}
        className={`press relative flex h-9 items-center gap-2 overflow-hidden rounded-md border px-3 font-mono text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-neon ${
          connected
            ? "border-neon/60 bg-gradient-to-r from-neon/15 to-neon/5 text-neon hover:from-neon/25 hover:to-neon/10"
            : "border-line bg-ink-800 text-mute hover:border-neon hover:text-neon"
        }`}
      >
        <span
          aria-hidden
          className={`relative flex h-2 w-2 ${connected ? "" : ""}`}
        >
          {connected ? (
            <>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-neon" />
            </>
          ) : (
            <span className="h-2 w-2 rounded-full bg-mute/60" />
          )}
        </span>
        <span className="truncate">{label}</span>
        {connected ? (
          <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 1.5v11l9-5.5z" fill="currentColor" stroke="none" transform="scale(.7) translate(2 0)" />
          </svg>
        )}
        {busy && !connected ? (
          <span aria-hidden className="ml-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-line bg-ink-900 p-3 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {connected ? (
            <ConnectedMenu
              address={publicKey?.toBase58() ?? ""}
              walletName={wallet?.adapter?.name ?? "Wallet"}
              onCopy={copyAddress}
              onDisconnect={disconnectWallet}
            />
          ) : (
            <Picker
              wallets={wallets}
              status={status}
              onPickInstalled={pickInstalled}
              onDeeplink={openDeeplink}
              onInstall={openInstall}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function Picker(props: {
  wallets: DetectedWallet[];
  status: Status;
  onPickInstalled: (w: DetectedWallet) => void;
  onDeeplink: (w: DetectedWallet) => void;
  onInstall: (w: DetectedWallet) => void;
}) {
  const installed = props.wallets.filter((w) => w.installed);
  const deeplink = props.wallets.filter((w) => !w.installed && w.deeplink);
  const installable = props.wallets.filter((w) => !w.installed && !w.deeplink);
  return (
    <div className="space-y-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-mute">Connect wallet</p>
        <p className="mt-0.5 text-[11px] text-mute">
          Auto-detected. Your keys never leave your wallet.
        </p>
      </div>
      {installed.length > 0 ? (
        <div>
          <p className="mb-1 font-mono text-[10px] uppercase text-mute">Ready</p>
          <ul className="space-y-1">
            {installed.map((w) => (
              <li key={w.id}>
                <WalletRow
                  w={w}
                  status={props.status}
                  onPickInstalled={props.onPickInstalled}
                  onDeeplink={props.onDeeplink}
                  onInstall={props.onInstall}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {deeplink.length > 0 ? (
        <div>
          <p className="mb-1 font-mono text-[10px] uppercase text-mute">Open in app</p>
          <ul className="space-y-1">
            {deeplink.map((w) => (
              <li key={w.id}>
                <WalletRow
                  w={w}
                  status={props.status}
                  onPickInstalled={props.onPickInstalled}
                  onDeeplink={props.onDeeplink}
                  onInstall={props.onInstall}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {installable.length > 0 ? (
        <div>
          <p className="mb-1 font-mono text-[10px] uppercase text-mute">Install</p>
          <ul className="space-y-1">
            {installable.map((w) => (
              <li key={w.id}>
                <WalletRow
                  w={w}
                  status={props.status}
                  onPickInstalled={props.onPickInstalled}
                  onDeeplink={props.onDeeplink}
                  onInstall={props.onInstall}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {installed.length === 0 && deeplink.length === 0 && installable.length === 0 ? (
        <p className="rounded border border-dashed border-line bg-ink-950/40 p-3 text-center text-xs text-mute">
          No wallet detected. Install Phantom, Solflare, Trust, or Coinbase to continue.
        </p>
      ) : null}
    </div>
  );
}

function WalletRow(props: {
  w: DetectedWallet;
  status: Status;
  onPickInstalled: (w: DetectedWallet) => void;
  onDeeplink: (w: DetectedWallet) => void;
  onInstall: (w: DetectedWallet) => void;
}) {
  const { w } = props;
  const busy = props.status !== "idle";

  if (w.installed) {
    return (
      <button
        type="button"
        onClick={() => props.onPickInstalled(w)}
        disabled={busy}
        className="press group flex w-full items-center justify-between gap-2 rounded-md border border-neon/30 bg-ink-800 px-3 py-2.5 text-left transition-all hover:border-neon hover:bg-ink-700 disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <WalletBadge id={w.id} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{w.name}</span>
            <span className="block font-mono text-[10px] text-neon">
              {w.inApp ? "In-app browser" : "Detected · click to connect"}
            </span>
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-mute group-hover:text-neon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5 3l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
    );
  }
  if (w.deeplink) {
    return (
      <button
        type="button"
        onClick={() => props.onDeeplink(w)}
        disabled={busy}
        className="press group flex w-full items-center justify-between gap-2 rounded-md border border-line bg-ink-800 px-3 py-2.5 text-left transition-all hover:border-warn hover:bg-ink-700 disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <WalletBadge id={w.id} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{w.name}</span>
            <span className="block font-mono text-[10px] text-warn">Open in {w.name} app</span>
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-mute group-hover:text-warn">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 9l6-6M5 3h4v4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => props.onInstall(w)}
      className="press group flex w-full items-center justify-between gap-2 rounded-md border border-line bg-ink-800 px-3 py-2.5 text-left transition-all hover:border-danger hover:bg-ink-700"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <WalletBadge id={w.id} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{w.name}</span>
          <span className="block font-mono text-[10px] text-danger">Install extension</span>
        </span>
      </span>
      <span aria-hidden className="shrink-0 text-mute group-hover:text-danger">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 9l6-6M5 3h4v4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

function ConnectedMenu(props: {
  address: string;
  walletName: string;
  onCopy: () => void;
  onDisconnect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await props.onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-neon/30 bg-neon/5 p-2.5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-neon">Connected</p>
        <p className="mt-1 break-all font-mono text-sm">
          {props.address}
        </p>
        <p className="mt-1 font-mono text-[11px] text-mute">via {props.walletName}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="press flex w-full items-center justify-between rounded-md border border-line bg-ink-800 px-3 py-2 text-sm hover:border-neon hover:text-neon"
      >
        <span>{copied ? "Copied!" : "Copy address"}</span>
        <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          {copied ? (
            <path d="M3 7l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <path d="M5 5V4a1 1 0 011-1h5a1 1 0 011 1v6a1 1 0 01-1 1h-1" />
            </>
          )}
        </svg>
      </button>
      <a
        href={`https://solscan.io/account/${props.address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="press flex w-full items-center justify-between rounded-md border border-line bg-ink-800 px-3 py-2 text-sm hover:border-neon hover:text-neon"
      >
        <span>View on Solscan</span>
        <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 9l6-6M5 3h4v4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
      <button
        type="button"
        onClick={props.onDisconnect}
        className="press flex w-full items-center justify-between rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger hover:bg-danger/15"
      >
        <span>Disconnect</span>
        <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 3H4a1 1 0 00-1 1v6a1 1 0 001 1h4" />
          <path d="M10 4l3 3-3 3M6 7h7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

function WalletBadge({ id }: { id: WalletId }) {
  const label = id === "phantom" ? "P" : id === "solflare" ? "S" : id === "trust" ? "T" : "C";
  const color =
    id === "phantom"
      ? "#ab9ff2"
      : id === "solflare"
      ? "#ffa133"
      : id === "trust"
      ? "#3375bb"
      : "#0052ff";
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold text-white"
      style={{ background: color }}
    >
      {label}
    </span>
  );
}
