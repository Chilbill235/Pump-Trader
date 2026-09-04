"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNotifications, type Notification, type NotificationAction } from "./NotificationProvider";
import { useSettings } from "./SettingsProvider";
import { useActiveAccountId } from "./AccountsProvider";

const LEVEL_STYLES: Record<string, string> = {
  info: "border-line bg-ink-800 text-zinc-100",
  success: "border-neon/40 bg-neon/5 text-neon",
  warn: "border-warn/40 bg-warn/5 text-warn",
  danger: "border-danger/40 bg-danger/5 text-danger",
};

const CATEGORY_LABELS: Record<string, string> = {
  trade: "Trade",
  bot: "Bot",
  position: "Position",
  wallet: "Wallet",
  system: "System",
};

function ActionButton({
  action,
  onRun,
}: {
  action: NotificationAction;
  onRun: (a: NotificationAction) => void;
}) {
  const base =
    "touch-target press inline-flex items-center justify-center rounded border px-3 py-1.5 font-mono text-[11px]";
  const tone =
    action.tone === "danger"
      ? "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20"
      : action.tone === "primary"
        ? "border-neon/40 bg-neon/10 text-neon hover:bg-neon/20"
        : "border-line bg-ink-800 text-mute hover:border-neon hover:text-neon";
  if (action.href) {
    return (
      <Link
        href={action.href}
        className={`${base} ${tone}`}
        onClick={(e) => {
          e.stopPropagation();
          onRun(action);
        }}
      >
        {action.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={`${base} ${tone}`}
      onClick={(e) => {
        e.stopPropagation();
        onRun(action);
      }}
    >
      {action.label}
    </button>
  );
}

export function NotificationBell() {
  const { notifications, unread, markRead, markAllRead, clear, permission, requestPushPermission } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | "trade" | "bot" | "position" | "wallet" | "system">("all");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const settings = useSettings();
  const accountId = useActiveAccountId();
  const router = useRouter();
  void settings;
  void accountId;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (filter === "all") return notifications;
    if (filter === "unread") return notifications.filter((n) => !n.read);
    return notifications.filter((n) => n.category === filter);
  }, [notifications, filter]);

  function navigate(href: string) {
    setOpen(false);
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
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press relative flex h-9 w-9 items-center justify-center rounded-md border border-line bg-ink-800 text-mute hover:border-neon hover:text-neon focus:outline-none focus-visible:ring-2 focus-visible:ring-neon"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        title="Notifications"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M3.5 12.5V8a4.5 4.5 0 119 0v4.5l1 1H2.5l1-1z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6.5 13.5a1.5 1.5 0 003 0" strokeLinecap="round" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-danger px-1 text-center font-mono text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="fixed inset-x-2 top-[64px] z-50 max-h-[80vh] overflow-hidden rounded border border-line bg-ink-900 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1 sm:w-[420px]">
          <div className="flex items-center justify-between border-b border-line bg-ink-800 px-3 py-2">
            <p className="font-mono text-xs uppercase tracking-wide text-mute">Notifications</p>
            <div className="flex items-center gap-2">
              {permission !== "granted" ? (
                <button
                  type="button"
                  onClick={() => void requestPushPermission()}
                  className="rounded border border-neon/40 bg-neon/10 px-2 py-1 font-mono text-[11px] text-neon hover:bg-neon/20"
                >
                  Enable push
                </button>
              ) : (
                <span className="rounded border border-neon/30 bg-neon/5 px-1.5 py-0.5 font-mono text-[10px] text-neon">
                  PUSH ON
                </span>
              )}
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="rounded px-2 py-1 font-mono text-[11px] text-mute hover:text-neon"
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
                  className="rounded px-2 py-1 font-mono text-[11px] text-mute hover:text-danger"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 font-mono text-[11px] text-mute hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 border-b border-line bg-ink-800/60 px-2 py-1.5 text-[11px]">
            {(["all", "unread", "trade", "bot", "position", "wallet", "system"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded px-2 py-1 font-mono uppercase ${
                  filter === f ? "bg-ink-700 text-white" : "text-mute hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="max-h-[60vh] overflow-y-auto scroll-thin">
            {filtered.length === 0 ? (
              <p className="p-8 text-center text-xs text-mute">No notifications.</p>
            ) : (
              <ul className="divide-y divide-line">
                {filtered.map((n) => (
                  <li
                    key={n.id}
                    className={`group relative border-l-2 px-3 py-2 ${
                      n.read ? "border-transparent" : "border-neon"
                    }`}
                  >
                    <NotificationRow
                      n={n}
                      onAction={runAction}
                      onClick={() => {
                        markRead(n.id);
                        if (n.href) navigate(n.href);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press flex w-full flex-col items-stretch gap-1 rounded border p-2 text-left ${LEVEL_STYLES[n.level] ?? LEVEL_STYLES.info} ${n.read ? "opacity-70" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-mute">
          {CATEGORY_LABELS[n.category] ?? n.category} · {timeAgo(n.ts)}
        </span>
        {!n.read ? <span className="h-1.5 w-1.5 rounded-full bg-neon" /> : null}
      </div>
      <p className="text-sm font-medium">{n.title}</p>
      {n.body ? <p className="text-xs text-mute">{n.body}</p> : null}
      {n.actions && n.actions.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {n.actions.map((a) => (
            <ActionButton key={a.id} action={a} onRun={onAction} />
          ))}
        </div>
      ) : null}
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

export function ToastBanner() {
  const { toast, dismissToast, markRead } = useNotifications();
  const router = useRouter();
  useEffect(() => {
    if (!toast) return;
    markRead(toast.id);
  }, [toast, markRead]);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[64px] z-40 flex justify-center px-3 safe-top sm:top-[60px]">
      <div
        className={`pointer-events-auto w-full max-w-md rounded border p-3 shadow-2xl ${LEVEL_STYLES[toast.level] ?? LEVEL_STYLES.info} press`}
        role="status"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{toast.title}</p>
            {toast.body ? <p className="mt-0.5 text-xs text-mute">{toast.body}</p> : null}
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
            className="touch-target press rounded px-2 py-1 font-mono text-xs text-mute hover:text-white"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
