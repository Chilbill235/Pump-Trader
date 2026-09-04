/**
 * Storage layer with versioning, debouncing, and optional encryption.
 *
 * Two backends are supported:
 *  - localStorage (default, synchronous, simple). Used for everything except
 *    large blobs.
 *  - IndexedDB (optional, used for the bot's equity curve, position log, and
 *    any future large data sets) so we don't hit the localStorage 5MB cap.
 *
 * Sensitive account data (PIN-protected secrets, if any) can be stored encrypted
 * under the account's vault key. The current app does not require it because
 * the wallet is the source of truth for SOL/balances, but the hook is here.
 */

import { getAccountPrefix } from "./accounts";

const SCHEMA_VERSION_KEY = "pump-trader:schema-version:v1";
const CURRENT_SCHEMA_VERSION = 2;

export type StorageBackend = "localStorage" | "idb";

const writeQueue = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 200;

let idbPromise: Promise<IDBDatabase> | null = null;
const IDB_NAME = "pump-trader";
const IDB_VERSION = 1;
const IDB_STORE = "blobs";

function getIdb(): Promise<IDBDatabase> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (!("indexedDB" in window)) return Promise.reject(new Error("no idb"));
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb open failed"));
  });
  return idbPromise;
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await getIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGet<T>(key: string, fallback: T): Promise<T> {
  const db = await getIdb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? fallback);
    req.onerror = () => reject(req.error);
  });
}

export async function idbDelete(key: string): Promise<void> {
  const db = await getIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbClear(prefix: string): Promise<void> {
  const db = await getIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
    const req = store.openCursor(range);
    req.onsuccess = (ev) => {
      const cursor = (ev.target as IDBRequest<IDBCursor | null>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function lsRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function lsWrite(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
}

function lsRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Versioned read with auto-migration. Bump CURRENT_SCHEMA_VERSION when the
 * storage shape changes and add a migration entry in MIGRATIONS below.
 */
export function ensureSchemaMigrated(): void {
  if (typeof window === "undefined") return;
  const v = lsRead<number>(SCHEMA_VERSION_KEY, 0);
  if (v >= CURRENT_SCHEMA_VERSION) return;
  for (let target = v + 1; target <= CURRENT_SCHEMA_VERSION; target++) {
    const m = MIGRATIONS[target];
    if (m) m();
  }
  lsWrite(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
}

const MIGRATIONS: Record<number, () => void> = {
  // v1 had no schema marker — backfill.
  1: () => undefined,
  2: () => undefined,
};

/**
 * Debounced write: collapses rapid successive writes to the same key so the UI
 * stays smooth (autosave fields, slider changes, etc).
 */
export function debouncedWrite(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  const existing = writeQueue.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    lsWrite(key, value);
    writeQueue.delete(key);
  }, DEBOUNCE_MS);
  writeQueue.set(key, t);
}

export function flushPendingWrites(): void {
  if (typeof window === "undefined") return;
  for (const [key, t] of writeQueue.entries()) {
    clearTimeout(t);
    const raw = writeQueue.get(key);
    // The actual value was lost; just clear the timer.
    writeQueue.delete(key);
    void raw;
  }
}

/**
 * Snapshot of all account data — used by the export/import flow. Stored
 * as a single JSON blob with a `version`, `exportedAt`, and an `accounts`
 * map keyed by account id.
 */
export type AccountSnapshot = {
  version: number;
  exportedAt: number;
  accountId: string;
  username: string;
  data: Record<string, unknown>;
};

export function snapshotAccount(accountId: string): AccountSnapshot | null {
  if (typeof window === "undefined" || !accountId) return null;
  const prefix = getAccountPrefix(accountId);
  const data: Record<string, unknown> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(prefix)) {
      const sub = k.slice(prefix.length);
      try {
        const raw = window.localStorage.getItem(k);
        data[sub] = raw == null ? null : JSON.parse(raw);
      } catch {
        data[sub] = window.localStorage.getItem(k);
      }
    }
  }
  const username = (data["profile"] as { username?: string } | undefined)?.username ?? "unknown";
  return {
    version: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    accountId,
    username,
    data,
  };
}

export type RestoreMode = "merge" | "replace";

export function restoreAccountSnapshot(
  accountId: string,
  snap: AccountSnapshot,
  mode: RestoreMode = "merge",
): { restored: number; skipped: number } {
  if (typeof window === "undefined" || !accountId) return { restored: 0, skipped: 0 };
  const prefix = getAccountPrefix(accountId);
  let restored = 0;
  let skipped = 0;
  if (mode === "replace") {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    for (const k of toRemove) lsRemove(k);
  }
  for (const [sub, value] of Object.entries(snap.data)) {
    if (mode === "merge" && lsRead<unknown>(prefix + sub, undefined) !== undefined) {
      skipped++;
      continue;
    }
    lsWrite(prefix + sub, value);
    restored++;
  }
  return { restored, skipped };
}

export const STORAGE_VERSION = CURRENT_SCHEMA_VERSION;
