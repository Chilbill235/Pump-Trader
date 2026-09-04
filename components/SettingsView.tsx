"use client";

import { DEFAULT_RPC } from "@/lib/constants";
import { useSettings } from "./SettingsProvider";
import { useActiveAccountId } from "./AccountsProvider";
import { getAccountPrefix } from "@/lib/accounts";

export function SettingsView() {
  const { settings, update } = useSettings();
  const accountId = useActiveAccountId();

  const exportData = () => {
    const data: Record<string, unknown> = {};
    const prefix = accountId ? getAccountPrefix(accountId) : "";
    if (typeof window === "undefined" || !prefix) return;
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const sub = key.slice(prefix.length);
        try {
          data[sub] = JSON.parse(window.localStorage.getItem(key) || "null");
        } catch {
          data[sub] = window.localStorage.getItem(key);
        }
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pump-trader-${accountId}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as Record<string, unknown>;
        const prefix = accountId ? getAccountPrefix(accountId) : "";
        if (!prefix) {
          alert("Unlock your account first.");
          return;
        }
        for (const [sub, value] of Object.entries(data)) {
          if (typeof sub !== "string") continue;
          window.localStorage.setItem(prefix + sub, JSON.stringify(value));
        }
        window.location.reload();
      } catch {
        alert("Invalid backup file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="font-mono text-lg tracking-wide">Settings</h1>
        <p className="text-xs text-mute">
          Stored in this browser only, scoped to your account. No custodial backend. Never paste a
          private key.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="font-mono text-[11px] uppercase text-mute">RPC URL</span>
        <input
          value={settings.rpcUrl}
          onChange={(e) => {
            const v = e.target.value.trim();
            update({ rpcUrl: /^https?:\/\//i.test(v) || v === "" ? v : settings.rpcUrl });
          }}
          className="w-full rounded border border-line bg-ink-800 px-3 py-2 font-mono text-sm"
        />
        <button
          type="button"
          className="text-[11px] text-mute underline"
          onClick={() => update({ rpcUrl: DEFAULT_RPC })}
        >
          Reset to env / public mainnet
        </button>
        {!/^https?:\/\//i.test(settings.rpcUrl) && settings.rpcUrl !== "" && (
          <p className="text-[11px] text-danger">Enter a valid HTTP(S) URL or reset to default.</p>
        )}
      </label>

      <label className="block space-y-1">
        <span className="font-mono text-[11px] uppercase text-mute">Slippage %</span>
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={settings.slippagePct}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 0.1) update({ slippagePct: n });
          }}
          className="w-full rounded border border-line bg-ink-800 px-3 py-2 font-mono text-sm"
        />
        <p className="text-[11px] text-mute">Default 5%. Any positive value allowed.</p>
      </label>

      <Toggle
        label="Simulate / paper mode"
        hint="ON by default. Quotes and pretends fills. Sends no transactions."
        checked={settings.simulateMode}
        onChange={(v) => update({ simulateMode: v })}
      />
      <Toggle
        label="Auto-sell on TP / SL"
        hint="OFF by default. Watcher always alerts. Auto-sell only runs if you enable this AND have TP/SL on a position."
        checked={settings.autoSell}
        onChange={(v) => update({ autoSell: v })}
        danger
      />
      <Toggle
        label="Auto-trade pipeline candidates"
        hint="OFF by default. When ON, the pipeline auto-buys scoring candidates (live trades need ConfirmDialog once). Keep Phantom open."
        checked={settings.autoTrade}
        onChange={(v) => update({ autoTrade: v })}
        danger
      />

      <div className="border-t border-line pt-4">
        <h2 className="font-mono text-sm tracking-wide">Watch pipeline</h2>
        <p className="mb-3 text-xs text-mute">
          Heuristic scan of newest launches. Auto-trade bypasses manual approval — keep safety rails tight.
        </p>
      </div>

      <Toggle
        label="Pipeline enabled"
        hint="When off, /watch still shows the launch stream but does not score or queue."
        checked={settings.pipelineEnabled}
        onChange={(v) => update({ pipelineEnabled: v })}
      />
      <Toggle
        label="Require metadata"
        hint="Skip coins without name/symbol plus an image or description."
        checked={settings.requireMetadata}
        onChange={(v) => update({ requireMetadata: v })}
      />

      <NumberField
        label="min_score"
        hint="Skip if weighted score is below this (default 0.55)."
        value={settings.minScore}
        min={0}
        step={0.01}
        onChange={(v) => update({ minScore: v })}
      />
      <NumberField
        label="max_position_sol"
        hint="Risk brake. Queue size and max cost per mint (default 0.1). Any value allowed."
        value={settings.maxPositionSol}
        min={0.0001}
        step={0.0001}
        onChange={(v) => update({ maxPositionSol: v })}
      />
      <NumberField
        label="max_open_positions"
        hint="Do not open more than this many positions at once (default 5). Any value allowed."
        value={settings.maxOpenPositions}
        min={1}
        step={1}
        onChange={(v) => update({ maxOpenPositions: Math.round(v) })}
      />
      <NumberField
        label="daily_loss_limit"
        hint="Do not queue if today's pipeline spend + realized loss ≥ this SOL (default 0.3). Any value."
        value={settings.dailyLossLimit}
        min={0}
        step={0.0001}
        onChange={(v) => update({ dailyLossLimit: v })}
      />
      <NumberField
        label="unique_buyers min"
        hint="Basic filter. Empty-curve skip (default 5). Count is estimated when pump.fun omits holders."
        value={settings.minUniqueBuyers}
        min={0}
        step={1}
        onChange={(v) => update({ minUniqueBuyers: Math.round(v) })}
      />
      <NumberField
        label="bonding_curve_pct max"
        hint="Still-early filter (default 40). 0–100."
        value={settings.maxBondingCurvePct}
        min={0}
        step={1}
        onChange={(v) => update({ maxBondingCurvePct: v })}
      />
      <NumberField
        label="age_minutes min"
        hint="Must survive the first N minutes (default 2). Age skips are retried."
        value={settings.minAgeMinutes}
        min={0}
        step={0.5}
        onChange={(v) => update({ minAgeMinutes: v })}
      />

      <div className="border-t border-line pt-4">
        <h2 className="font-mono text-sm tracking-wide">Data</h2>
        <p className="mb-3 text-xs text-mute">
          Export or import your account backup (settings, positions, pipeline log, alerts).
          Backups are scoped to this account and cannot be loaded into another one.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportData}
            className="rounded border border-line px-3 py-1.5 font-mono text-xs hover:border-neon hover:text-neon"
          >
            Export backup
          </button>
          <label className="rounded border border-line px-3 py-1.5 font-mono text-xs hover:border-neon hover:text-neon cursor-pointer">
            Import backup
            <input type="file" accept="application/json" onChange={importData} className="hidden" />
          </label>
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <h2 className="font-mono text-sm tracking-wide text-danger">Emergency stop</h2>
        <p className="mb-3 text-xs text-mute">
          Immediately disable auto-sell and auto-trade for this account. Does not close positions.
        </p>
        <button
          type="button"
          onClick={() => update({ autoTrade: false, autoSell: false })}
          className="rounded bg-danger px-4 py-2 font-mono text-sm text-white hover:bg-danger/80"
        >
          STOP ALL AUTO TRADING
        </button>
      </div>
    </div>
  );
}

function Toggle(props: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  danger?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded border border-line bg-ink-800 p-3">
      <span>
        <span className="block text-sm">{props.label}</span>
        <span className="block text-xs text-mute">{props.hint}</span>
      </span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className={`mt-1 h-4 w-4 ${props.danger ? "accent-danger" : "accent-neon"}`}
      />
    </label>
  );
}

function NumberField(props: {
  label: string;
  hint: string;
  value: number;
  min: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[11px] uppercase text-mute">{props.label}</span>
      <input
        type="number"
        min={props.min}
        step={props.step}
        value={props.value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" || raw === "-") {
            props.onChange(props.min);
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          props.onChange(n < props.min ? props.min : n);
        }}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n < props.min) props.onChange(props.min);
        }}
        className="w-full rounded border border-line bg-ink-800 px-3 py-2 font-mono text-sm"
      />
      <p className="text-[11px] text-mute">{props.hint}</p>
    </label>
  );
}