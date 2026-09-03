"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  bumpIdleTimer,
  getActiveAccountId,
  isAccountsCapable,
  listAccounts,
  lockAccount,
  registerIdleLockHandler,
  removeAccount as removeStoredAccount,
  createAccount as createStoredAccount,
  unlockAccount,
  type AccountSummary,
} from "@/lib/accounts";

type AccountsContext = {
  ready: boolean;
  capable: boolean;
  activeId: string | null;
  activeAccount: AccountSummary | null;
  accounts: AccountSummary[];
  create: (args: { username: string; pin: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  unlock: (args: { accountId: string; pin: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  switchTo: (accountId: string) => void;
  lock: () => void;
  remove: (accountId: string) => void;
};

const AccountsContext = createContext<AccountsContext | null>(null);

export function AccountsProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [capable, setCapable] = useState(false);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setCapable(isAccountsCapable());
    setAccounts(listAccounts());
    setActiveId(getActiveAccountId());
    setHydrated(true);
  }, []);

  const refresh = useCallback(() => {
    setAccounts(listAccounts());
    setActiveId(getActiveAccountId());
  }, []);

  const create = useCallback<AccountsContext["create"]>(async ({ username, pin }) => {
    const r = await createStoredAccount({ username, pin });
    if ("error" in r) return { ok: false, error: r.error };
    refresh();
    return { ok: true };
  }, [refresh]);

  const unlock = useCallback<AccountsContext["unlock"]>(async ({ accountId, pin }) => {
    const r = await unlockAccount({ accountId, pin });
    if ("error" in r) return { ok: false, error: r.error };
    refresh();
    return { ok: true };
  }, [refresh]);

  const switchTo = useCallback((accountId: string) => {
    // Lock first so we don't carry the previous vault key into a different account.
    // Disable auto-trade for the previous account as well — switching means the
    // owner is no longer actively monitoring that account's bot.
    if (typeof window !== "undefined" && activeId && activeId !== accountId) {
      try {
        const key = `pump-trader:acct:${activeId}:settings:v1`;
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        window.localStorage.setItem(
          key,
          JSON.stringify({
            ...parsed,
            autoTrade: false,
            autoSell: false,
            pipelineEnabled: parsed.pipelineEnabled,
          }),
        );
      } catch {
        // ignore
      }
    }
    lockAccount();
    setActiveId(accountId);
  }, [activeId]);

  const lock = useCallback(() => {
    // Disable auto-trade / auto-sell for this account before locking so the bot
    // can't keep running unattended while the device owner is away.
    if (typeof window !== "undefined" && activeId) {
      try {
        const key = `pump-trader:acct:${activeId}:settings:v1`;
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        window.localStorage.setItem(
          key,
          JSON.stringify({
            ...parsed,
            autoTrade: false,
            autoSell: false,
            pipelineEnabled: parsed.pipelineEnabled,
          }),
        );
      } catch {
        // ignore
      }
    }
    lockAccount();
    setActiveId(null);
  }, [activeId]);

  const remove = useCallback((accountId: string) => {
    removeStoredAccount(accountId);
    refresh();
  }, [refresh]);

  useEffect(() => {
    const off = registerIdleLockHandler(() => {
      setActiveId(null);
    });
    return off;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !activeId) return;
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    const bump = () => bumpIdleTimer();
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    bump();
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, [activeId]);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeId) ?? null,
    [accounts, activeId],
  );

  const value = useMemo<AccountsContext>(
    () => ({
      ready: hydrated,
      capable,
      activeId,
      activeAccount,
      accounts,
      create,
      unlock,
      switchTo,
      lock,
      remove,
    }),
    [hydrated, capable, activeId, activeAccount, accounts, create, unlock, switchTo, lock, remove],
  );

  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
}

export function useAccounts(): AccountsContext {
  const ctx = useContext(AccountsContext);
  if (!ctx) throw new Error("useAccounts must be used inside AccountsProvider");
  return ctx;
}

/**
 * Tiny hook for components that need to know the active account id (for scoped
 * localStorage reads). Returns null when logged out.
 */
export function useActiveAccountId(): string | null {
  const { activeId } = useAccounts();
  return activeId;
}