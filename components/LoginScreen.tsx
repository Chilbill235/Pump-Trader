"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccounts } from "./AccountsProvider";
import { useSettings } from "./SettingsProvider";
import { isAccountsCapable } from "@/lib/accounts";

type Mode = "create" | "unlock";

function pinStrength(pin: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string } {
  if (pin.length === 0) return { score: 0, label: "empty", color: "bg-ink-700" };
  let score = 0;
  if (pin.length >= 4) score++;
  if (pin.length >= 8) score++;
  if (/[A-Z]/.test(pin) && /[a-z]/.test(pin)) score++;
  if (/\d/.test(pin) && /[^A-Za-z0-9]/.test(pin)) score++;
  const labels = ["empty", "too short", "weak", "okay", "strong"];
  const colors = ["bg-ink-700", "bg-danger", "bg-danger", "bg-warn", "bg-neon"];
  return { score: score as 0 | 1 | 2 | 3 | 4, label: labels[score], color: colors[score] };
}

export function LoginScreen() {
  const { capable, accounts, create, unlock, ready, remove } = useAccounts();
  const { settings, update } = useSettings();
  void settings;
  void update;
  const [mode, setMode] = useState<Mode>("create");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [hydratedOnce, setHydratedOnce] = useState(false);
  const usernameRef = useRef<HTMLInputElement | null>(null);
  const pinRef = useRef<HTMLInputElement | null>(null);

  const strength = useMemo(() => pinStrength(pin), [pin]);

  useEffect(() => {
    if (!selectedId && accounts[0]) setSelectedId(accounts[0].id);
  }, [accounts, selectedId]);

  useEffect(() => {
    if (ready && !hydratedOnce) {
      setHydratedOnce(true);
      if (accounts.length > 0) setMode("unlock");
    }
  }, [ready, accounts.length, hydratedOnce]);

  // Auto-focus the right field when mode flips.
  useEffect(() => {
    if (mode === "create") {
      setTimeout(() => usernameRef.current?.focus(), 50);
    } else {
      setTimeout(() => pinRef.current?.focus(), 50);
    }
  }, [mode]);

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 text-mute">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon border-t-transparent" />
          <span className="text-xs">Loading…</span>
        </div>
      </div>
    );
  }

  if (!capable && !isAccountsCapable()) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 p-6 text-zinc-100">
        <div className="max-w-md rounded border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          This browser does not support the cryptographic APIs needed to keep accounts isolated. Update to a modern Chrome, Edge, Firefox, Safari, or the in-app browser of Phantom / Solflare.
        </div>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        if (pin.length < 4) {
          setError("PIN must be at least 4 characters.");
          return;
        }
        if (pin !== confirmPin) {
          setError("PIN entries do not match.");
          return;
        }
        const r = await create({ username, pin });
        if (!r.ok) setError(r.error);
        else {
          setPin("");
          setConfirmPin("");
        }
      } else {
        if (!selectedId) {
          setError("Pick an account first.");
          return;
        }
        const r = await unlock({ accountId: selectedId, pin });
        if (!r.ok) setError(r.error);
        else setPin("");
      }
    } finally {
      setBusy(false);
    }
  }

  const existingAccounts = accounts;

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-ink-950 px-4 py-8 text-zinc-100">
      {/* Decorative background gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(circle at 20% 10%, rgba(57,255,136,0.18), transparent 50%), radial-gradient(circle at 80% 80%, rgba(14,165,233,0.18), transparent 50%)",
        }}
      />
      <div className="relative w-full max-w-md space-y-4">
        <div className="text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-ink-800/60 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-mute">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-neon live-pulse" />
            Local · Encrypted · No server
          </p>
          <h1 className="mt-3 font-mono text-2xl tracking-widest text-neon">PUMP TRADER</h1>
          <p className="mt-1 text-xs text-mute">
            Local multi-account dashboard. Everything is stored only in this browser. No server, no
            account on a server. Each account gets its own positions, settings, bot, and history —
            one account cannot read or stop another.
          </p>
        </div>

        {existingAccounts.length > 0 ? (
          <div className="flex rounded border border-line bg-ink-800 p-1 font-mono text-xs">
            <button
              type="button"
              className={`press flex-1 touch-target rounded px-3 py-2 ${mode === "unlock" ? "bg-ink-700 text-white" : "text-mute"}`}
              onClick={() => {
                setMode("unlock");
                setError(null);
              }}
            >
              Unlock
            </button>
            <button
              type="button"
              className={`press flex-1 touch-target rounded px-3 py-2 ${mode === "create" ? "bg-ink-700 text-white" : "text-mute"}`}
              onClick={() => {
                setMode("create");
                setError(null);
              }}
            >
              Create
            </button>
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-3 rounded border border-line bg-ink-800/90 p-4 shadow-2xl backdrop-blur">
          {mode === "unlock" ? (
            <div className="space-y-2">
              <span className="block font-mono text-[11px] uppercase text-mute">Account</span>
              <ul className="grid grid-cols-2 gap-2">
                {existingAccounts.map((a) => {
                  const active = selectedId === a.id;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(a.id);
                          setError(null);
                          setTimeout(() => pinRef.current?.focus(), 50);
                        }}
                        className={`press touch-target w-full rounded border px-2 py-2 text-left ${
                          active
                            ? "border-neon bg-neon/10 text-neon"
                            : "border-line bg-ink-900 text-mute hover:border-neon/60"
                        }`}
                      >
                        <p className="truncate text-sm">@{a.username}</p>
                        <p className="font-mono text-[10px] text-mute">
                          {new Date(a.lastAt).toLocaleDateString()}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {mode === "create" ? (
            <label className="block">
              <span className="block font-mono text-[11px] uppercase text-mute">Username</span>
              <input
                ref={usernameRef}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. alice"
                className="mt-1 w-full rounded border border-line bg-ink-900 px-3 py-2 font-mono text-sm"
                maxLength={24}
                autoComplete="username"
              />
            </label>
          ) : null}

          <label className="block">
            <span className="flex items-center justify-between font-mono text-[11px] uppercase text-mute">
              <span>{mode === "create" ? "Create a PIN" : "PIN"}</span>
              {pin.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowPin((s) => !s)}
                  className="press rounded px-1 font-mono text-[10px] normal-case text-mute hover:text-neon"
                >
                  {showPin ? "hide" : "show"}
                </button>
              ) : null}
            </span>
            <input
              ref={pinRef}
              type={showPin ? "text" : "password"}
              autoComplete="off"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(null);
              }}
              minLength={4}
              maxLength={64}
              className="mt-1 w-full rounded border border-line bg-ink-900 px-3 py-2 font-mono text-sm"
              aria-describedby="pin-strength"
            />
            {mode === "create" && pin.length > 0 ? (
              <div id="pin-strength" className="mt-1 flex items-center gap-2">
                <div className="flex h-1 flex-1 gap-1">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded ${i <= strength.score ? strength.color : "bg-ink-700"}`}
                    />
                  ))}
                </div>
                <span className="font-mono text-[10px] uppercase text-mute">{strength.label}</span>
              </div>
            ) : null}
            {mode === "unlock" ? (
              <p className="mt-1 text-[11px] text-mute">Enter this account&apos;s PIN. After 15 minutes of inactivity the account auto-locks.</p>
            ) : null}
          </label>

          {mode === "create" ? (
            <label className="block">
              <span className="block font-mono text-[11px] uppercase text-mute">Confirm PIN</span>
              <input
                type={showPin ? "text" : "password"}
                autoComplete="off"
                value={confirmPin}
                onChange={(e) => {
                  setConfirmPin(e.target.value);
                  setError(null);
                }}
                minLength={4}
                maxLength={64}
                className="mt-1 w-full rounded border border-line bg-ink-900 px-3 py-2 font-mono text-sm"
              />
            </label>
          ) : null}

          {error ? (
            <p className="press rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="press touch-target w-full rounded bg-neon py-2.5 font-mono text-sm font-semibold text-ink-950 disabled:opacity-40"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-950 border-t-transparent" />
                Working…
              </span>
            ) : mode === "create" ? (
              "Create account"
            ) : (
              "Unlock"
            )}
          </button>

          {mode === "unlock" && selectedId ? (
            <button
              type="button"
              onClick={() => {
                if (confirm("Delete this account and all its data? This cannot be undone.")) {
                  remove(selectedId);
                  setSelectedId(null);
                }
              }}
              className="press w-full rounded border border-line bg-ink-900 px-3 py-1.5 font-mono text-[11px] text-mute hover:border-danger hover:text-danger"
            >
              Delete this account
            </button>
          ) : null}
        </form>

        {existingAccounts.length > 0 ? (
          <details className="rounded border border-line bg-ink-800/60 p-3 text-xs text-mute">
            <summary className="press cursor-pointer list-none font-mono text-[11px] uppercase tracking-wide">
              Accounts on this device ({existingAccounts.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {existingAccounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between">
                  <span className="truncate font-mono">@{a.username}</span>
                  <span className="font-mono text-[11px] text-mute">
                    {new Date(a.lastAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px]">
              Each account is its own island. Positions, settings, the bot, and the trade log are
              scoped per account. Switching accounts locks the previous one.
            </p>
          </details>
        ) : null}

        <p className="text-center text-[11px] text-mute">
          Not financial advice. Most pump.fun coins go to zero. You are responsible for every trade.
        </p>
      </div>
    </div>
  );
}