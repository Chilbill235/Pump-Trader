/**
 * Local, browser-only multi-account system.
 *
 * There is no server. Each account gets its own:
 *   - salt (for PIN-based key derivation)
 *   - PBKDF2-derived AES-GCM key (kept only in memory while unlocked)
 *   - localStorage namespace (pump-trader:acct:<id>:*)
 *
 * Accounts are isolated by a single storage prefix. Switching account literally
 * changes the data view, so one account cannot read or write another account's
 * positions, settings, pipeline log, bot session, closed trades, equity curve,
 * or alerts. The kill-switch and emergency stop are also account-scoped.
 *
 * The PIN never leaves the browser. We do not store a hash of the PIN; we store
 * a wrapped copy of a random "vault key" under the PBKDF2-derived KEK.
 */

export type AccountSummary = {
  id: string;
  username: string;
  createdAt: number;
  lastAt: number;
};

export type StoredAccount = {
  id: string;
  username: string;
  createdAt: number;
  lastAt: number;
  /** PBKDF2 salt, base64. */
  saltB64: string;
  /** PBKDF2 iterations (recorded so we can upgrade later). */
  iterations: number;
  /** Random vault key, encrypted by the KEK, base64. */
  wrappedVaultB64: string;
  /** IV used to wrap the vault key, base64. */
  wrapIvB64: string;
};

const ACCOUNTS_KEY = "pump-trader:accounts:v1";
const SESSION_KEY = "pump-trader:active-account:v1";
const PIN_MIN = 4;
const PIN_MAX = 64;
const PBKDF2_ITERATIONS = 200_000;

export function isAccountsCapable(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof crypto !== "undefined" &&
    !!crypto.subtle &&
    !!crypto.subtle.importKey &&
    !!crypto.subtle.deriveKey &&
    typeof crypto.getRandomValues === "function"
  );
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa !== "undefined" ? btoa(s) : "";
}

function fromB64(s: string): Uint8Array {
  if (typeof atob !== "undefined") {
    const raw = atob(s);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return new Uint8Array(0);
}

export function getAccountPrefix(id: string): string {
  return `pump-trader:acct:${id}:`;
}

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
}

export function listAccounts(): AccountSummary[] {
  const accounts = safeRead<StoredAccount[]>(ACCOUNTS_KEY, []);
  return accounts.map((a) => ({
    id: a.id,
    username: a.username,
    createdAt: a.createdAt,
    lastAt: a.lastAt,
  }));
}

export function getActiveAccountId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setActiveAccountId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(SESSION_KEY, id);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

function loadStoredAccount(id: string): StoredAccount | null {
  const accounts = safeRead<StoredAccount[]>(ACCOUNTS_KEY, []);
  return accounts.find((a) => a.id === id) ?? null;
}

function saveStoredAccount(acc: StoredAccount): void {
  const accounts = safeRead<StoredAccount[]>(ACCOUNTS_KEY, []);
  const idx = accounts.findIndex((a) => a.id === acc.id);
  if (idx >= 0) accounts[idx] = acc;
  else accounts.push(acc);
  safeWrite(ACCOUNTS_KEY, accounts);
}

function deleteStoredAccount(id: string): void {
  const accounts = safeRead<StoredAccount[]>(ACCOUNTS_KEY, [])
    .filter((a) => a.id !== id);
  safeWrite(ACCOUNTS_KEY, accounts);
  // Remove all per-account data.
  const prefix = getAccountPrefix(id);
  const toRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(prefix)) toRemove.push(k);
  }
  for (const k of toRemove) window.localStorage.removeItem(k);
  if (getActiveAccountId() === id) setActiveAccountId(null);
}

function validateUsername(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return "Username must be at least 2 characters.";
  if (trimmed.length > 24) return "Username must be 24 characters or fewer.";
  if (!/^[A-Za-z0-9 _.\-]+$/.test(trimmed))
    return "Username can only contain letters, numbers, spaces, dots, dashes, and underscores.";
  return null;
}

function validatePin(pin: string): string | null {
  if (pin.length < PIN_MIN) return `PIN must be at least ${PIN_MIN} characters.`;
  if (pin.length > PIN_MAX) return `PIN must be ${PIN_MAX} characters or fewer.`;
  return null;
}

async function deriveKek(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toBufferSource(new TextEncoder().encode(pin)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toBufferSource(salt),
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** TypeScript's WebCrypto types require a strict ArrayBuffer-backed source. */
function toBufferSource(u: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u.byteLength);
  new Uint8Array(ab).set(u);
  return ab;
}

/**
 * Create a new account. Returns the new account summary on success, or an error
 * string if validation fails. The PIN is used to wrap a random vault key. The
 * vault key is never persisted; it lives only in `vaultKeyRef` while unlocked.
 */
export async function createAccount(args: {
  username: string;
  pin: string;
}): Promise<{ account: AccountSummary } | { error: string }> {
  if (!isAccountsCapable()) return { error: "This browser does not support the required crypto APIs." };
  const uerr = validateUsername(args.username);
  if (uerr) return { error: uerr };
  const perr = validatePin(args.pin);
  if (perr) return { error: perr };
  const accounts = safeRead<StoredAccount[]>(ACCOUNTS_KEY, []);
  if (accounts.some((a) => a.username.toLowerCase() === args.username.trim().toLowerCase())) {
    return { error: "An account with that name already exists on this device." };
  }
  const salt = randomBytes(16);
  const kek = await deriveKek(args.pin, salt, PBKDF2_ITERATIONS);
  const vaultKey = randomBytes(32);
  const wrapIv = randomBytes(12);
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBufferSource(wrapIv) },
    kek,
    toBufferSource(vaultKey),
  );
  const id = `ac_${Date.now().toString(36)}_${randomBytes(4).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
  const stored: StoredAccount = {
    id,
    username: args.username.trim(),
    createdAt: Date.now(),
    lastAt: Date.now(),
    saltB64: b64(salt),
    iterations: PBKDF2_ITERATIONS,
    wrappedVaultB64: b64(wrapped),
    wrapIvB64: b64(wrapIv),
  };
  saveStoredAccount(stored);
  setActiveAccountId(id);
  vaultKeyRef.set(id, vaultKey.slice().buffer);
  return {
    account: {
      id: stored.id,
      username: stored.username,
      createdAt: stored.createdAt,
      lastAt: stored.lastAt,
    },
  };
}

/**
 * Verify a PIN for an account. On success, the vault key is cached in memory
 * and the account becomes the active session.
 */
export async function unlockAccount(args: {
  accountId: string;
  pin: string;
}): Promise<{ account: AccountSummary } | { error: string }> {
  if (!isAccountsCapable()) return { error: "This browser does not support the required crypto APIs." };
  const stored = loadStoredAccount(args.accountId);
  if (!stored) return { error: "Account not found on this device." };
  const salt = fromB64(stored.saltB64);
  const kek = await deriveKek(args.pin, salt, stored.iterations);
  const wrapIv = fromB64(stored.wrapIvB64);
  const wrapped = fromB64(stored.wrappedVaultB64);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toBufferSource(wrapIv) }, kek, toBufferSource(wrapped));
    const plainCopy = new Uint8Array(plain);
    vaultKeyRef.set(stored.id, plainCopy.buffer);
    stored.lastAt = Date.now();
    saveStoredAccount(stored);
    setActiveAccountId(stored.id);
    return {
      account: {
        id: stored.id,
        username: stored.username,
        createdAt: stored.createdAt,
        lastAt: stored.lastAt,
      },
    };
  } catch {
    return { error: "Incorrect PIN." };
  }
}

export function lockAccount(): void {
  const id = getActiveAccountId();
  if (id) vaultKeyRef.delete(id);
  setActiveAccountId(null);
}

export function removeAccount(accountId: string): void {
  vaultKeyRef.delete(accountId);
  deleteStoredAccount(accountId);
}

/**
 * Lock-on-idle timer. Returns the timeout id so they can re-arm.
 */
const IDLE_MS = 15 * 60_000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let onLock: (() => void) | null = null;

function armIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    lockAccount();
    if (onLock) onLock();
  }, IDLE_MS);
}

export function registerIdleLockHandler(handler: () => void): () => void {
  onLock = handler;
  return () => {
    onLock = null;
  };
}

export function bumpIdleTimer(): void {
  if (typeof window === "undefined") return;
  armIdleTimer();
}

/**
 * In-memory vault key cache. Keyed by account id. Never persisted.
 */
const vaultKeyRef = new Map<string, ArrayBuffer>();

export function getVaultKey(accountId: string): ArrayBuffer | null {
  return vaultKeyRef.get(accountId) ?? null;
}

/**
 * Per-account data namespace helpers. All other lib/* files should use these
 * instead of writing to "pump-trader:..." directly. This is how the isolation
 * is enforced: a different account id produces a different key, so localStorage
 * returns a different (empty) value.
 */

export function scopedKey(accountId: string | null | undefined, key: string): string {
  if (!accountId) {
    // Should not happen while logged out — components that touch storage must
    // be rendered inside AccountsProvider. We still namespace to "" so it's
    // obviously broken rather than silently leaking into a shared bucket.
    throw new Error("scopedKey called without an active account");
  }
  return `${getAccountPrefix(accountId)}${key}`;
}

export function safeReadScoped<T>(accountId: string | null | undefined, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  if (!accountId) return fallback;
  try {
    const raw = window.localStorage.getItem(scopedKey(accountId, key));
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeWriteScoped(accountId: string | null | undefined, key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  if (!accountId) return;
  try {
    window.localStorage.setItem(scopedKey(accountId, key), JSON.stringify(value));
  } catch {
    // ignore quota
  }
}

export function removeScoped(accountId: string | null | undefined, key: string): void {
  if (typeof window === "undefined") return;
  if (!accountId) return;
  try {
    window.localStorage.removeItem(scopedKey(accountId, key));
  } catch {
    // ignore
  }
}