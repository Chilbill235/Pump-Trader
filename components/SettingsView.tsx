"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_RPC, PUBLIC_RPC_WARNING } from "@/lib/constants";
import { isPublicRpc, DEFAULT_SETTINGS } from "@/lib/settings";
import { useSettings } from "./SettingsProvider";
import { useActiveAccountId } from "./AccountsProvider";
import { getAccountPrefix } from "@/lib/accounts";
import { useNotifications, notify } from "./NotificationProvider";
import { useWalletData } from "./WalletDataProvider";
import { autoTuneSettings, profileLabel, type TuneProfile } from "@/lib/autotune";

type Section = {
  id: string;
  title: string;
  description?: string;
  match: (s: string) => boolean;
};

const SECTIONS: Section[] = [
  { id: "rpc", title: "RPC & Network", match: () => true },
  { id: "trading", title: "Trading", match: (s) => /slip|simul|trade|auto|wallet|hold/i.test(s) },
  { id: "watch", title: "Watch pipeline", match: (s) => /pipeline|score|curve|buyer|age|metadata|watch/i.test(s) },
  { id: "position", title: "Position rules", match: (s) => /take|stop|tp|sl|profit|loss/i.test(s) },
  { id: "data", title: "Data & backup", match: (s) => /export|import|backup|data/i.test(s) },
  { id: "emergency", title: "Emergency stop", match: () => true },
];

export function SettingsView() {
  const { settings, update } = useSettings();
  const accountId = useActiveAccountId();
  const notif = useNotifications();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [rpcTest, setRpcTest] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [rpcLatency, setRpcLatency] = useState<number | null>(null);
  const [tuneProfile, setTuneProfile] = useState<TuneProfile>("balanced");
  const [tuneResult, setTuneResult] = useState<ReturnType<typeof autoTuneSettings> | null>(null);
  const walletData = useWalletData();
  const recPatch = useMemo(() => autoTuneSettings(walletData.sol ?? 0, "balanced").patch, [walletData.sol]);

  const jumpTo = (id: string) => {
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const testRpc = async () => {
    if (!/^https?:\/\//i.test(settings.rpcUrl)) {
      setRpcTest("fail");
      return;
    }
    setRpcTest("testing");
    const started = performance.now();
    try {
      const res = await fetch(settings.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getVersion" }),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { result?: { "solana-core"?: string } };
      if (!json?.result?.["solana-core"]) throw new Error("unexpected response");
      setRpcLatency(Math.round(performance.now() - started));
      setRpcTest("ok");
    } catch {
      setRpcLatency(null);
      setRpcTest("fail");
    }
  };

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
          notify({
            title: "Account locked",
            body: "Unlock your account before importing a backup.",
            level: "warn",
            category: "system",
          });
          return;
        }
        for (const [sub, value] of Object.entries(data)) {
          if (typeof sub !== "string") continue;
          window.localStorage.setItem(prefix + sub, JSON.stringify(value));
        }
        notify({
          title: "Backup imported",
          body: `${Object.keys(data).length} entries restored. Reloading…`,
          level: "success",
          category: "system",
        });
        setTimeout(() => window.location.reload(), 800);
      } catch {
        notify({
          title: "Invalid backup file",
          body: "Could not parse the JSON backup.",
          level: "danger",
          category: "system",
        });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20">
      <header className="space-y-2">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            <span className="text-gradient-warm">Settings</span>
          </h1>
          <p className="text-xs text-mute sm:text-sm">
            Stored in this browser only, scoped to your account. No custodial backend. Never paste a
            private key.
          </p>
          <p
            className={`mt-1 flex items-center gap-1 font-mono text-[11px] transition-opacity ${
              savedAt ? "text-neon opacity-100" : "text-mute opacity-60"
            }`}
          >
            {savedAt ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path
                  d="M2.5 6.5L5 9L9.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
            {savedAt ? "autosaved" : "autosaves as you type"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings…"
            className="min-w-0 flex-1 rounded-md border border-line bg-ink-850 px-3 py-2 font-mono text-sm focus:border-neon focus:outline-none"
          />
          <label className="press flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-md border border-line bg-ink-850 px-3 py-1.5 font-mono text-[11px] text-mute hover:border-neon hover:text-neon">
            <input
              type="checkbox"
              checked={advanced}
              onChange={(e) => setAdvanced(e.target.checked)}
              className="h-4 w-4 accent-neon"
              aria-label="Show advanced settings"
            />
            Advanced
          </label>
        </div>
        {/* Quick-nav: jump to a section without scrolling */}
        <nav className="flex flex-wrap gap-1.5" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jumpTo(s.id)}
              className={`press rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                visibleSections.some((v) => v.id === s.id)
                  ? "border-line bg-ink-850 text-mute hover:border-neon hover:text-neon"
                  : "border-line/40 bg-ink-900/60 text-mute/40"
              }`}
            >
              {s.title}
            </button>
          ))}
        </nav>
      </header>

      {/* RPC & Network */}
      {visibleSections.some((s) => s.id === "rpc") ? (
        <Section
          title="RPC & Network"
          desc="The Solana RPC endpoint the app talks to. Use a private one (Helius, Triton, QuickNode) to avoid 403/429s."
        >
          <label className="block space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-mute">RPC URL</span>
            <input
              value={settings.rpcUrl}
              onChange={(e) => {
                const v = e.target.value.trim();
                update({ rpcUrl: /^https?:\/\//i.test(v) || v === "" ? v : settings.rpcUrl });
              }}
              className="w-full rounded-md border border-line bg-ink-850 px-3 py-2 font-mono text-sm focus:border-neon focus:bg-ink-900 focus:outline-none"
            />
            <button
              type="button"
              className="press rounded text-[11px] text-mute underline hover:text-neon"
              onClick={() => update({ rpcUrl: DEFAULT_RPC })}
            >
              Reset to env / public mainnet
            </button>
            {!/^https?:\/\//i.test(settings.rpcUrl) && settings.rpcUrl !== "" && (
              <p className="rounded-md border border-danger/40 bg-danger/5 p-2 text-[11px] text-danger">Enter a valid HTTP(S) URL or reset to default.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void testRpc()}
                disabled={rpcTest === "testing"}
                className="press rounded-md border border-line bg-ink-850 px-3 py-1.5 font-mono text-[11px] text-mute hover:border-neon hover:text-neon disabled:opacity-50"
              >
                {rpcTest === "testing" ? "Testing…" : "Test connection"}
              </button>
              {rpcTest === "ok" ? (
                <span className="font-mono text-[11px] text-neon">
                  ✓ reachable{rpcLatency !== null ? ` · ${rpcLatency}ms` : ""}
                </span>
              ) : rpcTest === "fail" ? (
                <span className="font-mono text-[11px] text-danger">✗ unreachable or not a Solana RPC</span>
              ) : null}
            </div>
            {isPublicRpc(settings.rpcUrl) ? (
              <p className="rounded-md border border-warn/40 bg-warn/5 p-2 text-[11px] text-warn">
                {PUBLIC_RPC_WARNING}
              </p>
            ) : null}
          </label>
          {notif.permission !== "granted" ? (
            <button
              type="button"
              onClick={() => void notif.requestPushPermission()}
              className="press flex w-full items-center gap-2 rounded-md border border-neon/40 bg-neon/10 px-3 py-2 text-left font-mono text-xs text-neon hover:bg-neon/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M3.5 5.5C3.5 3.84 4.84 2.5 6.5 2.5H7.5C9.16 2.5 10.5 3.84 10.5 5.5V8.5L12 11H2L3.5 8.5V5.5Z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
                <path
                  d="M5.5 12.5C5.8 13.1 6.4 13.5 7 13.5C7.6 13.5 8.2 13.1 8.5 12.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              Enable browser push notifications
            </button>
          ) : (
            <p className="flex items-center gap-1 rounded-md border border-neon/40 bg-neon/5 p-2 text-[11px] text-neon">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path
                  d="M2.5 6.5L5 9L9.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Push notifications enabled. You&apos;ll hear about TP/SL hits, bot events, and trades.
            </p>
          )}
        </Section>
      ) : null}

      {/* Trading */}
      {visibleSections.some((s) => s.id === "trading") ? (
        <Section title="Trading" desc="Defaults that apply to every trade and every chart.">
          {/* Auto-tune: derive risk settings from the real wallet balance */}
          <div className="rounded-lg border border-neon/30 bg-neon/5 p-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-neon">Auto-tune</p>
            <p className="mt-1 text-[11px] text-mute">
              Pick a risk profile and this app calculates position size, open-position limits, loss
              caps, slippage, and TP/SL from your{" "}
              <span className="text-white">
                {walletData.sol != null ? `${walletData.sol.toFixed(3)} SOL` : "wallet"}
              </span>{" "}
              balance. No guesswork.
            </p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {(["safe", "balanced", "degen"] as TuneProfile[]).map((p) => {
                const meta = profileLabel(p);
                const active = tuneProfile === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setTuneProfile(p)}
                    className={`press rounded-md border p-2 text-left transition-colors ${
                      active
                        ? "border-neon bg-neon/10"
                        : "border-line bg-ink-850 hover:border-neon/50"
                    }`}
                  >
                    <span className={`block font-mono text-xs font-semibold ${active ? "text-neon" : "text-white"}`}>
                      {meta.title}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-tight text-mute">{meta.desc}</span>
                  </button>
                );
              })}
            </div>
            {tuneResult && tuneResult.patch.slippagePct != null ? (
              <div className="mt-2 space-y-1">
                {tuneResult.rationale.map((r) => (
                  <p key={r} className="text-[11px] text-mute">• {r}</p>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    update(tuneResult.patch);
                    setTuneResult(null);
                    notify({
                      title: "Settings auto-tuned",
                      body: "Trading and bot limits were recalculated for your balance.",
                      level: "success",
                      category: "system",
                    });
                  }}
                  className="press mt-1 w-full rounded-md border border-neon/50 bg-neon/10 px-3 py-2 font-mono text-xs font-semibold text-neon hover:bg-neon/20 min-h-9"
                >
                  Apply these settings
                </button>
              </div>
            ) : null}
            {!tuneResult ? (
              <button
                type="button"
                onClick={() => setTuneResult(autoTuneSettings(walletData.sol ?? 0, tuneProfile))}
                className="press mt-2 w-full rounded-md border border-line bg-ink-850 px-3 py-2 font-mono text-xs text-mute hover:border-neon hover:text-neon min-h-9"
              >
                ⚡ Calculate for my balance
              </button>
            ) : null}
          </div>
          <label className="block space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-mute">Currency</span>
            <select
              value={settings.currency}
              onChange={(e) => update({ currency: e.target.value as "SOL" | "USD" | "USDC" })}
              className="w-full rounded-md border border-line bg-ink-850 px-3 py-2 font-mono text-sm focus:border-neon focus:outline-none"
            >
              <option value="SOL">SOL</option>
              <option value="USD">USD ($)</option>
              <option value="USDC">USDC</option>
            </select>
            <p className="text-[11px] text-mute">Display currency for prices, P&L, and balances.</p>
          </label>
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
          <Toggle
            label="Notification sound / vibration"
            hint="ON by default. Play a sound or vibrate on trade fills, TP/SL hits, and bot events."
            checked={settings.notificationSound}
            onChange={(v) => update({ notificationSound: v })}
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
                hint={`Risk brake. Max cost per mint (default 0.1).${recPatch.maxPositionSol != null ? ` Recommended for your balance: ${recPatch.maxPositionSol} SOL.` : ""}`}
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
                hint={`Do not queue if today's pipeline spend + realized loss ≥ this SOL (default 0.3).${recPatch.dailyLossLimit != null ? ` Recommended for your balance: ${recPatch.dailyLossLimit} SOL.` : ""}`}
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
            hint={`Auto-sell when unrealized gain reaches this.${recPatch.takeProfitPct != null ? ` Recommended: ${recPatch.takeProfitPct}%.` : ""}`}
            value={settings.takeProfitPct}
            min={0.1}
            step={0.5}
            onChange={(v) => update({ takeProfitPct: v })}
          />
          <NumberField
            label="Stop loss %"
            hint={`Auto-sell when unrealized loss reaches this.${recPatch.stopLossPct != null ? ` Recommended: ${recPatch.stopLossPct}%.` : ""}`}
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
              className="press rounded-md border border-line bg-ink-850 px-3 py-2 font-mono text-xs text-mute hover:border-neon hover:text-neon"
            >
              Export backup
            </button>
            <label className="press flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-ink-850 px-2.5 py-2 font-mono text-[11px] text-mute hover:border-neon hover:text-neon">
            <input type="file" accept="application/json" onChange={importData} className="sr-only" aria-label="Import backup JSON file" />
            Import backup
          </label>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Reset ALL settings to defaults? Positions and trade history are kept.")) return;
                update({ ...DEFAULT_SETTINGS });
                notify({
                  title: "Settings reset",
                  body: "All settings restored to defaults.",
                  level: "info",
                  category: "system",
                });
              }}
              className="press rounded-md border border-line bg-ink-850 px-3 py-2 font-mono text-xs text-mute hover:border-warn hover:text-warn"
            >
              Reset all settings
            </button>
          </div>
        </Section>
      ) : null}

      {/* Emergency */}
      {visibleSections.some((s) => s.id === "emergency") ? (
        <Section title="Emergency stop" desc="Disable auto-trade immediately.">
          <button
            type="button"
            onClick={() => update({ autoTrade: false, autoSell: false })}
            className="press relative w-full overflow-hidden rounded-md border border-danger/50 bg-gradient-to-r from-danger to-rose-400 px-4 py-3 font-mono text-sm font-semibold text-white shadow-[0_0_18px_-4px_rgba(255,71,87,0.5)] hover:from-danger/90"
          >
            STOP ALL AUTO TRADING
          </button>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  const id = `settings-${title.toLowerCase().split(" ")[0]}`;
  return (
    <section id={id} className="scroll-mt-4 relative overflow-hidden rounded-xl border border-line glass">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft bg-ink-850/80 px-3 py-2 backdrop-blur">
        <h2 className="font-mono text-sm font-semibold tracking-wide text-white">{title}</h2>
        {desc ? <p className="text-[11px] text-mute">{desc}</p> : null}
      </header>
      <div className="space-y-3 p-3">{children}</div>
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
    <label
      className={`flex items-start justify-between gap-4 rounded-md border p-3 transition-colors ${
        props.danger
          ? props.checked
            ? "border-danger/40 bg-danger/5"
            : "border-line bg-ink-850 hover:border-danger/40"
          : props.checked
            ? "border-neon/40 bg-neon/5"
            : "border-line bg-ink-850 hover:border-neon/40"
      }`}
    >
      <span>
        <span className="block text-sm text-white">{props.label}</span>
        <span className="block text-xs text-mute">{props.hint}</span>
      </span>
      <span
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
          props.checked
            ? props.danger
              ? "bg-danger/70"
              : "bg-neon/70"
            : "bg-ink-700"
        }`}
      >
        <span
          aria-hidden
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            props.checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(e) => props.onChange(e.target.checked)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={props.label}
        />
      </span>
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
  const [draft, setDraft] = useState<string>(String(props.value));
  useEffect(() => {
    setDraft(String(props.value));
  }, [props.value]);
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[10px] uppercase tracking-widest text-mute">{props.label}</span>
      <input
        type="number"
        min={props.min}
        step={props.step}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          if (raw === "" || raw === "-" || raw === ".") return;
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          if (n < props.min) return;
          props.onChange(n);
        }}
        onBlur={() => {
          const n = Number(draft);
          if (!Number.isFinite(n)) {
            setDraft(String(props.value));
            return;
          }
          const clamped = Math.max(props.min, n);
          if (clamped !== n) setDraft(String(clamped));
          props.onChange(clamped);
        }}
        inputMode="decimal"
        className="w-full rounded-md border border-line bg-ink-850 px-3 py-2 font-mono text-sm focus:border-neon focus:bg-ink-900 focus:outline-none"
      />
      <p className="text-[11px] text-mute">{props.hint}</p>
    </label>
  );
}