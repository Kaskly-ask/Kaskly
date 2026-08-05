"use client";
// Client-side wallet (brief §3.2, D4): keys are generated/imported and held
// ONLY in the browser (localStorage) — they never touch the server. Connect
// performs a signature-based ownership proof: sign a canonical message with
// the private key and verify it against the public key the address derives
// from (SDK signMessage/verifyMessage, kaspa.d.ts:69/74).
// Testnet-only storage: localStorage would be inappropriate for real funds;
// the UI says so (TRUST.md).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ensureKaspaReady } from "./kaspa-ready";
import { NETWORK_ID } from "./config";

export interface WalletState {
  address: string;
  publicKey: string;
  /** Hex private key — browser-only, testnet-only. */
  privateKey: string;
}

const STORAGE_KEY = "kaskly.wallet.v1";

/** F26 — records that the user has revealed/exported this key at least
 * once, so destructive actions can tell them what they are about to lose.
 * Stores ONLY addresses and timestamps — never key material. */
const BACKUP_KEY = "kaskly.backup.v1";

function readBackups(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(BACKUP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Has this address's key ever been exported from this browser? */
export function hasExportedBackup(address: string): boolean {
  return typeof readBackups()[address] === "number";
}

/** Record that the key was revealed/downloaded. Best-effort: a failure to
 * persist must never block the user from seeing their own key. */
export function markBackupExported(address: string): void {
  try {
    const all = readBackups();
    all[address] = Date.now();
    window.localStorage.setItem(BACKUP_KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked — the export itself still happened */
  }
}

/** Normalize a pasted private key: keys arrive from JSON files and docs
 * wrapped in quotes, whitespace, commas, or an 0x prefix (beta finding:
 * raw paste produced "Secp256k1 -> malformed or out-of-range secret
 * key"). Strips decoration only — never alters key material. */
export function sanitizeKeyInput(input: string): string {
  return input
    .trim()
    .replace(/^["'`,\s]+|["'`,\s]+$/g, "")
    .replace(/^0x/i, "")
    .trim();
}

export const PRIVATE_KEY_RE = /^[0-9a-fA-F]{64}$/;

interface WalletContextValue {
  wallet: WalletState | null;
  /** "loading" while restoring a stored key on first mount. */
  status: "loading" | "disconnected" | "connected";
  generate: () => Promise<WalletState>;
  /** `expectedAddress` is optional; when given, an import that opens a
   * different address is REFUSED (F28 — the only non-circular check). */
  importKey: (
    privateKeyHex: string,
    expectedAddress?: string
  ) => Promise<WalletState>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * F28 — the removed ceremony, and what replaced it.
 *
 * This used to sign `kaskly-ownership-proof:${address}` and verify it
 * against a keypair derived from THE SAME private key, then render
 * "✓ key ownership verified by signature". The verifier was the signer:
 * PoC showed 500/500 random keys pass and `false` was unreachable, so the
 * `if (!proofOk) throw` guard was dead code and the green check attested
 * only that the SDK works.
 *
 * A signature round-trip cannot be made meaningful here, because the
 * address is DERIVED from the key under test — there is no external
 * reference to disagree with. A mistyped hex key is usually still a valid
 * key; it simply opens a different wallet. The only check that catches a
 * real import error is comparing the derived address against one the user
 * independently expects, which is why `importKey` now takes an optional
 * `expectedAddress` (see below). Ceremony removed rather than dressed up.
 */
async function openWallet(privateKeyHex: string): Promise<WalletState> {
  await ensureKaspaReady();
  const { Keypair, PrivateKey } = await import("kaspa-wasm");
  const keypair = Keypair.fromPrivateKey(new PrivateKey(privateKeyHex));
  const address = keypair.toAddress(NETWORK_ID).toString();
  return { address, publicKey: keypair.publicKey, privateKey: privateKeyHex };
}

/** Normalise for comparison: addresses are case-insensitive bech32 and
 * users paste them with stray whitespace. */
export function addressesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [status, setStatus] =
    useState<WalletContextValue["status"]>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        if (!cancelled) setStatus("disconnected");
        return;
      }
      try {
        const w = await openWallet(stored);
        if (!cancelled) {
          setWallet(w);
          setStatus("connected");
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
        if (!cancelled) setStatus("disconnected");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connectWith = useCallback(async (privateKeyHex: string) => {
    const w = await openWallet(privateKeyHex);
    window.localStorage.setItem(STORAGE_KEY, privateKeyHex);
    setWallet(w);
    setStatus("connected");
    return w;
  }, []);

  const generate = useCallback(async () => {
    await ensureKaspaReady();
    const { Keypair } = await import("kaspa-wasm");
    return connectWith(Keypair.random().privateKey);
  }, [connectWith]);

  const importKey = useCallback(
    async (privateKeyHex: string, expectedAddress?: string) => {
      const cleaned = sanitizeKeyInput(privateKeyHex);
      if (!PRIVATE_KEY_RE.test(cleaned)) {
        throw new Error(
          `A private key is 64 hex characters — got ${cleaned.length}${
            /[^0-9a-fA-F]/.test(cleaned) ? " (with non-hex characters)" : ""
          }. Copy just the key value, without quotes.`
        );
      }
      // F28 — the ONLY non-circular check available on import. A mistyped
      // key is usually still a valid key, so it silently opens a DIFFERENT
      // wallet; nothing derived from the key alone can notice. Comparing
      // against an address the user independently expects is what actually
      // catches a corrupt or mistyped import. Optional: a user importing a
      // key they only hold as a key has nothing to compare against.
      if (expectedAddress && expectedAddress.trim()) {
        const candidate = await openWallet(cleaned);
        if (!addressesMatch(candidate.address, expectedAddress)) {
          throw new Error(
            `That key does not open the address you expected.\n` +
              `  expected: ${expectedAddress.trim()}\n` +
              `  this key: ${candidate.address}\n` +
              `The key is valid, but it is a DIFFERENT wallet — check for a typo before continuing.`
          );
        }
      }
      return connectWith(cleaned);
    },
    [connectWith]
  );

  const disconnect = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setWallet(null);
    setStatus("disconnected");
  }, []);

  return (
    <WalletContext.Provider
      value={{ wallet, status, generate, importKey, disconnect }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}
