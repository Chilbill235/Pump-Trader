"use client";

import { useState } from "react";

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
  const [errored, setErrored] = useState(false);

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

  const proxied = `/api/img?u=${encodeURIComponent(src)}`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={proxied}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`shrink-0 rounded object-cover ${className ?? ""}`}
      style={{ width: size, height: size }}
      onError={() => setErrored(true)}
    />
  );
}