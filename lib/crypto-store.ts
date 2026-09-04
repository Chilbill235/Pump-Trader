/**
 * Optional encrypted-at-rest store for sensitive per-account data.
 *
 * Most app data (settings, positions, bot log) is non-sensitive and can live
 * in plain localStorage. This module is for data the user might want to hide
 * from anyone who can read the device's localStorage: e.g. a custom RPC key
 * (when set), trade notes, or a private watchlist of mints.
 *
 * Data is encrypted with the account's in-memory vault key (see
 * lib/accounts.ts) using AES-GCM. A random 12-byte IV is stored with the
 * ciphertext, and a small magic/version header is prepended so we can tell
 * encrypted blobs from plain JSON if a future migration mixes them.
 *
 * The store is fail-soft: if anything throws (key missing, corruption,
 * browser doesn't support WebCrypto), the read returns the fallback and the
 * caller decides what to do.
 */

import { getVaultKey } from "./accounts";

const MAGIC = "ptenc:v1:";

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

function toAB(u: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u.byteLength);
  new Uint8Array(ab).set(u);
  return ab;
}

function isCapable(): boolean {
  return (
    typeof crypto !== "undefined" &&
    !!crypto.subtle &&
    typeof crypto.subtle.importKey === "function" &&
    typeof crypto.subtle.encrypt === "function"
  );
}

export async function encryptForAccount(
  accountId: string | null,
  data: unknown,
): Promise<string | null> {
  if (!isCapable()) return null;
  const key = getVaultKey(accountId ?? "");
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = new TextEncoder().encode(JSON.stringify(data));
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toAB(iv) }, cryptoKey, toAB(raw));
  return MAGIC + b64(iv) + ":" + b64(ct);
}

export async function decryptForAccount<T>(
  accountId: string | null,
  blob: string | null,
  fallback: T,
): Promise<T> {
  if (!blob) return fallback;
  if (!blob.startsWith(MAGIC)) {
    // Not a recognized blob — try to parse as JSON for backward compatibility
    // with the old plaintext format.
    try {
      return JSON.parse(blob) as T;
    } catch {
      return fallback;
    }
  }
  if (!isCapable()) return fallback;
  const key = getVaultKey(accountId ?? "");
  if (!key) return fallback;
  try {
    const body = blob.slice(MAGIC.length);
    const [ivB64, ctB64] = body.split(":");
    if (!ivB64 || !ctB64) return fallback;
    const iv = fromB64(ivB64);
    const ct = fromB64(ctB64);
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, [
      "decrypt",
    ]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toAB(iv) }, cryptoKey, toAB(ct));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return fallback;
  }
}