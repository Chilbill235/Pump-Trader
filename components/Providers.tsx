"use client";

import { SettingsProvider } from "./SettingsProvider";
import { AppWalletProvider } from "./WalletProvider";
import { AppShell } from "./AppShell";
import { TpSlWatcher } from "./TpSlWatcher";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <AppWalletProvider>
        <AppShell>
          <TpSlWatcher />
          {children}
        </AppShell>
      </AppWalletProvider>
    </SettingsProvider>
  );
}
