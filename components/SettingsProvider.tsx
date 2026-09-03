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
        saveSettings(accountId, next);
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
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}