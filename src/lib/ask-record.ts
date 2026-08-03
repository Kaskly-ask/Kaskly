// Shared cache-record shape + validation (brief §3.3). No server imports —
// used by both the server repository and the browser store. All bigints
// cross as decimal strings; the cache never carries plaintext or keys.

export const ASK_STATUSES = [
  "open",
  "answered",
  "refunded",
  "expired_pending_refund",
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
    typeof recipientAddress !== "string" ||
    typeof amountSompi !== "string" ||
    !DECIMAL_RE.test(amountSompi) ||
    typeof messageCiphertext !== "string" ||
    typeof deadline !== "string" ||
    !DECIMAL_RE.test(deadline) ||
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
