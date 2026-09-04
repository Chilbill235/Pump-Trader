"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type AppSettings,
} from "@/lib/settings";
import { useActiveAccountId } from "./AccountsProvider";
import { debouncedWrite } from "@/lib/storage";

type Ctx = {
  settings: AppSettings;
  hydrated: boolean;
  update: (patch: Partial<AppSettings>) => void;
};

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const accountId = useActiveAccountId();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setSettings(DEFAULT_SETTINGS);
      setHydrated(false);
      return;
    }
    setSettings(loadSettings(accountId));
    setHydrated(true);
  }, [accountId]);

  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      if (!accountId) return;
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        // Settings writes are very frequent (every keystroke on number fields,
        // every toggle). Debounce so we don't burn the localStorage CPU.
        debouncedWrite(`pump-trader:acct:${accountId}:settings:v1`, next);
        return next;
      });
    },
    [accountId],
  );

  const value = useMemo(
    () => ({ settings, hydrated, update }),
    [settings, hydrated, update],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (ctx) return ctx;
  // Defensive fallback: in the rare case a child is rendered outside
  // SettingsProvider (e.g. on the login screen, or before hydration), return
  // defaults rather than throwing — a thrown error here would tear down the
  // whole app. `update` is a no-op without an active account.
  return {
    settings: DEFAULT_SETTINGS,
    hydrated: false,
    update: () => undefined,
  };
}

// On unload, also persist the current settings synchronously in case the
// debounce timer is still pending.
export function flushSettingsSave(accountId: string | null, current: AppSettings) {
  if (!accountId) return;
  saveSettings(accountId, current);
}