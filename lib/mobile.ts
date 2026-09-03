/**
 * Mobile helpers.
 *
 * - detectInAppBrowser: returns which mobile wallet's in-app browser the user
 *   opened the page in, if any. Used to show a "you're already connected"
 *   banner instead of the usual "select wallet" flow.
 * - isInAppBrowser: shorthand.
 * - deepLinkOpen: builds a universal link to the listed mobile wallets so the
 *   user can open this dapp from plain iOS / Android Safari. Phantom / Solflare
 *   both re-open the URL with the same path/query so the user lands back here
 *   after approving the connection.
 * - isMobileDevice: coarse device detection so we can hide the desktop "use
 *   the extension" hint on phones.
 */

export type InAppInfo = {
  walletName: "Phantom" | "Solflare" | "Trust Wallet" | "Coinbase" | "Other";
  raw: string;
};

const UA_HINTS: Array<[RegExp, InAppInfo["walletName"]]> = [
  [/Phantom/i, "Phantom"],
  [/Solflare/i, "Solflare"],
  [/Trust\s?Wallet/i, "Trust Wallet"],
  [/Coinbase\s?Wallet/i, "Coinbase"],
];

export function detectInAppBrowser(uaSource?: string): InAppInfo | null {
  if (typeof navigator === "undefined") return null;
  const ua = uaSource ?? navigator.userAgent ?? navigator.vendor ?? "";
  if (!ua) return null;
  for (const [re, name] of UA_HINTS) {
    if (re.test(ua)) {
      return { walletName: name, raw: ua };
    }
  }
  return null;
}

export function isInAppBrowser(): boolean {
  return detectInAppBrowser() != null;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  // Tablets count as mobile for layout, even though they have desktop browsers.
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile Safari/i.test(ua);
}

const DEEP_LINKS: Record<string, (url: string) => string> = {
  Phantom: (url) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}`,
  Solflare: (url) => `https://solflare.com/ul/browse/${encodeURIComponent(url)}`,
  "Trust Wallet": (url) => `https://link.trustwallet.com/open_url?coin_id=20000114&url=${encodeURIComponent(url)}`,
  "Coinbase": (url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
};

export function deepLinkOpen(walletName: keyof typeof DEEP_LINKS): string {
  if (typeof window === "undefined") return "#";
  const url = window.location.href;
  const builder = DEEP_LINKS[walletName];
  return builder ? builder(url) : url;
}

export const SUPPORTED_MOBILE_WALLETS: Array<keyof typeof DEEP_LINKS> = [
  "Phantom",
  "Solflare",
  "Trust Wallet",
  "Coinbase",
];

/**
 * iOS Safari does not auto-handle universal links in the same way Android
 * Chrome does. We provide a tiny `openUniversal` helper that creates a hidden
 * anchor with rel="noopener noreferrer" and triggers it. The caller is
 * expected to also show an "if nothing happens, copy the link" fallback for
 * the small percentage of cases where the universal link fails silently.
 */
export function openUniversal(href: string): void {
  if (typeof window === "undefined") return;
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}