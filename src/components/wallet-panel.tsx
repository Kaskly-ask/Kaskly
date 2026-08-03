"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useChain } from "@/lib/chain";
import { formatKas } from "@/lib/config";

export function WalletPanel({ onClose }: { onClose: () => void }) {
  const { wallet, generate, importKey, disconnect } = useWallet();
  const { getRpc } = useChain();
  const [importValue, setImportValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!wallet) return;
    let stop = false;
    (async () => {
      try {
        const rpc = await getRpc();
        const { balance } = await rpc.getBalanceByAddress({
          address: wallet.address,
        });
        if (!stop) setBalance(BigInt(balance));
      } catch {
        /* balance stays unknown — node unreachable */
      }
    })();
    return () => {
      stop = true;
    };
  }, [wallet, getRpc]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setImportValue("");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full border-b border-border bg-card">
      <div className="max-w-2xl mx-auto px-4 py-4 text-sm space-y-3">
        {wallet ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-muted">Address</span>
              <code className="font-mono text-xs break-all">{wallet.address}</code>
              <button
                className="text-xs text-teal hover:underline shrink-0"
                onClick={async () => {
                  await navigator.clipboard.writeText(wallet.address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-muted">Balance</span>
              <span className="amount font-semibold">
                {balance === null ? "…" : `${formatKas(balance)} TKAS`}
              </span>
              <span
                className={
                  wallet.proofOk ? "text-teal text-xs" : "text-danger text-xs"
                }
              >
                {wallet.proofOk
                  ? "✓ key ownership verified by signature"
                  : "ownership proof FAILED"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  disconnect();
                  onClose();
                }}
                className="text-xs text-danger hover:underline"
              >
                Disconnect (forgets the key in this browser)
              </button>
              <button onClick={onClose} className="text-xs text-muted hover:underline">
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted">
              Keys are generated and stored in this browser only — they never
              touch a server. Testnet keys only; never paste a mainnet key.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                disabled={busy}
                onClick={() => run(generate)}
                className="px-3 py-1.5 rounded-md bg-teal text-background font-medium text-xs disabled:opacity-50"
              >
                {busy ? "Working…" : "Create testnet wallet"}
              </button>
              <span className="text-faint text-xs">or import a private key</span>
              <input
                type="password"
                value={importValue}
                onChange={(e) => setImportValue(e.target.value)}
                placeholder="hex private key (testnet)"
                className="flex-1 min-w-48 bg-card-raised border border-border rounded-md px-2 py-1.5 font-mono text-xs"
              />
              <button
                disabled={busy || !importValue.trim()}
                onClick={() => run(() => importKey(importValue))}
                className="px-3 py-1.5 rounded-md border border-border text-xs text-muted hover:text-foreground disabled:opacity-50"
              >
                Import
              </button>
            </div>
            {error && <p className="text-danger text-xs">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
