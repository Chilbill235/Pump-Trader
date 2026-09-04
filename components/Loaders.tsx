"use client";

export function Skeleton({
  className = "",
  rows = 1,
}: {
  className?: string;
  rows?: number;
}) {
  return (
    <div className={className} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="mb-1 h-3 w-full animate-pulse rounded bg-ink-700/60 last:mb-0"
          style={{ width: `${Math.max(20, 100 - i * 12)}%` }}
        />
      ))}
    </div>
  );
}

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-neon border-t-transparent ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  icon?: string;
}) {
  return (
    <div className="grid place-items-center rounded border border-dashed border-line bg-ink-800/40 p-8 text-center">
      <div className="max-w-sm space-y-2">
        {icon ? <p className="text-2xl">{icon}</p> : null}
        <p className="font-mono text-sm">{title}</p>
        {body ? <p className="text-xs text-mute">{body}</p> : null}
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </div>
  );
}