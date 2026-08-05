// Shared cache-record shape + validation (brief §3.3). No server imports —
// used by both the server repository and the browser store. All bigints
// cross as decimal strings; the cache never carries plaintext or keys.

export const ASK_STATUSES = [
  "open",
  "answered",
  "refunded",
  "expired_pending_refund",
  // F14: the covenant's claim branch enforces only the payload header and
  // (V3) the askId — it cannot parse or decrypt the JSON body. So a claim
  // carrying a valid header and an unreadable body IS chain-valid and pays
  // the recipient. That is NOT a refund, and reporting it as one told the
  // sender "every sompi is back in your wallet" while the money was gone.
  // It gets its own terminal state.
  "claimed_unreadable",
] as const;
export type AskStatus = (typeof ASK_STATUSES)[number];

/** Which covenant this record's Ask was locked under.
 *
 * 1 = V2 (`ciph_msg:1:ask:`, fixed REFUND_FEE_ALLOWANCE, no askId)
 * 2 = V3 (`ciph_msg:1:ask:r2:`, per-Ask allowance + askId)
 *
 * REQUIRED so every read site can derive the RIGHT covenant. Without it a
 * V2 and a V3 record are indistinguishable once cached, and a V3 record
 * routed through the V2 derivation queries the wrong P2SH: §4 fails, the
 * row is filtered from both screens, and the auto-refund silently no-ops.
 * Records written before this field existed are treated as v1 (V2) — that
 * is what they are. */
export type ProtocolVersion = 1 | 2;

export interface AskRecordDto {
  /** The lock txid — the protocol-level ref of the Ask. */
  askRef: string;
  /** Covenant version. Absent in pre-migration rows → normalised to 1. */
  protocolVersion: ProtocolVersion;
  /** V3 only: the per-Ask id bound into the covenant (F22). */
  askId?: string | null;
  /** V3 only: the per-Ask refund fee allowance in sompi (F13). */
  refundAllowance?: string | null;
  senderAddress: string;
  recipientAddress: string;
  /** Locked amount in sompi (minRefund + REFUND_FEE_ALLOWANCE). */
  amountSompi: string;
  /** kasia1 ciphertext hex — the server/cache never sees plaintext (D8). */
  messageCiphertext: string;
  /** Absolute deadline DAA score, decimal string. */
  deadline: string;
  lockTxid: string;
  claimTxid: string | null;
  refundTxid: string | null;
  status: AskStatus;
}

const TXID_RE = /^[0-9a-fA-F]{64}$/;
const DECIMAL_RE = /^\d+$/;
// Beta hardening (2026-08-04): the cache API is open on a SHARED server,
// so every field gets a hard shape/size cap — junk that passes must stay
// small, and it still never renders without chain verification.
const ADDRESS_RE = /^[a-z]+:[a-z0-9]{8,120}$/;
/** Ciphertext hex ≤ 2× the whole-payload byte ceiling (16,384 → 32,768
 * hex chars); ≥ the kasia1 minimum blob (61 bytes → 122 chars). */
const CIPHERTEXT_RE = /^(?:[0-9a-fA-F]{2}){61,16384}$/;
const ASK_ID_RE = /^[0-9a-fA-F]{64}$/;
const MAX_AMOUNT_DIGITS = 20; // u64 sompi
const MAX_DEADLINE_DIGITS = 12; // DAA score < LOCK_TIME_THRESHOLD (5e11)

export function validateAskRecord(x: unknown): AskRecordDto {
  const r = x as Record<string, unknown>;
  const {
    askRef,
    protocolVersion: rawVersion,
    askId: rawAskId = null,
    refundAllowance: rawAllowance = null,
    senderAddress,
    recipientAddress,
    amountSompi,
    messageCiphertext,
    deadline,
    lockTxid,
    claimTxid = null,
    refundTxid = null,
    status,
  } = r ?? {};
  if (
    typeof askRef !== "string" ||
    !TXID_RE.test(askRef) ||
    typeof senderAddress !== "string" ||
    !ADDRESS_RE.test(senderAddress) ||
    typeof recipientAddress !== "string" ||
    !ADDRESS_RE.test(recipientAddress) ||
    typeof amountSompi !== "string" ||
    !DECIMAL_RE.test(amountSompi) ||
    amountSompi.length > MAX_AMOUNT_DIGITS ||
    typeof messageCiphertext !== "string" ||
    !CIPHERTEXT_RE.test(messageCiphertext) ||
    typeof deadline !== "string" ||
    !DECIMAL_RE.test(deadline) ||
    deadline.length > MAX_DEADLINE_DIGITS ||
    typeof lockTxid !== "string" ||
    !TXID_RE.test(lockTxid) ||
    (claimTxid !== null && (typeof claimTxid !== "string" || !TXID_RE.test(claimTxid))) ||
    (refundTxid !== null && (typeof refundTxid !== "string" || !TXID_RE.test(refundTxid))) ||
    !ASK_STATUSES.includes(status as AskStatus)
  ) {
    throw new Error("invalid ask record");
  }

  // Version normalisation. Rows written before the migration have no
  // `protocolVersion`; they are V2 Asks, so absent => 1. Anything other
  // than 1 or 2 is rejected rather than coerced — a record whose version we
  // cannot determine must not reach a covenant derivation.
  const protocolVersion =
    rawVersion === undefined || rawVersion === null ? 1 : rawVersion;
  if (protocolVersion !== 1 && protocolVersion !== 2) {
    throw new Error("invalid ask record: unknown protocolVersion");
  }
  // V3 records MUST carry both covenant parameters — without them the
  // covenant cannot be rebuilt, which is the whole point of the field.
  const askId = rawAskId === undefined ? null : rawAskId;
  const refundAllowance = rawAllowance === undefined ? null : rawAllowance;
  if (protocolVersion === 2) {
    if (typeof askId !== "string" || !ASK_ID_RE.test(askId)) {
      throw new Error("invalid ask record: v2 protocol requires a 32-byte hex askId");
    }
    if (
      typeof refundAllowance !== "string" ||
      !DECIMAL_RE.test(refundAllowance) ||
      refundAllowance.length > MAX_AMOUNT_DIGITS
    ) {
      throw new Error("invalid ask record: v2 protocol requires refundAllowance");
    }
  } else {
    // A V2 record carrying V3 parameters is malformed, not merely odd:
    // it would let a caller smuggle covenant params past the branch.
    if (askId !== null || refundAllowance !== null) {
      throw new Error("invalid ask record: v1 protocol must not carry v2 covenant fields");
    }
  }

  return {
    askRef,
    protocolVersion,
    askId,
    refundAllowance,
    senderAddress,
    recipientAddress,
    amountSompi,
    messageCiphertext,
    deadline,
    lockTxid,
    claimTxid: claimTxid as string | null,
    refundTxid: refundTxid as string | null,
    status: status as AskStatus,
  };
}
