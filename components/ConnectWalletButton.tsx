"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { shortenAddress } from "@/lib/format";
import { detectWallets, type DetectedWallet, type WalletId } from "@/lib/wallet-detect";

type Status = "idle" | "opening" | "installing" | "connecting";

export function ConnectWalletButton({ className }: { className?: string }) {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
    setWallets(detectWallets());
    // Re-check on focus in case the user just installed one.
    const onFocus = () => setWallets(detectWallets());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (status === "idle") return;
    if (connected || (!connecting && status === "connecting")) {
      setStatus("idle");
      setOpen(false);
    }
  }, [connected, connecting, status]);

  const label = useMemo(() => {
    if (!mounted) return "Connect Wallet";
    if (connected && publicKey) return shortenAddress(publicKey.toBase58(), 4, 4);
    if (connecting || status === "connecting") return "Connecting…";
    if (status === "installing") return "Opening…";
    if (status === "opening") return "Opening…";
    return "Connect Wallet";
  }, [connected, publicKey, connecting, status, mounted]);

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
        setVisible(false);
        setStatus("idle");
        setOpen(false);
        return;
      }
      if (w.id === "solflare") {
        const solflare = (window as Window & { solflare?: { connect?: () => Promise<unknown> } }).solflare;
        if (solflare?.connect) await solflare.connect();
        setVisible(false);
        setStatus("idle");
        setOpen(false);
        return;
      }
      if (w.id === "trust") {
        const trust = (window as Window & { trustwallet?: { connect?: () => Promise<unknown> } }).trustwallet;
        if (trust?.connect) {
          await trust.connect();
          setStatus("idle");
          setOpen(false);
          return;
        }
      }
      if (w.id === "coinbase") {
        const cb = (window as Window & { coinbaseSolana?: { connect?: () => Promise<unknown> } }).coinbaseSolana;
        if (cb?.connect) {
          await cb.connect();
          setStatus("idle");
          setOpen(false);
          return;
        }
      }
      // Fallback: open the standard adapter modal so the user can pick.
      setVisible(true);
      setStatus("idle");
    } catch {
      setStatus("idle");
      setVisible(true);
    }
  }

  function openDeeplink(w: DetectedWallet) {
    if (!w.deeplink) return;
    setStatus("installing");
    const a = document.createElement("a");
    a.href = w.deeplink;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setStatus("idle"), 800);
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
        type="button"
        onClick={handleMainClick}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`press flex h-9 items-center gap-2 rounded border px-3 font-mono text-xs transition-colors ${
          connected
            ? "border-neon/60 bg-neon/10 text-neon hover:bg-neon/20"
            : "border-line bg-ink-800 text-mute hover:border-neon hover:text-neon"
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-neon live-pulse" : "bg-mute/60"}`}
        />
        {label}
        {connected ? <span aria-hidden className="text-[10px]">▾</span> : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-line bg-ink-900 p-3 shadow-2xl"
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
              onOpenStandard={() => {
                setVisible(true);
                setOpen(false);
              }}
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
  onOpenStandard: () => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="px-1 font-mono text-[10px] uppercase tracking-widest text-mute">Wallet</p>
        <p className="px-1 pt-0.5 text-[11px] text-mute">
          Auto-detected. Installed wallets connect with one tap.
        </p>
      </div>
      <ul className="space-y-1">
        {props.wallets.map((w) => (
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
      <button
        type="button"
        onClick={props.onOpenStandard}
        className="press mt-2 w-full rounded border border-line bg-ink-800 px-3 py-2 text-left font-mono text-[11px] text-mute hover:border-neon hover:text-neon"
      >
        Show all wallets…
      </button>
      <p className="px-1 pt-1 text-[10px] text-mute">
        Your keys never leave your wallet. We sign in the browser.
      </p>
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
  if (w.installed) {
    return (
      <button
        type="button"
        onClick={() => props.onPickInstalled(w)}
        disabled={props.status !== "idle"}
        className="press group flex w-full items-center justify-between rounded border border-line bg-ink-800 px-3 py-2 text-left hover:border-neon disabled:opacity-50"
      >
        <span className="flex items-center gap-2">
          <WalletBadge id={w.id} />
          <span className="text-sm">{w.name}</span>
          {w.inApp ? (
            <span className="rounded bg-neon/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-neon">
              in-app
            </span>
          ) : (
            <span className="rounded bg-neon/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-neon">
              installed
            </span>
          )}
        </span>
        <span aria-hidden className="text-mute group-hover:text-neon">
          →
        </span>
      </button>
    );
  }
  if (w.deeplink) {
    return (
      <button
        type="button"
        onClick={() => props.onDeeplink(w)}
        disabled={props.status !== "idle"}
        className="press group flex w-full items-center justify-between rounded border border-line bg-ink-800 px-3 py-2 text-left hover:border-warn disabled:opacity-50"
      >
        <span className="flex items-center gap-2">
          <WalletBadge id={w.id} />
          <span className="text-sm">{w.name}</span>
          <span className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-warn">
            open in {w.name}
          </span>
        </span>
        <span aria-hidden className="text-mute group-hover:text-warn">
          ↗
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => props.onInstall(w)}
      className="press group flex w-full items-center justify-between rounded border border-line bg-ink-800 px-3 py-2 text-left hover:border-danger"
    >
      <span className="flex items-center gap-2">
        <WalletBadge id={w.id} />
        <span className="text-sm">{w.name}</span>
        <span className="rounded bg-danger/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-danger">
          install
        </span>
      </span>
      <span aria-hidden className="text-mute group-hover:text-danger">
        ↗
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
  return (
    <div className="space-y-2">
      <div>
        <p className="px-1 font-mono text-[10px] uppercase tracking-widest text-mute">Connected</p>
        <p className="mt-1 break-all font-mono text-xs">
          <span className="text-neon">{shortenAddress(props.address, 6, 6)}</span>
          <span className="ml-2 text-[11px] text-mute">via {props.walletName}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={props.onCopy}
        className="press w-full rounded border border-line bg-ink-800 px-3 py-2 text-left font-mono text-xs text-mute hover:border-neon hover:text-neon"
      >
        Copy address
      </button>
      <LinkToWallet address={props.address} />
      <button
        type="button"
        onClick={props.onDisconnect}
        className="press w-full rounded border border-danger/40 bg-danger/5 px-3 py-2 text-left font-mono text-xs text-danger hover:bg-danger/10"
      >
        Disconnect
      </button>
    </div>
  );
}

function LinkToWallet({ address }: { address: string }) {
  return (
    <a
      href={`https://solscan.io/account/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="press block w-full rounded border border-line bg-ink-800 px-3 py-2 text-left font-mono text-xs text-mute hover:border-neon hover:text-neon"
    >
      View on Solscan ↗
    </a>
  );
}

function WalletBadge({ id }: { id: WalletId }) {
  const letter =
    id === "phantom" ? "P" : id === "solflare" ? "S" : id === "trust" ? "T" : "C";
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
      className="flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold text-white"
      style={{ background: color }}
    >
      {letter}
    </span>
  );
}
