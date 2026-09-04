"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function QuickMintFAB({ visible }: { visible: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const term = value.trim();
    if (!term) {
      setError("Paste a mint or paste a pump.fun URL.");
      return;
    }
    // Accept full pump.fun URL or coin address path
    const m = term.match(/pump\.fun\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})/i);
    if (m) {
      router.push(`/coin/${m[1]}`);
      setOpen(false);
      return;
    }
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(term)) {
      router.push(`/coin/${term}`);
      setOpen(false);
      return;
    }
    setError("Doesn't look like a Solana mint address (32-44 base58 chars).");
  }

  if (!visible) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press fixed bottom-[calc(env(safe-area-inset-bottom)+88px)] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-neon/50 bg-gradient-to-br from-neon to-emerald-400 text-ink-950 shadow-[0_8px_30px_rgba(57,255,136,0.5)] transition-transform hover:scale-105 active:scale-95 sm:hidden"
        aria-label="Quick trade · paste mint"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <div
          className="fade-in fixed inset-0 z-50 sm:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Quick trade"
        >
          <button
            type="button"
            className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-label="Close"
          />
          <div className="slide-up absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line-soft bg-ink-900 p-4 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-neon">Quick trade</p>
                <p className="font-mono text-sm">Paste a mint to open</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="press flex h-9 w-9 items-center justify-center rounded-md border border-line bg-ink-800 text-mute hover:border-neon hover:text-neon"
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <form onSubmit={submit} className="space-y-2">
              <textarea
                ref={inputRef as never}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                rows={2}
                placeholder="Paste mint or https://pump.fun/coin/…"
                className="block w-full resize-none rounded-lg border border-line bg-ink-850 px-3 py-2.5 font-mono text-sm outline-none focus:border-neon"
              />
              {error ? (
                <p className="rounded-md border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-[11px] text-danger">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="press flex-1 rounded-lg border border-line bg-ink-800 px-3 py-2.5 font-mono text-sm text-mute hover:border-danger hover:text-danger"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="press flex-1 rounded-lg border border-neon/40 bg-gradient-to-br from-neon to-emerald-400 px-3 py-2.5 font-mono text-sm font-semibold text-ink-950 shadow-[0_0_18px_rgba(57,255,136,0.35)]"
                >
                  Open
                </button>
              </div>
            </form>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                { label: "Use clipboard", run: async () => {
                  try {
                    const t = await navigator.clipboard.readText();
                    setValue(t);
                    setError(null);
                  } catch {
                    setError("Clipboard access denied.");
                  }
                } },
              ].map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={a.run}
                  className="press rounded-md border border-line bg-ink-850 px-2.5 py-1.5 font-mono text-[11px] text-mute hover:border-neon hover:text-neon"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
