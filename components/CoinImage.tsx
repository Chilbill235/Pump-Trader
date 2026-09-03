"use client";

import Image from "next/image";
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

  const isHttp = src.startsWith("http://") || src.startsWith("https://");
  const isIpfsGateway =
    isHttp &&
    /(^|\.)(ipfs\.io|pinata\.cloud|cloudflare-ipfs\.com|nftstorage\.link|cf-ipfs\.com|magenta\.imaginative-banana\.ts\.net|dweb\.link|ipfs\.sloppyta\.com)\//i.test(
      src,
    );
  const proxied =
    isHttp && !isIpfsGateway
      ? src
      : `/api/img?u=${encodeURIComponent(src)}`;

  return (
    <Image
      src={proxied}
      alt={alt}
      width={size}
      height={size}
      unoptimized
      className={`shrink-0 rounded object-cover ${className ?? ""}`}
      style={{ width: size, height: size }}
      onError={() => setErrored(true)}
    />
  );
}