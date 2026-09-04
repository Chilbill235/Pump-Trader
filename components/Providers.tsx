"use client";

import { useEffect } from "react";
import { AccountsProvider, useAccounts } from "./AccountsProvider";
import { SettingsProvider } from "./SettingsProvider";
import { AppWalletProvider } from "./WalletProvider";
import { AppShell } from "./AppShell";
import { LoginScreen } from "./LoginScreen";
import { TpSlWatcher } from "./TpSlWatcher";
import { WalletDataProvider } from "./WalletDataProvider";
import { NotificationProvider } from "./NotificationProvider";
import { ensureSchemaMigrated, flushPendingWrites } from "@/lib/storage";
import { ErrorBoundary } from "./ErrorBoundary";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AccountsProvider>
      <Gate>{children}</Gate>
    </AccountsProvider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    ensureSchemaMigrated();
    const onBeforeUnload = () => flushPendingWrites();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  const { ready, activeId } = useAccounts();
  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 text-mute">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon border-t-transparent" />
          <span className="text-xs">Loading…</span>
        </div>
      </div>
    );
  }
  if (!activeId) return <LoginScreen />;
  return (
    <ErrorBoundary scope="root">
      <SettingsProvider>
        <AppWalletProvider>
          <WalletDataProvider>
            <NotificationProvider>
              <AppShell>
                <TpSlWatcher />
                <ErrorBoundary scope="app">{children}</ErrorBoundary>
              </AppShell>
            </NotificationProvider>
          </WalletDataProvider>
        </AppWalletProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}