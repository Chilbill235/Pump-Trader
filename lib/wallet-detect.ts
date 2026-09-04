export type WalletId = "phantom" | "solflare" | "trust" | "coinbase";

export type DetectedWallet = {
  id: WalletId;
  name: string;
  installed: boolean;
  inApp: boolean;
  deeplink: string | null;
  installUrl: string;
  source?: "window" | "ua";
};

declare global {
  interface Window {
    solana?: { isPhantom?: boolean };
    solflare?: { isSolflare?: boolean };
    trustwallet?: unknown;
    coinbaseSolana?: unknown;
  }
}

const INSTALL_URLS: Record<WalletId, string> = {
  phantom:
    "https://phantom.app/download",
  solflare:
    "https://solflare.com/download",
  trust:
    "https://trustwallet.com/",
  coinbase:
    "https://www.coinbase.com/wallet/downloads",
};

const APP_SCHEMES: Record<WalletId, string> = {
  phantom: "phantom://",
  solflare: "solflare://",
  trust: "trust://",
  coinbase: "cbwallet://",
};

function ua(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent ?? "";
}

function uaMentions(id: WalletId): boolean {
  const s = ua();
  switch (id) {
    case "phantom":
      return /Phantom/i.test(s);
    case "solflare":
      return /Solflare/i.test(s);
    case "trust":
      return /Trust\s?Wallet/i.test(s);
    case "coinbase":
      return /Coinbase\s?Wallet/i.test(s);
  }
}

function windowInstalled(id: WalletId): boolean {
  if (typeof window === "undefined") return false;
  switch (id) {
    case "phantom":
      return !!window.solana?.isPhantom;
    case "solflare":
      return !!window.solflare?.isSolflare;
    case "trust":
      return !!window.trustwallet;
    case "coinbase":
      return !!window.coinbaseSolana;
  }
}

function buildDeeplink(id: WalletId, targetUrl: string): string {
  const enc = encodeURIComponent(targetUrl);
  switch (id) {
    case "phantom":
      return `https://phantom.app/ul/browse/${enc}`;
    case "solflare":
      return `https://solflare.com/ul/browse/${enc}`;
    case "trust":
      return `https://link.trustwallet.com/open_url?coin_id=20000114&url=${enc}`;
    case "coinbase":
      return `https://go.cb-w.com/dapp?cb_url=${enc}`;
  }
}

export function detectWallets(): DetectedWallet[] {
  const isMobile = /Android|iPhone|iPad|iPod|Mobile Safari/i.test(ua());
  const targetUrl =
    typeof window !== "undefined" ? window.location.href : "https://pump-trader.app";
  const all: WalletId[] = ["phantom", "solflare", "trust", "coinbase"];
  return all.map((id) => {
    const inApp = uaMentions(id);
    const installed = inApp || windowInstalled(id);
    return {
      id,
      name:
        id === "phantom"
          ? "Phantom"
          : id === "solflare"
          ? "Solflare"
          : id === "trust"
          ? "Trust Wallet"
          : "Coinbase Wallet",
      installed,
      inApp,
      deeplink: isMobile && !installed ? buildDeeplink(id, targetUrl) : null,
      installUrl: INSTALL_URLS[id],
      source: inApp ? "ua" : windowInstalled(id) ? "window" : undefined,
    };
  });
}

export function appScheme(id: WalletId): string {
  return APP_SCHEMES[id];
}
