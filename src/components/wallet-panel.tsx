"use client";
import { useEffect, useState } from "react";
import {
  PRIVATE_KEY_RE,
  sanitizeKeyInput,
  useWallet,
  hasExportedBackup,
  markBackupExported,
} from "@/lib/wallet";
import { ShareAsk } from "./share-ask";
import { ContactsList } from "./contacts-list";
import { useChain } from "@/lib/chain";
import { formatKas } from "@/lib/config";

export function WalletPanel({ onClose }: { onClose: () => void }) {
  const { wallet, generate, importKey, disconnect } = useWallet();
  const { getRpc } = useChain();
  const [importValue, setImportValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live format check (beta finding): quotes/whitespace from JSON pastes
  // are stripped automatically; Import enables only on a plausible key.
  const cleanedKey = sanitizeKeyInput(importValue);
  const keyLooksValid = PRIVATE_KEY_RE.test(cleanedKey);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [copied, setCopied] = useState(false);
  // F26 — key export/backup state.
  const [revealed, setRevealed] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  // Bumped whenever a backup is exported, so the Disconnect warning
  // re-reads storage and reflects an export the user just performed.
  const [backupTick, setBackupTick] = useState(0);

  // Derived at render, not synchronised through an effect: this is a read
  // of external state, and the panel only renders client-side once a
  // wallet is connected.
  const backedUp =
    wallet && typeof window !== "undefined"
      ? hasExportedBackup(wallet.address)
      : false;
  void backupTick; // re-read trigger

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
    // z-40 lifts the panel above the scrim (z-30) inside the header's
    // stacking context — B6 regression: with z-auto the scrim covered the
    // panel and swallowed every inside click.
    <div className="w-full glass-deep border-b border-white/10 relative z-40">
      {/* Visible close affordance at the TOP — the bottom "Close" link is
          below the fold on mobile once the share block renders. */}
      <button
        onClick={onClose}
        aria-label="Close wallet panel"
        className="absolute top-2 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-white/5 text-lg"
      >
        ✕
      </button>
      <div className="max-w-2xl mx-auto px-4 py-4 pr-10 text-sm space-y-3">
        {wallet ? (
          <>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="text-muted">Address</span>
              <code className="font-mono text-xs break-all min-w-0">{wallet.address}</code>
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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
            <ShareAsk address={wallet.address} />
            <ContactsList />

            {/* F26 — before this existed there was NO way to get the key
                out of the browser. A created wallet had no user-held
                backup, so Disconnect, clearing site data, or any browser
                reset destroyed the funds irreversibly, with no attacker
                involved. */}
            <div className="space-y-2 pt-3 border-t border-white/10">
              <p className="text-xs text-muted leading-relaxed">
                <strong className="text-e8">Back up your key.</strong> It
                exists only in this browser. If you clear site data, use a
                different browser, or disconnect, it is gone — and so is
                anything it holds. No one can recover it for you.
              </p>
              {!revealed ? (
                <button
                  onClick={() => {
                    setRevealed(true);
                    markBackupExported(wallet.address);
                    setBackupTick((n) => n + 1);
                  }}
                  className="text-xs px-3 py-1.5 rounded-md border border-teal/40 text-teal hover:bg-teal/10"
                >
                  Reveal private key
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-warn">
                    Anyone with these characters controls this wallet. Do not
                    screenshot or paste it anywhere online.
                  </p>
                  <code className="block break-all bg-card-raised border border-warn/40 rounded-md px-2 py-2 font-mono text-[11px] select-all">
                    {wallet.privateKey}
                  </code>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(wallet.privateKey);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        } catch {
                          /* clipboard blocked — the key is on screen to copy */
                        }
                      }}
                      className="text-xs text-teal hover:underline"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                    <button
                      onClick={() => {
                        const blob = new Blob(
                          [
                            `Kaskly wallet backup\n` +
                              `address: ${wallet.address}\n` +
                              `private key: ${wallet.privateKey}\n\n` +
                              `Anyone with this key controls the wallet. Keep it offline.\n`,
                          ],
                          { type: "text/plain" }
                        );
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `kaskly-backup-${wallet.address.slice(-8)}.txt`;
                        a.click();
                        URL.revokeObjectURL(url);
                        markBackupExported(wallet.address);
                        setBackupTick((n) => n + 1);
                      }}
                      className="text-xs text-teal hover:underline"
                    >
                      Download backup
                    </button>
                    <button
                      onClick={() => setRevealed(false)}
                      className="text-xs text-muted hover:underline"
                    >
                      Hide
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-white/10">
              {/* F25 — Disconnect used to be one unconfirmed click, so two
                  clickjacked clicks destroyed the wallet. Confirmation is
                  defence-in-depth behind the frame-ancestors CSP. */}
              {!confirmingDisconnect ? (
                <button
                  onClick={() => setConfirmingDisconnect(true)}
                  className="text-xs text-danger hover:underline"
                >
                  Disconnect (forgets the key in this browser)
                </button>
              ) : (
                <div className="space-y-2 w-full">
                  <p className="text-xs text-danger leading-relaxed">
                    {backedUp
                      ? "This erases the key from this browser. You exported a backup earlier — make sure you still have it, because this cannot be undone."
                      : "⚠ You have NEVER exported this key. Erasing it destroys this wallet and anything it holds, permanently. Reveal and save the key first."}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => {
                        disconnect();
                        onClose();
                      }}
                      className="text-xs px-3 py-1.5 rounded-md bg-danger/20 border border-danger/50 text-danger"
                    >
                      {backedUp ? "Yes, disconnect" : "Disconnect anyway — I accept losing it"}
                    </button>
                    <button
                      onClick={() => setConfirmingDisconnect(false)}
                      className="text-xs text-muted hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
                disabled={busy || !keyLooksValid}
                onClick={() => run(() => importKey(importValue))}
                className="px-3 py-1.5 rounded-md border border-border text-xs text-muted hover:text-foreground disabled:opacity-50"
              >
                Import
              </button>
            </div>
            {importValue.trim() && !keyLooksValid && (
              <p className="text-warn text-xs">
                A private key is 64 hex characters — this looks like{" "}
                {cleanedKey.length} {/[^0-9a-fA-F]/.test(cleanedKey) ? "with non-hex characters" : ""}
                . Quotes and spaces are removed automatically.
              </p>
            )}
            {error && <p className="text-danger text-xs">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
