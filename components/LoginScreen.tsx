"use client";

import { useEffect, useState } from "react";
import { useAccounts } from "./AccountsProvider";

type Mode = "create" | "unlock";

export function LoginScreen() {
  const { capable, accounts, create, unlock, switchTo, activeId, ready } = useAccounts();
  const [mode, setMode] = useState<Mode>("create");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && accounts[0]) setSelectedId(accounts[0].id);
  }, [accounts, selectedId]);

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 text-mute">
        Loading…
      </div>
    );
  }

  if (!capable) {
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
        if (pin !== confirm) {
          setError("PIN entries do not match.");
          return;
        }
        const r = await create({ username, pin });
        if (!r.ok) setError(r.error);
        else {
          setPin("");
          setConfirm("");
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
    <div className="grid min-h-screen place-items-center bg-ink-950 px-4 py-8 text-zinc-100">
      <div className="w-full max-w-md space-y-4">
        <div>
          <h1 className="font-mono text-lg tracking-widest text-neon">PUMP TRADER</h1>
          <p className="text-xs text-mute">
            Local multi-account dashboard. Everything is stored only in this browser. No server, no
            account on a server. Each account gets its own positions, settings, bot, and history —
            one account cannot read or stop another.
          </p>
        </div>

        {existingAccounts.length > 0 ? (
          <div className="flex rounded border border-line bg-ink-800 p-1 font-mono text-xs">
            <button
              type="button"
              className={`flex-1 rounded px-3 py-1.5 ${
                mode === "unlock" ? "bg-ink-700 text-white" : "text-mute"
              }`}
              onClick={() => {
                setMode("unlock");
                setError(null);
              }}
            >
              Unlock existing
            </button>
            <button
              type="button"
              className={`flex-1 rounded px-3 py-1.5 ${
                mode === "create" ? "bg-ink-700 text-white" : "text-mute"
              }`}
              onClick={() => {
                setMode("create");
                setError(null);
              }}
            >
              Create new
            </button>
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-3 rounded border border-line bg-ink-800 p-4">
          {mode === "unlock" ? (
            <div className="space-y-2">
              <label className="block">
                <span className="block font-mono text-[11px] uppercase text-mute">Account</span>
                <select
                  value={selectedId ?? ""}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    switchTo(e.target.value);
                    void activeId;
                  }}
                  className="mt-1 w-full rounded border border-line bg-ink-900 px-3 py-2 font-mono text-sm"
                >
                  {existingAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.username}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] text-mute">
                Select an account, then enter its PIN to unlock. After 15 minutes of inactivity the
                account auto-locks.
              </p>
            </div>
          ) : null}

          {mode === "create" ? (
            <label className="block">
              <span className="block font-mono text-[11px] uppercase text-mute">Username</span>
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. alice"
                className="mt-1 w-full rounded border border-line bg-ink-900 px-3 py-2 font-mono text-sm"
                maxLength={24}
              />
            </label>
          ) : null}

          <label className="block">
            <span className="block font-mono text-[11px] uppercase text-mute">
              {mode === "create" ? "Create a PIN" : "PIN"}
            </span>
            <input
              type="password"
              autoComplete="off"
              autoFocus={mode === "unlock"}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              minLength={4}
              maxLength={64}
              className="mt-1 w-full rounded border border-line bg-ink-900 px-3 py-2 font-mono text-sm"
            />
            <p className="mt-1 text-[11px] text-mute">
              4 characters minimum. Stored only in your browser. Losing the PIN means losing access to
              that account&apos;s data — there is no recovery and no server.
            </p>
          </label>

          {mode === "create" ? (
            <label className="block">
              <span className="block font-mono text-[11px] uppercase text-mute">Confirm PIN</span>
              <input
                type="password"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={4}
                maxLength={64}
                className="mt-1 w-full rounded border border-line bg-ink-900 px-3 py-2 font-mono text-sm"
              />
            </label>
          ) : null}

          {error ? (
            <p className="rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-neon py-2 font-mono text-sm text-ink-950 disabled:opacity-40"
          >
            {busy
              ? "Working…"
              : mode === "create"
                ? "Create account"
                : "Unlock"}
          </button>
        </form>

        {existingAccounts.length > 0 ? (
          <div className="rounded border border-line bg-ink-800 p-3 text-xs text-mute">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-mute">
              Accounts on this device
            </p>
            <ul className="space-y-1">
              {existingAccounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between">
                  <span className="truncate font-mono">{a.username}</span>
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
          </div>
        ) : null}

        <p className="text-center text-[11px] text-mute">
          Not financial advice. Most pump.fun coins go to zero. You are responsible for every trade.
        </p>
      </div>
    </div>
  );
}