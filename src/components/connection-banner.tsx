"use client";
// Surface node-connection failures honestly (Phase 4 error-state polish):
// public TN10 nodes are flaky (finding F4) — when every retry fails, say
// so calmly and offer a retry instead of leaving screens silently stale.
import { useChain } from "@/lib/chain";

export function ConnectionBanner() {
  const { rpcStatus, rpcError, retry } = useChain();
  if (rpcStatus !== "error") return null;
  return (
    <div className="w-full max-w-2xl mx-auto px-4 pb-4">
      <div className="border border-warn/40 rounded-lg px-4 py-3 text-sm text-warn flex items-center gap-3 bg-background">
        <span className="flex-1">
          Can&apos;t reach a testnet node right now — statuses may be stale.
          {rpcError ? ` (${rpcError})` : ""}
        </span>
        <button
          onClick={retry}
          className="shrink-0 px-3 py-1 rounded-md border border-warn/40 hover:bg-warn/10 text-xs"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
