"use client";

import { AccountsProvider, useAccounts } from "./AccountsProvider";
import { SettingsProvider } from "./SettingsProvider";
import { AppWalletProvider } from "./WalletProvider";
import { AppShell } from "./AppShell";
import { LoginScreen } from "./LoginScreen";
import { TpSlWatcher } from "./TpSlWatcher";
import { WalletDataProvider } from "./WalletDataProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AccountsProvider>
      <Gate>{children}</Gate>
    </AccountsProvider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { ready, activeId } = useAccounts();
  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 text-mute">
        Loading…
      </div>
    );
  }
  if (!activeId) return <LoginScreen />;
  return (
    <SettingsProvider>
      <AppWalletProvider>
        <WalletDataProvider>
          <AppShell>
            <TpSlWatcher />
            {children}
          </AppShell>
        </WalletDataProvider>
      </AppWalletProvider>
    </SettingsProvider>
  );
}