"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { useSettings } from "./SettingsProvider";

// Phantom and Solflare now self-register through the Wallet Standard
// (`window.solana` / `window.solflare` expose a Standard Wallet). Explicitly
// importing their adapters causes the "registered as a Standard Wallet" warning
// and duplicate connect prompts. The ConnectWalletButton talks to those
// providers directly; the WalletProvider just hosts the connection context.
export function AppWalletProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();

  return (
    <ConnectionProvider endpoint={settings.rpcUrl}>
      <WalletProvider wallets={[]} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}