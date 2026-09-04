"use client";

import { useEffect, useRef } from "react";
import { QuickTradePanel } from "./QuickTradePanel";
import type { WalletToken } from "@/lib/portfolio";

type HoldingLike = WalletToken & {
  name: string;
  symbol: string;
  imageUri?: string;
  source: "cache" | "lookup" | "unknown";
};

export function MobileTradeSheet(props: {
  open: boolean;
  onClose: () => void;
  mint: string | null;
  name?: string;
  symbol?: string;
  imageUri?: string;
  initialSide?: "buy" | "sell";
  holdings?: HoldingLike[];
}) {
  const { open, onClose, mint, name, symbol, imageUri, initialSide, holdings } = props;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("modal-open");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Drag-to-dismiss: simple swipe-down on the handle closes the sheet.
  function onTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0]?.clientY ?? null;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startY.current == null || !sheetRef.current) return;
    const y = e.touches[0]?.clientY ?? startY.current;
    const dy = Math.max(0, y - startY.current);
    sheetRef.current.style.transform = `translateY(${dy}px)`;
  }
  function onTouchEnd() {
    if (!sheetRef.current) return;
    const t = sheetRef.current.style.transform;
    sheetRef.current.style.transform = "";
    if (t && parseInt(t.replace(/[^\d]/g, ""), 10) > 120) onClose();
    startY.current = null;
  }

  if (!open || !mint) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-ink-950/85 backdrop-blur-sm sm:hidden"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className="flex w-full max-w-md flex-col rounded-t-2xl border border-line glass-strong shadow-2xl transition-transform"
        style={{
          maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b border-line-soft bg-ink-850/80 px-4 py-3 backdrop-blur"
          style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              className="block h-1 w-10 rounded-full bg-ink-700"
            />
            <p className="font-mono text-[10px] uppercase tracking-widest text-mute">Trade</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="press flex items-center gap-1 rounded-md border border-line bg-ink-800 px-2.5 py-1.5 font-mono text-xs text-mute hover:border-danger hover:text-danger"
            aria-label="Close trade sheet"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M2 2l6 6M8 2l-6 6" strokeLinecap="round" />
            </svg>
            Close
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto p-3 scroll-thin"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <QuickTradePanel
            mint={mint}
            name={name}
            symbol={symbol}
            imageUri={imageUri}
            initialSide={initialSide}
            onClose={onClose}
            holdings={holdings}
          />
        </div>
      </div>
    </div>
  );
}
