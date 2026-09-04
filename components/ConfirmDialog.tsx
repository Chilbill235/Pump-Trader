"use client";

import { useEffect, useId, useRef } from "react";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => cancelRef.current?.focus(), 0);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        const root = document.getElementById(titleId)?.closest("[role=dialog]") as HTMLElement | null;
        if (!root) return;
        const focusable = root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onCancel, titleId]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-stretch justify-center overflow-hidden bg-ink-950/85 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="pointer-events-auto flex w-full max-w-md flex-col overflow-hidden rounded-t-xl border border-line glass-strong shadow-2xl sm:rounded-xl"
        style={{
          maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
          height: "auto",
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line-soft bg-ink-850/80 px-4 py-3 backdrop-blur">
          <h2 id={titleId} className="font-mono text-base font-semibold tracking-wide text-white">
            {title}
          </h2>
          <button
            type="button"
            className="press shrink-0 rounded-md border border-line bg-ink-800 p-1.5 text-mute hover:border-danger hover:text-danger"
            onClick={onCancel}
            aria-label="Close"
            disabled={busy}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm text-mute scroll-thin"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {body}
        </div>
        <div
          className="flex shrink-0 flex-col gap-2 border-t border-line-soft bg-ink-850/80 px-4 py-3 sm:flex-row sm:justify-end sm:gap-2"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <button
            ref={cancelRef}
            type="button"
            className="press order-2 min-h-[44px] w-full rounded-md border border-line bg-ink-800 px-4 py-2.5 text-sm text-mute focus:outline-none focus-visible:ring-2 focus-visible:ring-neon sm:order-1 sm:min-h-0 sm:w-auto sm:px-3 sm:py-1.5"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`press order-1 min-h-[44px] w-full rounded-md px-4 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 sm:order-2 sm:min-h-0 sm:w-auto sm:px-3 sm:py-1.5 ${
              danger
                ? "border border-danger/50 bg-gradient-to-r from-danger to-rose-400 text-white focus-visible:ring-danger"
                : "border border-neon/50 bg-gradient-to-r from-neon to-emerald-400 text-ink-950 focus-visible:ring-neon"
            }`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
