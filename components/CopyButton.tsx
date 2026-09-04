"use client";

import { useEffect, useRef, useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [errored, setErrored] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function copy() {
    setErrored(false);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback for environments without the async Clipboard API.
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("copy failed");
      }
      setCopied(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setErrored(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setErrored(false), 1500);
    }
  }

  return (
    <button
      type="button"
      aria-live="polite"
      onClick={copy}
      className={`rounded border px-2 py-0.5 font-mono text-[11px] ${
        errored
          ? "border-danger/60 text-danger"
          : copied
            ? "border-neon/60 text-neon"
            : "border-line text-mute hover:border-neon hover:text-neon"
      }`}
    >
      {errored ? "failed" : copied ? "copied" : label}
    </button>
  );
}
