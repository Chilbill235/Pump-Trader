"use client";

import { useEffect } from "react";
import { QuickTradePanel } from "./QuickTradePanel";
import type { WalletToken } from "@/lib/portfolio";

type HoldingLike = WalletToken & {
  name: string;
  symbol: string;
  imageUri?: string;
  source: "cache" | "lookup" | "unknown";
};

/**
 * Mobile trade bottom sheet.
 *
 * On mobile the QuickTradePanel needs to pop up over the markets list so the
 * user can see and tap it without scrolling. On desktop we still render the
 * panel inline (lg+ breakpoint). This sheet handles the mobile case: a
 * full-height bottom sheet that slides up when the user picks a coin.
 */
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
  useEffect(() => {
    if (!props.open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [props.open]);

  if (!props.open || !props.mint) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 sm:hidden"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-t-2xl border border-line bg-ink-900 shadow-2xl"
        style={{
          maxHeight:
            "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b border-line/60 px-4 py-3"
          style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
        >
          <p className="font-mono text-xs uppercase tracking-wide text-mute">
            Trade
          </p>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded border border-line px-3 py-1.5 font-mono text-xs text-mute"
            aria-label="Close trade sheet"
          >
            ✕ Close
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto p-3 scroll-thin"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <QuickTradePanel
            mint={props.mint}
            name={props.name}
            symbol={props.symbol}
            imageUri={props.imageUri}
            initialSide={props.initialSide}
            onClose={props.onClose}
            holdings={props.holdings}
          />
        </div>
      </div>
    </div>
  );
}
