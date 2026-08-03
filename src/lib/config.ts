// Client-visible configuration (browser needs NEXT_PUBLIC_*). Defaults are
// the verified covenant testnet — NEVER mainnet (brief D10/T4).

export const NETWORK_ID =
  process.env.NEXT_PUBLIC_KASPA_NETWORK_ID || "testnet-10";

if (!NETWORK_ID.startsWith("testnet")) {
  // Mainnet is out of scope for this entire brief; refuse to boot into it.
  throw new Error(
    `ASK reference client is testnet-only (D10); refusing network "${NETWORK_ID}"`
  );
}

/** Optional pinned wRPC endpoint; empty → SDK public-node resolver. */
export const WRPC_URL = process.env.NEXT_PUBLIC_KASPA_WRPC_URL || undefined;

/** Explorer base for C4 links (tn10.kaspa.stream confirmed working). */
const EXPLORER_TX_BASE =
  process.env.NEXT_PUBLIC_EXPLORER_TX_URL_BASE || "https://tn10.kaspa.stream/txs/";

export function explorerTxUrl(txid: string): string {
  return `${EXPLORER_TX_BASE}${txid}`;
}

/** DAA cadence, scores/second (finding F5: ~10/s on TN10 — approximate;
 * used only for deadline pickers and countdown display, never enforcement). */
export const DAA_PER_SECOND = 10n;

export const SOMPI_PER_KAS = 100_000_000n;

/** Format sompi as a KAS string for display (never float math on money). */
export function formatKas(sompi: bigint): string {
  const whole = sompi / SOMPI_PER_KAS;
  const frac = sompi % SOMPI_PER_KAS;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(8, "0").replace(/0+$/, "")}`;
}

/** Parse a user-entered KAS amount into sompi. Throws on bad input. */
export function parseKas(input: string): bigint {
  const m = input.trim().match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!m) throw new Error("enter an amount like 12 or 0.5");
  return BigInt(m[1]) * SOMPI_PER_KAS + BigInt((m[2] ?? "").padEnd(8, "0") || "0");
}
