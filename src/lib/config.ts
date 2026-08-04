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

/** REST indexer base (kaspa-rest-server) — used to look up the spending tx
 * of a covenant and for the rebuild-from-chain path. Chain (wRPC) remains
 * the source of truth for live status. */
export const REST_API_BASE =
  process.env.NEXT_PUBLIC_KASPA_REST_API_BASE || "https://api-tn10.kaspa.org";

/** Explorer base for C4 links (tn10.kaspa.stream confirmed working). */
const EXPLORER_TX_BASE =
  process.env.NEXT_PUBLIC_EXPLORER_TX_URL_BASE || "https://tn10.kaspa.stream/txs/";

export function explorerTxUrl(txid: string): string {
  return `${EXPLORER_TX_BASE}${txid}`;
}

/** DAA cadence, scores/second (finding F5: ~10/s on TN10 — approximate;
 * used only for deadline pickers and countdown display, never enforcement). */
export const DAA_PER_SECOND = 10n;

/** Client-policy deadline floor, in seconds. IMPORTANT HONESTY NOTE: the
 * chain/covenant accepts ANY deadline — this floor exists only in the
 * client, which is also where the covenant is constructed, so this
 * constant is the single enforcement point (picker options AND the
 * pre-send validation both read it; they cannot disagree).
 *
 * Prod-soak override (human requirement, 2026-08-05): setting
 * NEXT_PUBLIC_BETA_MIN_DEADLINE_SECONDS to 1..3599 lowers the floor on a
 * PRODUCTION build — deliberately env-gated, NOT NODE_ENV-gated. Baked
 * at build time (Render rebuilds on env change). Absent/invalid/≥3600 →
 * the 1-hour floor, and the short option renders nowhere.
 * MUST be removed before the beta announcement — see DEPLOY.md's
 * pre-beta checklist. */
const PRODUCTION_MIN_DEADLINE_SECONDS = 3600n;
/** Dev builds already ship a 2-minute testing chip; the default floor
 * there matches it so the chip stays valid. */
const DEFAULT_MIN_DEADLINE_SECONDS =
  process.env.NODE_ENV === "development" ? 120n : PRODUCTION_MIN_DEADLINE_SECONDS;
export const MIN_DEADLINE_SECONDS: bigint = (() => {
  const raw = process.env.NEXT_PUBLIC_BETA_MIN_DEADLINE_SECONDS;
  if (!raw || !/^\d{1,4}$/.test(raw)) return DEFAULT_MIN_DEADLINE_SECONDS;
  const v = BigInt(raw);
  return v >= 1n && v < DEFAULT_MIN_DEADLINE_SECONDS
    ? v
    : DEFAULT_MIN_DEADLINE_SECONDS;
})();
/** True only when the env override is actively lowering the floor. */
export const SOAK_FLOOR_ACTIVE =
  MIN_DEADLINE_SECONDS < DEFAULT_MIN_DEADLINE_SECONDS;

/** Humanize a small seconds value for the soak chip label. */
export function formatSeconds(seconds: bigint): string {
  if (seconds < 60n) return `${seconds}s`;
  if (seconds % 60n === 0n) return `${seconds / 60n} min`;
  return `${seconds / 60n}m ${seconds % 60n}s`;
}

export const SOMPI_PER_KAS = 100_000_000n;

/** Format sompi as a KAS string for display (never float math on money). */
export function formatKas(sompi: bigint): string {
  const whole = sompi / SOMPI_PER_KAS;
  const frac = sompi % SOMPI_PER_KAS;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(8, "0").replace(/0+$/, "")}`;
}

/** Shorten a Kaspa address for chips/labels. */
export function shortAddress(address: string): string {
  const sep = address.indexOf(":");
  const body = sep >= 0 ? address.slice(sep + 1) : address;
  return `${body.slice(0, 6)}…${body.slice(-6)}`;
}

/** Parse a user-entered KAS amount into sompi. Throws on bad input. */
export function parseKas(input: string): bigint {
  const m = input.trim().match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!m) throw new Error("enter an amount like 12 or 0.5");
  return BigInt(m[1]) * SOMPI_PER_KAS + BigInt((m[2] ?? "").padEnd(8, "0") || "0");
}
