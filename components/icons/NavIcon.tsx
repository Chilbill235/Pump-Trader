"use client";

import type { SVGProps } from "react";

export type NavIconName = "markets" | "watch" | "wallet" | "positions" | "bot" | "settings";

export function NavIcon({ name, className, ...rest }: { name: NavIconName } & SVGProps<SVGSVGElement>) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
  switch (name) {
    case "markets":
      // candlestick / chart
      return (
        <svg {...common} className={className}>
          <path d="M2 12l3-3 3 2 3-5 3 2" />
          <path d="M2 14h12" />
        </svg>
      );
    case "watch":
      // eye
      return (
        <svg {...common} className={className}>
          <path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common} className={className}>
          <path d="M2 5a1 1 0 011-1h9a1 1 0 011 1v1H3.5a1.5 1.5 0 000 3H14v3a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" />
          <circle cx="11" cy="8.5" r="0.7" fill="currentColor" />
        </svg>
      );
    case "positions":
      // stacked coins
      return (
        <svg {...common} className={className}>
          <ellipse cx="8" cy="4" rx="5" ry="1.5" />
          <path d="M3 4v3c0 .83 2.24 1.5 5 1.5s5-.67 5-1.5V4" />
          <path d="M3 8v3c0 .83 2.24 1.5 5 1.5s5-.67 5-1.5V8" />
        </svg>
      );
    case "bot":
      // bot head
      return (
        <svg {...common} className={className}>
          <rect x="3" y="5" width="10" height="7" rx="2" />
          <path d="M6 3v2M10 3v2" />
          <circle cx="6" cy="9" r="0.8" fill="currentColor" />
          <circle cx="10" cy="9" r="0.8" fill="currentColor" />
          <path d="M6 12v1.5M10 12v1.5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common} className={className}>
          <circle cx="8" cy="8" r="2" />
          <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M2.7 2.7l1 1M11.3 11.3l1 1M2.7 13.3l1-1M11.3 4.7l1-1" />
        </svg>
      );
  }
}
