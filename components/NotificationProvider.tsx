"use client";

/**
 * In-app notification system.
 *
 * Goals:
 *  - Persistent log of alerts per account (survives reload via localStorage)
 *  - Toast-style banner with action buttons (e.g. "Stop bot", "View")
 *  - OS push notifications (when the page is hidden)
 *  - Service-worker driven "background" push when the app is closed
 *  - Notification Center panel with grouping, mark-read, and bulk actions
 *
 * Notifications are dispatched via the bus (notify*). Anything in the app can
 * subscribe through the provider context.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSettings } from "./SettingsProvider";

export type NotificationLevel = "info" | "success" | "warn" | "danger";
export type NotificationCategory =
  | "trade"
  | "bot"
  | "position"
  | "wallet"
  | "system";

export type NotificationAction = {
  id: string;
  label: string;
  /** Optional URL to navigate to when the action is clicked. */
  href?: string;
  /** Optional client-side handler key. Resolved by the renderer. */
  handler?: "stop-bot" | "open-positions" | "open-watch" | "open-wallet" | "dismiss";
  /** Style hint. */
  tone?: "default" | "primary" | "danger";
};

export type Notification = {
  id: string;
  /** Stable id used for dedup. Usually `${kind}:${mint}`. */
  key?: string;
  title: string;
  body?: string;
  level: NotificationLevel;
  category: NotificationCategory;
  href?: string;
  actions?: NotificationAction[];
  ts: number;
  read: boolean;
  /** Persisted across reloads (e.g. closed trades). */
  persistent?: boolean;
  /** Send an OS push when the tab is hidden. Default true. */
  push?: boolean;
};

const NOTIF_KEY = "notifications:v1";
const MAX_PERSISTED = 50;

type BusListener = (n: Notification) => void;
const listeners = new Set<BusListener>();

export function notify(n: Omit<Notification, "id" | "ts" | "read"> & { id?: string; ts?: number }) {
  const note: Notification = {
    id: n.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: n.ts ?? Date.now(),
    read: false,
    level: n.level,
    category: n.category,
    title: n.title,
    body: n.body,
    href: n.href,
    actions: n.actions,
    key: n.key,
    persistent: n.persistent,
    push: n.push,
  };
  for (const l of listeners) l(note);
  return note;
}

type Ctx = {
  notifications: Notification[];
  unread: number;
  toast: Notification | null;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
  dismissToast: () => void;
  permission: NotificationPermission;
  requestPushPermission: () => Promise<NotificationPermission>;
};

const NotificationContext = createContext<Ctx | null>(null);

function load(accountId: string | null): Notification[] {
  if (typeof window === "undefined" || !accountId) return [];
  try {
    const raw = window.localStorage.getItem(`pump-trader:acct:${accountId}:${NOTIF_KEY}`);
    if (!raw) return [];
    return JSON.parse(raw) as Notification[];
  } catch {
    return [];
  }
}

function save(accountId: string | null, list: Notification[]) {
  if (typeof window === "undefined" || !accountId) return;
  try {
    const persistent = list.filter((n) => n.persistent).slice(0, MAX_PERSISTED);
    window.localStorage.setItem(
      `pump-trader:acct:${accountId}:${NOTIF_KEY}`,
      JSON.stringify(persistent),
    );
  } catch {
    // ignore
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toast, setToast] = useState<Notification | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default",
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pick up the active account from a custom event we dispatch from
  // AccountsProvider. (Avoiding a hard import cycle.)
  useEffect(() => {
    const onAccount = (e: Event) => {
      const id = (e as CustomEvent<{ id: string | null }>).detail?.id ?? null;
      setAccountId(id);
      if (id) setNotifications(load(id));
      else setNotifications([]);
    };
    window.addEventListener("pump-trader:account", onAccount as EventListener);
    return () => window.removeEventListener("pump-trader:account", onAccount as EventListener);
  }, []);

  const onNotification = useCallback(
    (n: Notification) => {
      // Dedupe by `key` (e.g. don't show the same TP alert twice in a row).
      if (n.key) {
        const dup = notifications.find((x) => x.key === n.key && Date.now() - x.ts < 60_000);
        if (dup) return;
      }
      setNotifications((prev) => {
        const next = [n, ...prev].slice(0, 80);
        save(accountId, next);
        return next;
      });
      // Always show a toast.
      setToast(n);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast((t) => (t === n ? null : t)), 8_000);

      // OS push when the tab is hidden (or on mobile when the app is in the
      // background via the service worker).
      if (n.push !== false && typeof Notification !== "undefined" && permission === "granted") {
        const isHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
        if (isHidden && "serviceWorker" in navigator) {
          navigator.serviceWorker.ready
            .then((reg) =>
              reg.showNotification(n.title, {
                body: n.body,
                icon: "/icons/icon-192.svg",
                badge: "/icons/favicon.svg",
                tag: n.key ?? n.id,
                data: { url: n.href ?? "/", ...(n.actions ? { actions: n.actions } : {}) },
              }),
            )
            .catch(() => undefined);
        } else if (isHidden) {
          // Fallback: in-page notification if SW isn't ready.
          try {
            new Notification(n.title, {
              body: n.body,
              tag: n.key ?? n.id,
            });
          } catch { /* ignore */ }
        }
      }
      // Haptic / audio feedback for in-app toasts when the page is visible.
      if (settings.notificationSound && typeof document !== "undefined" && document.visibilityState === "visible") {
        try {
          if ("vibrate" in navigator) {
            (navigator as unknown as { vibrate: (pattern: number | number[]) => void }).vibrate(
              n.level === "danger" ? [200, 100, 200] : n.level === "warn" ? [100, 50, 100] : 50,
            );
          }
        } catch { /* ignore */ }
      }
    },
    [accountId, notifications, permission, settings?.notificationSound],
  );

  useEffect(() => {
    listeners.add(onNotification);
    return () => {
      listeners.delete(onNotification);
    };
  }, [onNotification]);

  const markRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
        save(accountId, next);
        return next;
      });
    },
    [accountId],
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      save(accountId, next);
      return next;
    });
  }, [accountId]);

  const clear = useCallback(() => {
    setNotifications([]);
    save(accountId, []);
  }, [accountId]);

  const dismissToast = useCallback(() => {
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const requestPushPermission = useCallback(async () => {
    if (typeof window === "undefined") return "denied" as NotificationPermission;
    const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (typeof Notification === "undefined") {
      // iOS Safari (in-browser) has no Notification API at all; only the
      // installed Home-Screen PWA (iOS 16.4+) supports web push.
      notify({
        level: "warn",
        category: "system",
        title: isIOS ? "Push needs the installed app" : "Push not supported",
        body: isIOS
          ? "Tap Share → “Add to Home Screen”, open Pump Trader from there, then enable push."
          : "This browser doesn't support web notifications. Try Chrome, Edge, or Firefox.",
      });
      return "denied" as NotificationPermission;
    }
    if (Notification.permission === "granted") {
      setPermission("granted");
      return "granted";
    }
    if (isIOS && !standalone) {
      notify({
        level: "warn",
        category: "system",
        title: "Add to Home Screen first",
        body: "iPhone allows push only inside the installed app: Share → “Add to Home Screen”, then enable push from there.",
      });
      return "denied" as NotificationPermission;
    }
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
      // Show a test notification so the user can confirm it works.
      if (p === "granted" && "serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification("Pump Trader", {
          body: "Notifications are on. You'll hear about TP/SL hits, bot events, and trade confirmations.",
          icon: "/icons/icon-192.svg",
          badge: "/icons/favicon.svg",
        });
      } else if (p === "denied") {
        notify({
          level: "info",
          category: "system",
          title: "Push blocked",
          body: "You can re-enable notifications in your browser site settings.",
        });
      }
      return p;
    } catch {
      return "denied" as NotificationPermission;
    }
  }, []);

  // Periodic notifications: balance updates, TP/SL, bot status, daily summary.
  useEffect(() => {
    if (!accountId) return;
    const KEY = `pump-trader:acct:${accountId}:notif-state`;
    let cancelled = false;
    const loadState = () => {
      try {
        const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
        return raw ? JSON.parse(raw) : { lastBalance: null, lastEquity: null, lastBotStatus: null, lastNotifTs: 0, lastSummaryDate: null };
      } catch {
        return { lastBalance: null, lastEquity: null, lastBotStatus: null, lastNotifTs: 0, lastSummaryDate: null };
      }
    };
    const saveState = (s: Record<string, unknown>) => {
      try {
        if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(s));
      } catch { /* ignore */ }
    };
    const state = loadState();
    const tick = async () => {
      if (cancelled) return;
      const now = Date.now();
      if (now - (state.lastNotifTs ?? 0) < 60_000) return; // throttle to 1/min
      try {
        // Daily summary notification at ~9 AM local time
        const today = new Date().toDateString();
        if (state.lastSummaryDate !== today && new Date().getHours() === 9) {
          const closedRaw = typeof window !== "undefined"
            ? window.localStorage.getItem(`pump-trader:acct:${accountId}:closed-trades:v1`)
            : null;
          let tradesToday = 0;
          let pnlToday = 0;
          if (closedRaw) {
            try {
              const trades = JSON.parse(closedRaw);
              const dayStart = new Date().setHours(0, 0, 0, 0);
              trades.forEach((t: { ts: number; pnlSol: number }) => {
                if (t.ts >= dayStart) {
                  tradesToday++;
                  pnlToday += t.pnlSol;
                }
              });
            } catch { /* ignore */ }
          }
          notify({
            key: `daily-summary-${today}`,
            title: "Daily Summary",
            body: `${tradesToday} trades today · P&L: ${pnlToday >= 0 ? "+" : ""}${pnlToday.toFixed(4)} SOL`,
            level: "info",
            category: "bot",
            persistent: true,
          });
          state.lastSummaryDate = today;
        }
        // Bot status check
        const sessionRaw = typeof window !== "undefined"
          ? window.localStorage.getItem(`pump-trader:acct:${accountId}:bot-session:v1`)
          : null;
        const session = sessionRaw ? JSON.parse(sessionRaw) : null;
        const botActive = !!session;
        if (state.lastBotStatus === false && botActive) {
          notify({
            key: "bot-started",
            title: "Bot started",
            body: `Auto-trade bot is now running ${session?.simulate ? "(simulate)" : "(live)"}.`,
            level: "success",
            category: "bot",
            persistent: true,
          });
        } else if (state.lastBotStatus === true && !botActive) {
          notify({
            key: "bot-stopped",
            title: "Bot stopped",
            body: "Auto-trade bot is no longer running.",
            level: "info",
            category: "bot",
            persistent: true,
          });
        }
        state.lastBotStatus = botActive;
        // Wallet balance check
        const balanceRaw = typeof window !== "undefined"
          ? window.localStorage.getItem(`pump-trader:acct:${accountId}:wallet-data:v1`)
          : null;
        if (balanceRaw) {
          try {
            const data = JSON.parse(balanceRaw);
            const solBalance = data?.sol ?? null;
            if (solBalance != null && state.lastBalance != null && solBalance < state.lastBalance * 0.5) {
              notify({
                key: "balance-low",
                title: "Low balance",
                body: `Wallet balance dropped to ${solBalance.toFixed(4)} SOL. Top up to keep trading.`,
                level: "warn",
                category: "wallet",
                persistent: false,
              });
            }
            state.lastBalance = solBalance;
          } catch { /* ignore */ }
        }
        // Equity / PnL check
        const equityCurveRaw = typeof window !== "undefined"
          ? window.localStorage.getItem(`pump-trader:acct:${accountId}:equity:v1`)
          : null;
        if (equityCurveRaw) {
          try {
            const curve = JSON.parse(equityCurveRaw);
            if (curve.length > 0) {
              const latest = curve[curve.length - 1];
              const equitySol = latest?.equitySol ?? null;
              if (equitySol != null && state.lastEquity != null && equitySol < state.lastEquity * 0.7) {
                notify({
                  key: "equity-drop",
                  title: "Equity dropped",
                  body: `Portfolio equity fell to ${equitySol.toFixed(4)} SOL. Review positions.`,
                  level: "danger",
                  category: "position",
                  persistent: true,
                });
              }
              state.lastEquity = equitySol;
            }
          } catch { /* ignore */ }
        }
        state.lastNotifTs = now;
        saveState(state);
      } catch { /* ignore */ }
    };
    void tick();
    const id = setInterval(tick, 120_000); // every 2 minutes
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [accountId]);
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const data = (e.data || {}) as { type?: string; url?: string };
      if (data.type === "pump-trader:focus" && data.url) {
        if (typeof data.url === "string" && data.url.startsWith("/")) {
          window.history.pushState({}, "", data.url);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // Listen for in-app notifications dispatched via custom events.
  useEffect(() => {
    const onNotif = (e: Event) => {
      const detail = (e as CustomEvent<{
        key?: string;
        title: string;
        body?: string;
        level: "info" | "success" | "warn" | "danger";
        category: NotificationCategory;
        persistent?: boolean;
        push?: boolean;
      }>).detail;
      if (!detail?.title) return;
      notify({
        key: detail.key,
        title: detail.title,
        body: detail.body,
        level: detail.level,
        category: detail.category,
        persistent: detail.persistent,
        push: detail.push,
      });
    };
    window.addEventListener("pump-trader:notification", onNotif as EventListener);
    return () => window.removeEventListener("pump-trader:notification", onNotif as EventListener);
  }, []);

  const unread = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const value = useMemo<Ctx>(
    () => ({
      notifications,
      unread,
      toast,
      markRead,
      markAllRead,
      clear,
      dismissToast,
      permission,
      requestPushPermission,
    }),
    [notifications, unread, toast, markRead, markAllRead, clear, dismissToast, permission, requestPushPermission],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): Ctx {
  const ctx = useContext(NotificationContext);
  if (ctx) return ctx;
  // Defensive fallback so a stray caller doesn't tear down the app.
  return {
    notifications: [],
    unread: 0,
    toast: null,
    markRead: () => undefined,
    markAllRead: () => undefined,
    clear: () => undefined,
    dismissToast: () => undefined,
    permission: typeof Notification !== "undefined" ? Notification.permission : "default",
    requestPushPermission: async () =>
      typeof Notification !== "undefined" ? Notification.permission : ("denied" as NotificationPermission),
  };
}