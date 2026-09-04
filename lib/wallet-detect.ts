
export type WalletId = "phantom" | "solflare" | "trust" | "coinbase";
export type DetectedWallet = {
  id: WalletId;
  name: string;
  installed: boolean;
  inApp: boolean;
  deeplink: string | null;
  installUrl: string;
  adapterName: string;
  source?: "window" | "ua";
};

const INSTALL_URLS: Record<WalletId, string> = {
  phantom: "https://phantom.app/download",
  solflare: "https://solflare.com/download",
  trust: "https://trustwallet.com/",
  coinbase: "https://www.coinbase.com/wallet/downloads",
};

const APP_SCHEMES: Record<WalletId, string> = {
  phantom: "phantom://",
  solflare: "solflare://",
  trust: "trust://",
  coinbase: "cbwallet://",
};

const NAME_BY_ID: Record<WalletId, string> = {
  phantom: "Phantom",
  solflare: "Solflare",
  trust: "Trust Wallet",
  coinbase: "Coinbase Wallet",
};

const ADAPTER_NAME_BY_ID: Record<WalletId, string> = {
  phantom: "Phantom",
  solflare: "Solflare",
  trust: "Trust Wallet",
  coinbase: "Coinbase Wallet",
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
      return /Coinbase/i.test(s);
  }
}

function windowInstalled(id: WalletId): boolean {
  if (typeof window === "undefined") return false;
  switch (id) {
    case "phantom":
      return Boolean(
        (window as { solana?: { isPhantom?: boolean } }).solana?.isPhantom ||
          (window as { phantom?: { solana?: unknown } }).phantom?.solana,
      );
    case "solflare":
      return Boolean((window as { solflare?: { isSolflare?: boolean } }).solflare?.isSolflare);
    case "trust":
      return Boolean(
        (window as { trustwallet?: { solana?: unknown } | unknown }).trustwallet,
      );
    case "coinbase":
      return Boolean(
        (window as { coinbaseSolana?: unknown }).coinbaseSolana ||
          (window as { coinbaseWalletExtension?: unknown }).coinbaseWalletExtension,
      );
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

type AdapterInfo = { adapter: { name: string }; readyState: string | number };

export function detectFromAdapters(adapters: AdapterInfo[]): DetectedWallet[] {
  const isMobile = /Android|iPhone|iPad|iPod|Mobile Safari/i.test(ua());
  const targetUrl =
    typeof window !== "undefined" ? window.location.href : "https://pump-trader.app";
  const order: WalletId[] = ["phantom", "solflare", "trust", "coinbase"];
  // WalletReadyState.Installed === "Installed"
  const INSTALLED = "Installed";
  return order.map((id) => {
    const inApp = uaMentions(id);
    const installed = inApp || windowInstalled(id);
    const adapter = adapters.find((a) => a.adapter?.name === ADAPTER_NAME_BY_ID[id]);
    const ready = adapter?.readyState === INSTALLED;
    return {
      id,
      name: NAME_BY_ID[id],
      installed: installed || ready,
      inApp,
      deeplink: isMobile && !installed ? buildDeeplink(id, targetUrl) : null,
      installUrl: INSTALL_URLS[id],
      adapterName: ADAPTER_NAME_BY_ID[id],
      source: inApp ? "ua" : installed ? "window" : undefined,
    };
  });
}

export function appScheme(id: WalletId): string {
  return APP_SCHEMES[id];
}
