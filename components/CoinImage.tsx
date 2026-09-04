"use client";

import { useEffect, useRef, useState } from "react";

// In-memory cache of {url: true} for images that 502'd. Avoids re-trying
// the same upstream for the rest of the session and stops the browser
// from spamming the proxy when IPFS is down.
const recentlyFailed = new Set<string>();

export function CoinImage({
  src,
  alt,
  size = 28,
  className,
}: {
  src?: string | null;
  alt: string;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = useState(() => {
    if (!src) return true;
    return recentlyFailed.has(src);
  });
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setErrored(!src || recentlyFailed.has(src));
  }, [src]);

  if (!src || errored) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded bg-ink-700 font-mono text-[10px] uppercase text-mute ${
          className ?? ""
        }`}
        style={{ width: size, height: size }}
        title={alt}
      >
        {alt.slice(0, 2)}
      </div>
    );
  }

  // pump-api normalizes IPFS gateway URLs to /api/img?u=... so the browser
  // only ever hits the same-origin proxy. This avoids CORP/CORB blocks from
  // ipfs.io (which sends Cross-Origin-Resource-Policy: same-origin).
  const proxied = src.startsWith("/api/img?u=")
    ? src
    : `/api/img?u=${encodeURIComponent(src)}`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={proxied}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`shrink-0 rounded object-cover ${className ?? ""}`}
      style={{ width: size, height: size }}
      onError={() => {
        if (src) recentlyFailed.add(src);
        setErrored(true);
      }}
    />
  );
}