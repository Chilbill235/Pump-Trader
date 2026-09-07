"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useActiveAccountId, useAccounts } from "@/components/AccountsProvider";
import { loadAccountProfile, saveAccountProfile } from "@/lib/profile";
import { notify } from "@/components/NotificationProvider";
import { useSettings } from "@/components/SettingsProvider";
import { AppShell } from "@/components/AppShell";

const ACCENTS = ["#39ff88", "#0ea5e9", "#f59e0b", "#ec4899", "#a855f7", "#ef4444"];
const EMOJIS = ["🚀", "💎", "🌙", "⚡", "🔥", "🦍", "🐳", "📈", "🤖", "🎯", "👑", "🪙"];

export default function ProfilePage() {
  const accountId = useActiveAccountId();
  const { activeAccount } = useAccounts();
  const { settings, update } = useSettings();
  const [bio, setBio] = useState("");
  const [color, setColor] = useState(ACCENTS[0]);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    const p = loadAccountProfile(accountId);
    setBio(p?.bio ?? "");
    setColor(p?.color ?? ACCENTS[0]);
    setEmoji(p?.emoji ?? null);
  }, [accountId]);

  const previewInitial = useMemo(
    () => (activeAccount?.username ?? "?").slice(0, 1).toUpperCase(),
    [activeAccount],
  );

  function save() {
    if (!accountId) return;
    saveAccountProfile(accountId, {
      username: "",
      bio: bio.trim() || undefined,
      color,
      emoji: emoji ?? undefined,
      updatedAt: Date.now(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    notify({ level: "success", category: "system", title: "Profile saved", body: "Your customization is live." });
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl space-y-4 px-3 pb-24 pt-4 sm:px-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-lg font-semibold text-white">Profile</h1>
            <p className="text-xs text-mute">Make Pump Trader yours.</p>
          </div>
          <Link
            href="/settings"
            className="press rounded-md border border-line bg-ink-850 px-3 py-1.5 font-mono text-[11px] text-mute hover:border-neon hover:text-neon"
          >
            Settings →
          </Link>
        </header>

        {!accountId ? (
          <p className="rounded-md border border-warn/40 bg-warn/5 p-3 text-xs text-warn">
            Unlock your account to customize your profile.
          </p>
        ) : (
          <>
            <section className="rounded-xl border border-line glass p-4">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-mute">Live preview</p>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-2xl font-bold text-ink-950 ring-2 ring-ink-900"
                  style={{ backgroundColor: color, boxShadow: `0 0 18px ${color}66` }}
                >
                  {emoji ?? previewInitial}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-base font-semibold text-white">
                    @{activeAccount?.username ?? "—"}
                  </p>
                  <p className="truncate text-xs text-mute">{bio.trim() || "No bio yet."}</p>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-line glass p-4">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-mute">Avatar</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEmoji(null)}
                  className={`press flex h-10 w-10 items-center justify-center rounded-full border-2 font-mono text-sm font-bold ${
                    emoji === null ? "border-white" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color, color: "#05060a" }}
                  aria-label="Use initial letter"
                  aria-pressed={emoji === null}
                >
                  {previewInitial}
                </button>
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEmoji(e)}
                    className={`press flex h-10 w-10 items-center justify-center rounded-full border-2 text-xl transition-transform hover:scale-110 ${
                      emoji === e ? "border-white bg-ink-800" : "border-line bg-ink-850"
                    }`}
                    aria-label={`Avatar ${e}`}
                    aria-pressed={emoji === e}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-line glass p-4">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-mute">Accent color</p>
              <div className="flex flex-wrap items-center gap-2">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="press h-9 w-9 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? "white" : "transparent",
                      boxShadow: color === c ? `0 0 12px ${c}` : undefined,
                    }}
                    aria-label={`Accent ${c}`}
                    aria-pressed={color === c}
                  />
                ))}
                <label className="press cursor-pointer rounded-md border border-line bg-ink-850 px-3 py-2 font-mono text-[11px] text-mute hover:border-neon hover:text-neon">
                  custom
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="sr-only" />
                </label>
              </div>
            </section>

            <section className="rounded-xl border border-line glass p-4">
              <label className="block">
                <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-mute">Bio</span>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, 120))}
                  maxLength={120}
                  rows={3}
                  className="w-full resize-none rounded-md border border-line bg-ink-900 px-3 py-2 font-mono text-sm outline-none focus:border-neon"
                  placeholder="Trading style, focus, notes…"
                />
                <p className="mt-1 text-right text-[10px] text-mute-2">{bio.length}/120</p>
              </label>
            </section>

            <section className="rounded-xl border border-line glass p-4">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-mute">Quick preferences</p>
              <label className="flex items-center justify-between gap-4 rounded-md border border-line bg-ink-850 p-3">
                <span>
                  <span className="block text-sm text-white">Notification sound</span>
                  <span className="block text-xs text-mute">Play a chime for toasts and alerts.</span>
                </span>
                <span
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                    settings.notificationSound ? "bg-neon/70" : "bg-ink-700"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      settings.notificationSound ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                  <input
                    type="checkbox"
                    checked={settings.notificationSound}
                    onChange={(e) => update({ notificationSound: e.target.checked })}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="Toggle notification sound"
                  />
                </span>
              </label>
            </section>

            <button
              type="button"
              onClick={save}
              className="press w-full rounded-lg border border-neon/50 bg-gradient-to-r from-neon to-emerald-400 py-3 font-mono text-sm font-semibold text-ink-950 shadow-[0_0_18px_-4px_rgba(57,255,136,0.5)] min-h-11"
            >
              {saved ? "✓ Saved" : "Save profile"}
            </button>
          </>
        )}
      </main>
    </AppShell>
  );
}
