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

export interface AskRecordDto {
  /** The lock txid — the protocol-level ref of the Ask. */
  askRef: string;
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
const MAX_AMOUNT_DIGITS = 20; // u64 sompi
const MAX_DEADLINE_DIGITS = 12; // DAA score < LOCK_TIME_THRESHOLD (5e11)

export function validateAskRecord(x: unknown): AskRecordDto {
  const r = x as Record<string, unknown>;
  const {
    askRef,
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
  return {
    askRef,
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
