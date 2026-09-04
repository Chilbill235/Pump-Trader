"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import { useSettings } from "./SettingsProvider";
import { WindowWalletAdapter } from "@/lib/wallets/window-wallet";

/**
 * We build a WindowWalletAdapter per supported brand (Phantom, Solflare,
 * Trust, Coinbase). They are real `BaseSignerWalletAdapter` instances, so
 * the wallet-adapter-react context (useWallet, signTransaction,
 * sendTransaction, etc.) works uniformly for every view in the app.
 *
 * This avoids both:
 *   - The "registered as a Standard Wallet" warning you get when you stack
 *     the Wallet Standard adapter on top of an already-registered Standard
 *     wallet, and
 *   - The "wallet disconnected / null publicKey" race that happens when
 *     components read `useWallet().publicKey` while the picker is calling
 *     `window.solana.connect()` directly.
 */
export function AppWalletProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const wallets = useMemo(
    () => [
      new WindowWalletAdapter("Phantom"),
      new WindowWalletAdapter("Solflare"),
      new WindowWalletAdapter("Trust Wallet"),
      new WindowWalletAdapter("Coinbase Wallet"),
    ],
    [],
  );
  return (
    <ConnectionProvider endpoint={settings.rpcUrl}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}