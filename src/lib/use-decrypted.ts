"use client";
// Decrypt a kasia1 ciphertext with the connected wallet's key, for display.
// Returns null while decrypting or when the key cannot open the blob.
import { useEffect, useState } from "react";
import { decryptForDisplay } from "./asks-client";
import { useWallet } from "./wallet";

export function useDecrypted(ciphertextHex: string | null): string | null {
  const { wallet } = useWallet();
  const [result, setResult] = useState<{ key: string; text: string } | null>(
    null
  );

  useEffect(() => {
    let stop = false;
    if (!ciphertextHex || !wallet) return;
    decryptForDisplay(ciphertextHex, wallet.privateKey)
      .then((text) => {
        if (!stop) setResult({ key: ciphertextHex, text });
      })
      .catch(() => {
        /* not addressed to this key — stays null */
      });
    return () => {
      stop = true;
    };
  }, [ciphertextHex, wallet]);

  // Stale results for a previous ciphertext are never shown.
  return result?.key === ciphertextHex ? result.text : null;
}
