"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_RPC, PUBLIC_RPC_WARNING } from "@/lib/constants";
import { isPublicRpc } from "@/lib/settings";
import { useSettings } from "./SettingsProvider";
import { useActiveAccountId } from "./AccountsProvider";
import { getAccountPrefix } from "@/lib/accounts";
import { useNotifications } from "./NotificationProvider";

type Section = {
  id: string;
  title: string;
  description?: string;
  match: (s: string) => boolean;
};

const SECTIONS: Section[] = [
  { id: "rpc", title: "RPC & Network", match: () => true },
  { id: "trade", title: "Trading", match: (s) => /slip|simul|trade|auto|wallet|hold/i.test(s) },
  { id: "watch", title: "Watch pipeline", match: (s) => /pipeline|score|curve|buyer|age|metadata|watch/i.test(s) },
  { id: "position", title: "Position rules", match: (s) => /take|stop|tp|sl|profit|loss/i.test(s) },
  { id: "data", title: "Data & backup", match: (s) => /export|import|backup|data/i.test(s) },
  { id: "danger", title: "Emergency", match: () => true },
];

export function SettingsView() {
  const { settings, update } = useSettings();
  const accountId = useActiveAccountId();
  const notif = useNotifications();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setSavedAt(Date.now());
    const id = setTimeout(() => setSavedAt((v) => (v && Date.now() - v > 1500 ? v : null)), 1600);
    return () => clearTimeout(id);
  }, [settings]);

  const visibleSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => s.match(q) || s.title.toLowerCase().includes(q));
  }, [search]);

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
    <div className="mx-auto max-w-2xl space-y-4 pb-20">
      <header className="space-y-2">
        <div>
          <h1 className="font-mono text-lg tracking-wide">Settings</h1>
          <p className="text-xs text-mute">
            Stored in this browser only, scoped to your account. No custodial backend. Never paste a
            private key.
          </p>
          <p
            className={`mt-1 font-mono text-[11px] transition-opacity ${
              savedAt ? "text-neon opacity-100" : "text-mute opacity-60"
            }`}
          >
            {savedAt ? "✓ autosaved" : "autosaves as you type"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings…"
            className="min-w-0 flex-1 rounded border border-line bg-ink-800 px-3 py-2 font-mono text-sm"
          />
          <label className="flex items-center gap-1 rounded border border-line bg-ink-800 px-2 py-1 font-mono text-[11px] text-mute">
            <input
              type="checkbox"
              checked={advanced}
              onChange={(e) => setAdvanced(e.target.checked)}
              className="accent-neon"
            />
            Advanced
          </label>
        </div>
      </header>

      {/* RPC & Network */}
      {visibleSections.some((s) => s.id === "rpc") ? (
        <Section
          title="RPC & Network"
          desc="The Solana RPC endpoint the app talks to. Use a private one (Helius, Triton, QuickNode) to avoid 403/429s."
        >
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
            {isPublicRpc(settings.rpcUrl) ? (
              <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">
                {PUBLIC_RPC_WARNING}
              </p>
            ) : null}
          </label>
          {notif.permission !== "granted" ? (
            <button
              type="button"
              onClick={() => void notif.requestPushPermission()}
              className="press w-full rounded border border-neon/40 bg-neon/10 px-3 py-2 text-left font-mono text-xs text-neon hover:bg-neon/20"
            >
              🔔 Enable browser push notifications
            </button>
          ) : (
            <p className="rounded border border-neon/40 bg-neon/5 p-2 text-[11px] text-neon">
              ✓ Push notifications enabled. You&apos;ll hear about TP/SL hits, bot events, and trades.
            </p>
          )}
        </Section>
      ) : null}

      {/* Trading */}
      {visibleSections.some((s) => s.id === "trade") ? (
        <Section title="Trading" desc="Defaults that apply to every trade and every chart.">
          <NumberField
            label="Slippage %"
            hint="Default 5%. Any positive value allowed."
            value={settings.slippagePct}
            min={0.1}
            step={0.1}
            onChange={(v) => update({ slippagePct: v })}
          />
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
        </Section>
      ) : null}

      {/* Pipeline */}
      {visibleSections.some((s) => s.id === "watch") ? (
        <Section title="Watch pipeline" desc="Heuristic scan of newest launches.">
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
          {advanced ? (
            <>
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
                hint="Do not open more than this many positions at once (default 5)."
                value={settings.maxOpenPositions}
                min={1}
                step={1}
                onChange={(v) => update({ maxOpenPositions: Math.round(v) })}
              />
              <NumberField
                label="daily_loss_limit"
                hint="Do not queue if today's pipeline spend + realized loss ≥ this SOL (default 0.3)."
                value={settings.dailyLossLimit}
                min={0}
                step={0.0001}
                onChange={(v) => update({ dailyLossLimit: v })}
              />
              <NumberField
                label="unique_buyers min"
                hint="Basic filter (default 5)."
                value={settings.minUniqueBuyers}
                min={0}
                step={1}
                onChange={(v) => update({ minUniqueBuyers: Math.round(v) })}
              />
              <NumberField
                label="bonding_curve_pct max"
                hint="Still-early filter (default 40)."
                value={settings.maxBondingCurvePct}
                min={0}
                step={1}
                onChange={(v) => update({ maxBondingCurvePct: v })}
              />
              <NumberField
                label="age_minutes min"
                hint="Must survive the first N minutes (default 2)."
                value={settings.minAgeMinutes}
                min={0}
                step={0.5}
                onChange={(v) => update({ minAgeMinutes: v })}
              />
            </>
          ) : null}
        </Section>
      ) : null}

      {/* Position rules */}
      {visibleSections.some((s) => s.id === "position") ? (
        <Section title="Position rules" desc="TP/SL defaults applied to new positions.">
          <NumberField
            label="Take profit %"
            hint="Auto-sell when unrealized gain reaches this."
            value={settings.takeProfitPct}
            min={0.1}
            step={0.5}
            onChange={(v) => update({ takeProfitPct: v })}
          />
          <NumberField
            label="Stop loss %"
            hint="Auto-sell when unrealized loss reaches this."
            value={settings.stopLossPct}
            min={0.1}
            step={0.5}
            onChange={(v) => update({ stopLossPct: v })}
          />
        </Section>
      ) : null}

      {/* Data */}
      {visibleSections.some((s) => s.id === "data") ? (
        <Section title="Data & backup" desc="Export or import your account backup.">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportData}
              className="press rounded border border-line bg-ink-800 px-3 py-2 font-mono text-xs hover:border-neon hover:text-neon"
            >
              Export backup
            </button>
            <label className="press cursor-pointer rounded border border-line bg-ink-800 px-3 py-2 font-mono text-xs hover:border-neon hover:text-neon">
              Import backup
              <input type="file" accept="application/json" onChange={importData} className="hidden" />
            </label>
          </div>
        </Section>
      ) : null}

      {/* Emergency */}
      {visibleSections.some((s) => s.id === "danger") ? (
        <Section title="Emergency stop" desc="Disable auto-trade immediately.">
          <button
            type="button"
            onClick={() => update({ autoTrade: false, autoSell: false })}
            className="press w-full rounded bg-danger px-4 py-2.5 font-mono text-sm font-semibold text-white hover:bg-danger/80"
          >
            STOP ALL AUTO TRADING
          </button>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-line bg-ink-800 p-3">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-sm tracking-wide">{title}</h2>
        {desc ? <p className="text-[11px] text-mute">{desc}</p> : null}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
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