/**
 * Per-account profile data (display name, color, bio, last-used RPC preset).
 * Stored as plain JSON under "profile:v1" in the per-account namespace.
 */

import { safeReadScoped, safeWriteScoped } from "./accounts";

const PROFILE_KEY = "profile:v1";

export type AccountProfile = {
  username: string;
  bio?: string;
  /** Optional accent color for the UI (e.g. "#39ff88"). */
  color?: string;
  /** Last RPC preset the user picked. Free-form string. */
  lastRpcPreset?: string;
  updatedAt: number;
};

export function loadAccountProfile(accountId: string | null): AccountProfile | null {
  if (!accountId) return null;
  return safeReadScoped<AccountProfile | null>(accountId, PROFILE_KEY, null);
}

export function saveAccountProfile(accountId: string | null, profile: AccountProfile): void {
  if (!accountId) return;
  safeWriteScoped(accountId, PROFILE_KEY, { ...profile, updatedAt: Date.now() });
}