"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
      <div className="w-full max-w-md rounded border border-danger/40 bg-ink-800 p-6">
        <h2 className="font-mono text-lg text-danger">Something went wrong</h2>
        <p className="mt-2 text-sm text-mute">
          The dashboard hit an unexpected error. Your positions and settings are stored locally
          and are safe.
        </p>
        {error.message && (
          <pre className="mt-3 max-h-40 overflow-auto rounded bg-ink-900 p-3 font-mono text-[11px] text-danger">
            {error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded bg-neon px-4 py-2 font-mono text-sm text-ink-950"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
