"use client";

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; scope?: string };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ""}]`, error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-ink-950 p-6 text-zinc-100">
          <div className="max-w-md space-y-3 rounded border border-danger/40 bg-danger/10 p-5">
            <p className="font-mono text-sm text-danger">Something went wrong</p>
            <p className="font-mono text-xs text-mute">{this.state.error.message}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={this.reset}
                className="press rounded border border-neon/40 bg-neon/10 px-3 py-1.5 font-mono text-xs text-neon hover:bg-neon/20"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    if (typeof window !== "undefined") {
                      window.sessionStorage.setItem("pump-trader:reload-banner", "1");
                    }
                  } catch {
                    // ignore
                  }
                  window.location.reload();
                }}
                className="press rounded border border-line bg-ink-800 px-3 py-1.5 font-mono text-xs text-mute hover:border-neon hover:text-neon"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}