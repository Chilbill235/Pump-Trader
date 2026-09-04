/**
 * Window-based wallet adapters that wrap the provider each wallet extension
 * injects into the global scope. We use ONE class for all four supported
 * wallets (Phantom, Solflare, Trust, Coinbase) because the per-wallet
 * differences are just a name and a small namespace map.
 *
 * Why we do this rather than `@solana/wallet-adapter-wallets`:
 *   1. That package registers `PhantomWalletAdapter` + `SolflareWalletAdapter`
 *      AGAINST the already-registered Standard Wallet, which logs a
 *      "registered as a Standard Wallet" warning to the console.
 *   2. It does not include Trust or Coinbase, and bundling the
 *      `WalletConnectWalletAdapter` is a much heavier dep.
 *   3. Going through the Wallet Standard means we can never use
 *      `useWallet().select(...)` to programmatically choose a wallet, which
 *      breaks the picker UI.
 *
 * The class below is a proper `BaseSignerWalletAdapter` so `useWallet()`,
 * `wallet.signTransaction`, `wallet.sendTransaction`, etc. all work uniformly
 * for every view in the app.
 */
import {
  BaseSignerWalletAdapter,
  WalletConnectionError,
  WalletNotConnectedError,
  WalletSignTransactionError,
  type WalletName,
  WalletReadyState,
} from "@solana/wallet-adapter-base";
import {
  PublicKey,
  Transaction,
  type SendOptions,
  type TransactionSignature,
  type VersionedTransaction,
} from "@solana/web3.js";

type AnyEventListener = (...args: unknown[]) => void;

/**
 * The shape of every provider we know how to talk to. Different wallets
 * expose different subsets — that's why every method is optional and we
 * gracefully degrade.
 */
type InjectedProvider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isTrust?: boolean;
  isCoinbase?: boolean;
  isCoinbaseBrowser?: boolean;
  publicKey?: PublicKey | null;
  connect?: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey | string }>;
  disconnect?: () => Promise<void>;
  signTransaction?: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
  signMessage?: (msg: Uint8Array) => Promise<{ signature: Uint8Array } | Uint8Array>;
  signIn?: (input?: unknown) => Promise<unknown>;
  sendTransaction?: (
    tx: Transaction | VersionedTransaction,
    connection: { rpcEndpoint: string },
    options?: SendOptions,
  ) => Promise<TransactionSignature>;
  on?: (event: string, listener: AnyEventListener) => void;
  off?: (event: string, listener: AnyEventListener) => void;
  removeAllListeners?: (event?: string) => void;
};

declare global {
  interface Window {
    solana?: InjectedProvider;
    phantom?: { solana?: InjectedProvider };
    solflare?: InjectedProvider;
    trustwallet?: { solana?: InjectedProvider } & InjectedProvider;
    coinbaseSolana?: InjectedProvider;
    coinbaseWalletExtension?: InjectedProvider;
  }
}

type WalletBrand = "Phantom" | "Solflare" | "Trust Wallet" | "Coinbase Wallet";

/** Map each brand to the window objects where it may have injected a provider. */
function getProviders(brand: WalletBrand): InjectedProvider[] {
  if (typeof window === "undefined") return [];
  const list: InjectedProvider[] = [];
  switch (brand) {
    case "Phantom": {
      // Newer Phantom → `window.solana.isPhantom === true`
      // Legacy Phantom (v1) → `window.phantom.solana`
      if (window.solana?.isPhantom) list.push(window.solana);
      if (window.phantom?.solana) list.push(window.phantom.solana);
      break;
    }
    case "Solflare": {
      if (window.solflare?.isSolflare) list.push(window.solflare);
      break;
    }
    case "Trust Wallet": {
      // Trust injects `window.trustwallet.solana` on mobile web + extension
      const t = window.trustwallet as { solana?: InjectedProvider } & InjectedProvider | undefined;
      if (t) {
        if ((t as { solana?: InjectedProvider }).solana) {
          list.push((t as { solana?: InjectedProvider }).solana!);
        } else if (t.connect) {
          list.push(t as InjectedProvider);
        }
      }
      break;
    }
    case "Coinbase Wallet": {
      if (window.coinbaseSolana) list.push(window.coinbaseSolana);
      if (window.coinbaseWalletExtension) list.push(window.coinbaseWalletExtension);
      break;
    }
  }
  return list;
}

function toPublicKey(value: PublicKey | string | null | undefined): PublicKey | null {
  if (!value) return null;
  if (value instanceof PublicKey) return value;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function firstDefined<T>(arr: Array<T | null | undefined>, fallback: T): T {
  for (const v of arr) if (v != null) return v as T;
  return fallback;
}

const BRAND_META: Record<
  WalletBrand,
  { name: WalletName<WalletBrand>; url: string; icon: string; ready: WalletReadyState }
> = {
  Phantom: {
    name: "Phantom" as WalletName<"Phantom">,
    url: "https://phantom.app",
    icon: "https://phantom.app/img/logo.png",
    ready: WalletReadyState.Installed,
  },
  Solflare: {
    name: "Solflare" as WalletName<"Solflare">,
    url: "https://solflare.com",
    icon: "https://solflare.com/favicon.ico",
    ready: WalletReadyState.Installed,
  },
  "Trust Wallet": {
    name: "Trust Wallet" as WalletName<"Trust Wallet">,
    url: "https://trustwallet.com",
    icon: "https://trustwallet.com/favicon.ico",
    ready: WalletReadyState.Installed,
  },
  "Coinbase Wallet": {
    name: "Coinbase Wallet" as WalletName<"Coinbase Wallet">,
    url: "https://www.coinbase.com/wallet",
    icon: "https://www.coinbase.com/favicon.ico",
    ready: WalletReadyState.Installed,
  },
};

export class WindowWalletAdapter extends BaseSignerWalletAdapter<WalletBrand> {
  readonly name: WalletName<WalletBrand> = "" as WalletName<WalletBrand>;
  readonly url = "";
  readonly icon = "";
  readonly supportedTransactionVersions = new Set<"legacy" | 0>();

  #brand: WalletBrand;
  #provider: InjectedProvider | null = null;
  #publicKey: PublicKey | null = null;
  #connecting = false;
  #listeners = new Set<() => void>();

  constructor(brand: WalletBrand) {
    super();
    this.#brand = brand;
    const meta = BRAND_META[brand];
    (this as { name: WalletName<WalletBrand> }).name = meta.name;
    (this as { url: string }).url = meta.url;
    (this as { icon: string }).icon = meta.icon;
    const providers = getProviders(brand);
    this.#provider = providers[0] ?? null;
    const initial = toPublicKey(this.#provider?.publicKey ?? null);
    if (initial) this.#publicKey = initial;
  }

  get readyState(): WalletReadyState {
    return this.#provider ? WalletReadyState.Installed : WalletReadyState.NotDetected;
  }

  get publicKey(): PublicKey | null {
    return this.#publicKey;
  }

  get connecting(): boolean {
    return this.#connecting;
  }

  /** Re-scan window for the provider (e.g. user installed Phantom mid-session). */
  rescan(): boolean {
    const providers = getProviders(this.#brand);
    if (providers[0] && providers[0] !== this.#provider) {
      this.#provider = providers[0];
      this.#wireProviderEvents();
      this.emit("readyStateChange", this.readyState);
      return true;
    }
    return false;
  }

  #wireProviderEvents() {
    const p = this.#provider;
    if (!p?.on || !p?.off) return;
    try {
      p.removeAllListeners?.("connect");
      p.removeAllListeners?.("disconnect");
      p.removeAllListeners?.("accountChanged");
    } catch {
      // ignore
    }
    const onConnect = (...args: unknown[]) => {
      const pk = toPublicKey((args[0] as { publicKey?: PublicKey | string } | undefined)?.publicKey);
      if (pk) {
        this.#publicKey = pk;
        this.emit("connect", pk);
      } else if (p.publicKey) {
        const pk2 = toPublicKey(p.publicKey);
        if (pk2) {
          this.#publicKey = pk2;
          this.emit("connect", pk2);
        }
      }
    };
    const onDisconnect = () => {
      this.#publicKey = null;
      this.emit("disconnect");
    };
    const onAccountChanged = (...args: unknown[]) => {
      const pk = toPublicKey(args[0] as PublicKey | string | null | undefined);
      if (!pk) {
        // Wallet locked — disconnect
        this.#publicKey = null;
        this.emit("disconnect");
        return;
      }
      this.#publicKey = pk;
      this.emit("connect", pk);
    };
    try {
      p.on("connect", onConnect as AnyEventListener);
      p.on("disconnect", onDisconnect as AnyEventListener);
      p.on("accountChanged", onAccountChanged as AnyEventListener);
    } catch {
      // some providers don't support all events — that's fine
    }
    this.#listeners.add(() => {
      try {
        p.off?.("connect", onConnect as AnyEventListener);
        p.off?.("disconnect", onDisconnect as AnyEventListener);
        p.off?.("accountChanged", onAccountChanged as AnyEventListener);
      } catch {
        // ignore
      }
    });
  }

  async connect(): Promise<void> {
    if (this.#publicKey) return;
    if (this.#connecting) return;
    // Re-scan in case the provider was injected after construction.
    if (!this.#provider) this.rescan();
    const p = this.#provider;
    if (!p?.connect) {
      throw new Error(
        `${this.#brand} not detected. Install the extension or open this page in the ${this.#brand} app.`,
      );
    }
    this.#connecting = true;
    try {
      this.#wireProviderEvents();
      // `onlyIfTrusted: true` lets silent re-connect on already-authorized sites
      const resp = await p.connect({ onlyIfTrusted: false });
      const pk = firstDefined<PublicKey | null>(
        [toPublicKey(resp?.publicKey), toPublicKey(p.publicKey ?? null)],
        null,
      );
      if (!pk) {
        throw new Error(`${this.#brand} returned no public key.`);
      }
      this.#publicKey = pk;
      this.emit("connect", pk);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // User rejection is not a real error — surface it but don't spam.
      const isUserRejection = /user (rejected|canceled|denied)/i.test(msg);
      if (!isUserRejection) {
        const wrapped = new WalletConnectionError(msg, err);
        this.emit("error", wrapped);
      }
      throw err;
    } finally {
      this.#connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const p = this.#provider;
    if (p?.disconnect) {
      try {
        await p.disconnect();
      } catch {
        // ignore
      }
    }
    this.#publicKey = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const p = this.#provider;
    if (!this.#publicKey) throw new WalletNotConnectedError();
    if (!p?.signTransaction) {
      throw new WalletSignTransactionError(
        `${this.#brand} did not expose a signTransaction method. The wallet extension may be outdated — update it and reload.`,
      );
    }
    try {
      return (await p.signTransaction(tx)) as T;
    } catch (err) {
      throw new WalletSignTransactionError(
        err instanceof Error ? err.message : String(err),
        err instanceof Error ? err : undefined,
      );
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    const p = this.#provider;
    if (!this.#publicKey) throw new WalletNotConnectedError();
    if (!p?.signAllTransactions) {
      // Some wallets (older Phantom) only support signTransaction. Fall back.
      const out: T[] = [];
      for (const tx of txs) out.push(await this.signTransaction(tx));
      return out;
    }
    try {
      return (await p.signAllTransactions(txs)) as T[];
    } catch (err) {
      throw new WalletSignTransactionError(
        err instanceof Error ? err.message : String(err),
        err instanceof Error ? err : undefined,
      );
    }
  }
}
