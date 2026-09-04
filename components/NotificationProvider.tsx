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
          new Notification(n.title, {
            body: n.body,
            tag: n.key ?? n.id,
          });
        }
      }
    },
    [accountId, notifications, permission],
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
    if (typeof Notification === "undefined") return "denied" as NotificationPermission;
    if (Notification.permission === "granted") {
      setPermission("granted");
      return "granted";
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
      }
      return p;
    } catch {
      return "denied";
    }
  }, []);

  // Listen for service-worker messages that target this page.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const data = (e.data || {}) as { type?: string; url?: string };
      if (data.type === "pump-trader:focus" && data.url) {
        // Soft-navigate: just dispatch a hash so links don't reload.
        if (typeof data.url === "string" && data.url.startsWith("/")) {
          window.history.pushState({}, "", data.url);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
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
  if (!ctx) throw new Error("useNotifications must be used inside NotificationProvider");
  return ctx;
}