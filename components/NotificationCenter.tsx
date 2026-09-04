"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useActiveAccountId } from "./AccountsProvider";
import { useSettings } from "./SettingsProvider";
import { useNotifications } from "./NotificationProvider";
import type { Notification, NotificationAction } from "./NotificationProvider";

const LEVEL_STYLES: Record<string, string> = {
  info: "border-info/30 bg-info/5 text-info",
  success: "border-neon/30 bg-neon/5 text-neon",
  warn: "border-warn/30 bg-warn/5 text-warn",
  danger: "border-danger/30 bg-danger/5 text-danger",
};

const CATEGORY_LABELS: Record<string, string> = {
  trade: "Trade",
  bot: "Bot",
  position: "Position",
  wallet: "Wallet",
  system: "System",
};

const CATEGORY_FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "trade", label: "Trades" },
  { id: "bot", label: "Bot" },
  { id: "position", label: "Positions" },
  { id: "wallet", label: "Wallet" },
  { id: "system", label: "System" },
] as const;

type Filter = (typeof CATEGORY_FILTERS)[number]["id"];

function ActionButton({ action, onRun }: { action: NotificationAction; onRun: (a: NotificationAction) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRun(action);
      }}
      className={`press rounded border px-2 py-0.5 font-mono text-[10px] ${
        action.tone === "danger"
          ? "border-danger/40 text-danger hover:bg-danger/10"
          : action.tone === "primary"
            ? "border-neon/40 text-neon hover:bg-neon/10"
            : "border-line text-mute hover:bg-ink-800 hover:text-white"
      }`}
    >
      {action.label}
    </button>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function NotificationBell({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { unread } = useNotifications();
  return (
    <button
      type="button"
      onClick={() => onOpenChange(!open)}
      className="press relative flex h-9 w-9 items-center justify-center rounded-md border border-line bg-ink-800 text-mute hover:border-neon hover:text-neon focus:outline-none focus-visible:ring-2 focus-visible:ring-neon"
      aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
      title="Notifications"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden
      >
        <path
          d="M3.5 12.5V8a4.5 4.5 0 119 0v4.5l1 1H2.5l1-1z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M6.5 13.5a1.5 1.5 0 003 0" strokeLinecap="round" />
      </svg>
      {unread > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 font-mono text-[10px] font-bold leading-none text-white shadow-[0_0_8px_rgba(239,68,68,0.6)]">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </button>
  );
}

export function NotificationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notifications, unread, markRead, markAllRead, clear, permission, requestPushPermission } =
    useNotifications();
  const [filter, setFilter] = useState<Filter>("all");
  const settings = useSettings();
  const accountId = useActiveAccountId();
  const router = useRouter();
  void settings;
  void accountId;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (filter === "all") return notifications;
    if (filter === "unread") return notifications.filter((n) => !n.read);
    return notifications.filter((n) => n.category === filter);
  }, [notifications, filter]);

  function navigate(href: string) {
    onClose();
    router.push(href);
  }

  function runAction(a: NotificationAction) {
    if (a.handler === "stop-bot") {
      window.dispatchEvent(new CustomEvent("pump-trader:action", { detail: { type: "stop-bot" } }));
    } else if (a.handler === "open-positions") {
      navigate("/positions");
      return;
    } else if (a.handler === "open-watch") {
      navigate("/watch");
      return;
    } else if (a.handler === "open-wallet") {
      navigate("/wallet");
      return;
    } else if (a.href) {
      navigate(a.href);
      return;
    }
    onClose();
  }

  if (!open) return null;
  return (
    <div
      className="fade-in fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close notifications"
      />
      <aside className="slide-in-right absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-line bg-ink-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-line bg-ink-850 px-4 py-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-mute">Activity</p>
            <p className="font-mono text-sm">
              {unread > 0 ? `${unread} unread` : "All caught up"}
              <span className="ml-2 text-mute-2">· {notifications.length} total</span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            {permission !== "granted" ? (
              <button
                type="button"
                onClick={() => void requestPushPermission()}
                className="press rounded border border-neon/40 bg-neon/10 px-2 py-1 font-mono text-[10px] text-neon hover:bg-neon/20"
              >
                Enable push
              </button>
            ) : (
              <span className="rounded border border-neon/30 bg-neon/5 px-1.5 py-0.5 font-mono text-[10px] text-neon">
                PUSH ON
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="press flex h-8 w-8 items-center justify-center rounded-md border border-line bg-ink-800 text-mute hover:border-neon hover:text-neon"
              aria-label="Close"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <path d="M2 2l8 8M10 2L2 10" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>
        <div className="flex flex-wrap gap-1 border-b border-line bg-ink-850/60 px-2 py-2">
          {CATEGORY_FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`press rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide ${
                  active
                    ? "bg-neon/15 text-neon shadow-[inset_0_0_0_1px_rgba(57,255,136,0.3)]"
                    : "text-mute hover:bg-ink-800 hover:text-white"
                }`}
              >
                {f.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-1">
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="press rounded-md px-2 py-1 font-mono text-[10px] text-mute hover:text-neon"
              >
                Mark all read
              </button>
            ) : null}
            {notifications.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Clear all notifications?")) clear();
                }}
                className="press rounded-md px-2 py-1 font-mono text-[10px] text-mute hover:text-danger"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-ink-850 text-mute">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M3.5 16V9a6.5 6.5 0 0113 0v7l1.5 1.5H2L3.5 16z" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M8 17a2 2 0 004 0" strokeLinecap="round" />
                </svg>
              </div>
              <p className="mt-3 font-mono text-sm text-mute">No notifications</p>
              <p className="mt-1 text-[11px] text-mute-2">
                Trade events, TP/SL hits, and bot logs show up here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line/60">
              {filtered.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  onAction={runAction}
                  onClick={() => {
                    markRead(n.id);
                    if (n.href) navigate(n.href);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function NotificationRow({
  n,
  onAction,
  onClick,
}: {
  n: Notification;
  onAction: (a: NotificationAction) => void;
  onClick: () => void;
}) {
  const dotColor =
    n.level === "success"
      ? "bg-neon"
      : n.level === "warn"
        ? "bg-warn"
        : n.level === "danger"
          ? "bg-danger"
          : "bg-info";
  return (
    <li className={`relative ${n.read ? "opacity-60" : ""}`}>
      {!n.read ? (
        <span
          aria-hidden
          className={`absolute left-2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${dotColor}`}
        />
      ) : null}
      <button
        type="button"
        onClick={onClick}
        className="press flex w-full flex-col items-stretch gap-1 border-l-2 border-transparent px-4 py-2.5 text-left hover:bg-ink-850/60"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-mute">
            {CATEGORY_LABELS[n.category] ?? n.category} · {timeAgo(n.ts)}
          </span>
        </div>
        <p className="pl-1 text-sm font-medium">{n.title}</p>
        {n.body ? <p className="pl-1 text-xs text-mute">{n.body}</p> : null}
        {n.actions && n.actions.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1 pl-1">
            {n.actions.map((a) => (
              <ActionButton key={a.id} action={a} onRun={onAction} />
            ))}
          </div>
        ) : null}
      </button>
    </li>
  );
}

export function ToastBanner() {
  const { toast, dismissToast, markRead } = useNotifications();
  const router = useRouter();
  useEffect(() => {
    if (!toast) return;
    markRead(toast.id);
  }, [toast, markRead]);
  if (!toast) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 safe-top"
      style={{ top: "calc(env(safe-area-inset-top) + 4.25rem)" }}
    >
      <div
        className={`pop-in pointer-events-auto w-full max-w-md overflow-hidden rounded-xl border p-3 shadow-2xl backdrop-blur ${LEVEL_STYLES[toast.level] ?? LEVEL_STYLES.info}`}
        role="status"
      >
        <div aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-current opacity-30" />
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{toast.title}</p>
            {toast.body ? <p className="mt-0.5 text-xs opacity-80">{toast.body}</p> : null}
            {toast.actions && toast.actions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {toast.actions.map((a) => (
                  <ActionButton
                    key={a.id}
                    action={a}
                    onRun={() => {
                      if (a.href) router.push(a.href);
                      if (a.handler === "stop-bot") {
                        window.dispatchEvent(
                          new CustomEvent("pump-trader:action", { detail: { type: "stop-bot" } }),
                        );
                      }
                      dismissToast();
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={dismissToast}
            className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-current/30 opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M2 2l6 6M8 2L2 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
