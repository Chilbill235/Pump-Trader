"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { notify } from "./NotificationProvider";

export type HttpErrorCode = 400 | 401 | 403 | 404 | 429 | 500 | 502 | 503 | 504;

type CodeMeta = {
  title: string;
  level: "warn" | "danger" | "info";
  what: string;
  causes: string[];
  fixes: string[];
};

export const HTTP_ERROR_META: Record<number, CodeMeta> = {
  400: {
    title: "Bad Request",
    level: "warn",
    what: "The app sent a request the server couldn't understand — usually a malformed mint address, an invalid amount, or a truncated URL parameter.",
    causes: ["A copy-pasted mint address was cut off or has invalid characters", "A trade amount was empty, negative, or not a number", "An API parameter was missing or malformed"],
    fixes: ["Re-enter the value — check the mint address is complete (44 characters)", "Refresh the page to reset the form state", "If a link brought you here, open it from inside the app"],
  },
  401: {
    title: "Unauthorized",
    level: "warn",
    what: "You need to be signed in (or your account got locked) for this action. Accounts auto-lock after 15 minutes of inactivity — that's a security feature.",
    causes: ["The account auto-locked after inactivity", "You switched accounts and the previous session ended", "An upstream API key was rejected"],
    fixes: ["Unlock your account from the login screen", "Reconnect your wallet if the action needs signing", "Retry the action after unlocking"],
  },
  403: {
    title: "Forbidden",
    level: "danger",
    what: "The server understood the request but refuses to authorize it. For API proxies this usually means a rate-limited or invalid API key, or a blocked resource host.",
    causes: ["An upstream API key is missing, expired, or rate-limited", "The requested host isn't on the security allowlist", "The upstream service banned this deployment's IP"],
    fixes: ["Wait a minute and retry — most 403s from APIs are temporary", "Check that API key env vars are set correctly on the deployment", "If it persists, the deployment may be blocked upstream"],
  },
  404: {
    title: "Page Not Found",
    level: "info",
    what: "This page doesn't exist. Either the link is stale, the coin page was mistyped, or the route was removed in an update.",
    causes: ["A bookmark or shared link points to a removed route", "A coin mint in the URL was mistyped", "The app was updated and the route changed"],
    fixes: ["Use the Markets page to find the coin again", "Check the URL for typos (coin pages look like /coin/<mint>)", "Your data is safe — this only affects navigation"],
  },
  429: {
    title: "Too Many Requests",
    level: "warn",
    what: "Rate limited. The app (or its API proxies) sent more requests than the upstream allows in a time window. The app already caches and retries with backoff, but bursts can still trip limits.",
    causes: ["Public Solana RPC rate limit hit (free endpoints are strict)", "pump.fun or Jupiter API burst limit exceeded", "Multiple tabs open, each polling independently"],
    fixes: ["Wait ~30–60 seconds — limits reset automatically", "Close extra tabs of the app", "Set a paid RPC (e.g. Helius) in Settings → RPC & Network"],
  },
  500: {
    title: "Internal Server Error",
    level: "danger",
    what: "Something crashed on the server side while handling this request. This is a bug or an unexpected upstream response — not something you did.",
    causes: ["An unhandled exception in a server route", "An upstream API returned an unexpected response shape", "A deployment is mid-update"],
    fixes: ["Retry in a moment", "Reload the page — local state (positions, settings) is safe", "If it repeats, check the deployment logs"],
  },
  502: {
    title: "Bad Gateway",
    level: "danger",
    what: "The app's server route reached an upstream API (Solana RPC, pump.fun, or Jupiter) and got an invalid response or nothing at all. All proxies try multiple endpoints before giving up — this means every fallback failed.",
    causes: ["All upstream endpoints are down or unreachable", "A network/firewall/VPN is blocking the upstream hosts", "The upstream is having an outage"],
    fixes: ["Retry in a minute — endpoints recover on their own", "Disable VPN/proxy if one is active, or try another network", "Check status pages for Solana RPC / Jupiter / pump.fun"],
  },
  503: {
    title: "Service Unavailable",
    level: "danger",
    what: "An upstream service is temporarily unavailable — usually maintenance or overload. Unlike 502, the server answered but can't handle requests right now.",
    causes: ["Upstream maintenance window", "Solana network congestion", "Provider is overloaded (throttling new connections)"],
    fixes: ["Wait and retry — almost always temporary", "Avoid live trades until the service recovers", "Paper-trade mode keeps working for testing strategy"],
  },
  504: {
    title: "Gateway Timeout",
    level: "danger",
    what: "An upstream service took too long to answer and the request timed out. The app uses short timeouts on purpose so the UI never hangs — this one gave up waiting.",
    causes: ["Slow or congested upstream API", "Large request that took too long to process", "Network latency spike on your connection"],
    fixes: ["Retry once — transient latency is the usual cause", "Check your own connection speed", "For large sells, try a smaller size to reduce quote time"],
  },
};

type Diagnostics = {
  path: string;
  time: string;
  referrer: string;
  online: boolean;
  viewport: string;
  language: string;
  hasAccount: boolean;
  isPwa: boolean;
};

function collectDiagnostics(): Diagnostics {
  if (typeof window === "undefined") {
    return { path: "—", time: "—", referrer: "—", online: true, viewport: "—", language: "—", hasAccount: false, isPwa: false };
  }
  return {
    path: window.location.pathname + window.location.search,
    time: new Date().toLocaleString(),
    referrer: document.referrer || "(direct)",
    online: navigator.onLine,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    language: navigator.language,
    hasAccount: Object.keys(window.localStorage).some((k) => k.startsWith("pump-trader:acct:")),
    isPwa: window.matchMedia("(display-mode: standalone)").matches,
  };
}

export function HttpErrorView({ code, note }: { code: HttpErrorCode; note?: string }) {
  const meta = HTTP_ERROR_META[code];
  const diagRef = useRef<Diagnostics | null>(null);
  const notifiedRef = useRef(false);

  useEffect(() => {
    // Pull diagnostics once on mount and push this error into the
    // notification center (deduped by key so reloads don't spam).
    const d = collectDiagnostics();
    diagRef.current = d;
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    notify({
      level: meta.level,
      category: "system",
      persistent: true,
      key: `http-error:${code}:${d.path}`,
      title: `${code} · ${meta.title}`,
      body: `${meta.what}${d.online ? "" : " (You appear to be offline.)"}`,
      href: code === 404 ? "/" : undefined,
      actions: [
        { id: "home", label: "Go home", href: "/", tone: "primary" },
        { id: "retry", label: "Retry", handler: "dismiss" },
      ],
    });
  }, [code, meta]);

  const d = diagRef.current;
  const toneText = meta.level === "danger" ? "text-danger" : meta.level === "warn" ? "text-warn" : "text-info";
  const toneBorder = meta.level === "danger" ? "border-danger/40" : meta.level === "warn" ? "border-warn/40" : "border-info/40";
  const glow =
    meta.level === "danger"
      ? "from-danger/20 via-danger/5"
      : meta.level === "warn"
        ? "from-warn/20 via-warn/5"
        : "from-info/20 via-info/5";

  return (
    <main className="relative grid min-h-[calc(100dvh-56px)] place-items-center overflow-hidden px-4 py-10">
      <div aria-hidden className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${glow} to-transparent`} />
      <div className="relative w-full max-w-2xl space-y-4">
        {/* Hero code */}
        <div className="text-center">
          <p className={`font-mono text-[clamp(4rem,18vw,9rem)] font-bold leading-none ${toneText}`} style={{ textShadow: "0 0 40px currentColor" }}>
            {code}
          </p>
          <h1 className="mt-2 font-mono text-xl font-semibold text-white">{meta.title}</h1>
          {note ? <p className="mt-1 font-mono text-xs text-mute">{note}</p> : null}
        </div>

        {/* What happened */}
        <section className={`rounded-xl border ${toneBorder} glass p-4`}>
          <p className="font-mono text-[10px] uppercase tracking-widest text-mute">What happened</p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-200">{meta.what}</p>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Likely causes */}
          <section className="rounded-xl border border-line glass p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-mute">Likely causes</p>
            <ul className="mt-2 space-y-1.5">
              {meta.causes.map((c) => (
                <li key={c} className="flex gap-2 text-xs text-mute">
                  <span aria-hidden className={toneText}>▸</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* What you can do */}
          <section className="rounded-xl border border-line glass p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-mute">What you can do</p>
            <ul className="mt-2 space-y-1.5">
              {meta.fixes.map((f) => (
                <li key={f} className="flex gap-2 text-xs text-mute">
                  <span aria-hidden className="text-neon">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Diagnostics */}
        <section className="rounded-xl border border-line glass p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-mute">Diagnostics (included in your notification log)</p>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-[11px] sm:grid-cols-2">
            {[
              ["Path", d?.path ?? "—"],
              ["Time", d?.time ?? "—"],
              ["Connection", d ? (d.online ? "online" : "offline") : "—"],
              ["Came from", d?.referrer ?? "—"],
              ["Viewport", d?.viewport ?? "—"],
              ["Language", d?.language ?? "—"],
              ["Account loaded", d ? (d.hasAccount ? "yes" : "no") : "—"],
              ["Installed PWA", d ? (d.isPwa ? "yes" : "no") : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line/40 py-0.5">
                <dt className="text-mute">{k}</dt>
                <dd className="min-w-0 truncate text-right text-zinc-200">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Actions */}
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="press min-h-11 rounded-lg border border-neon/50 bg-neon/10 px-6 py-2.5 font-mono text-sm font-semibold text-neon hover:bg-neon/20"
          >
            ↻ Retry
          </button>
          <Link
            href="/"
            className="press flex min-h-11 items-center rounded-lg border border-line bg-ink-850 px-6 py-2.5 font-mono text-sm text-mute hover:border-neon hover:text-neon"
          >
            Markets
          </Link>
          <Link
            href="/positions"
            className="press flex min-h-11 items-center rounded-lg border border-line bg-ink-850 px-6 py-2.5 font-mono text-sm text-mute hover:border-neon hover:text-neon"
          >
            Positions
          </Link>
        </div>

        <p className="text-center text-[11px] text-mute-2">
          Your positions, settings, and trade history are stored locally and were not affected.
        </p>
      </div>
    </main>
  );
}
