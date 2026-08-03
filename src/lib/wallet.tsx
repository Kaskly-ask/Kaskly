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
  /** Result of the connect-time sign/verify ownership proof. */
  proofOk: boolean;
}

const STORAGE_KEY = "kaskly.wallet.v1";

interface WalletContextValue {
  wallet: WalletState | null;
  /** "loading" while restoring a stored key on first mount. */
  status: "loading" | "disconnected" | "connected";
  generate: () => Promise<WalletState>;
  importKey: (privateKeyHex: string) => Promise<WalletState>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

async function openWallet(privateKeyHex: string): Promise<WalletState> {
  await ensureKaspaReady();
  const { Keypair, PrivateKey, signMessage, verifyMessage } = await import(
    "kaspa-wasm"
  );
  const keypair = Keypair.fromPrivateKey(new PrivateKey(privateKeyHex));
  const address = keypair.toAddress(NETWORK_ID).toString();
  const message = `kaskly-ownership-proof:${address}`;
  const signature = signMessage({ message, privateKey: privateKeyHex });
  const proofOk = verifyMessage({
    message,
    signature,
    publicKey: keypair.publicKey,
  });
  return { address, publicKey: keypair.publicKey, privateKey: privateKeyHex, proofOk };
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
    if (!w.proofOk) throw new Error("ownership proof failed for this key");
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
    (privateKeyHex: string) => connectWith(privateKeyHex.trim()),
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
