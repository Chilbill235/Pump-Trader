"use client";

import { useEffect, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { useSettings } from "./SettingsProvider";
import { isInAppBrowser, detectInAppBrowser } from "@/lib/mobile";
import "@solana/wallet-adapter-react-ui/styles.css";

export function AppWalletProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();

  // We always register the standard Phantom and Solflare adapters. When the
  // user opens this site inside Phantom / Solflare's in-app browser, those
  // wallets speak Mobile Wallet Adapter and the wallet adapter will route
  // requests through it. The "name" the wallet-standard exposes is the same,
  // so the auto-connect + select flow works identically to desktop.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isInAppBrowser()) {
      document.body.dataset.inAppBrowser = "1";
    } else {
      delete document.body.dataset.inAppBrowser;
    }
    const info = detectInAppBrowser();
    if (info) {
      window.localStorage.setItem("pump-trader:last-inapp", info.walletName);
    }
  }, []);

  return (
    <ConnectionProvider endpoint={settings.rpcUrl}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}