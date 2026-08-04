// ASK transaction construction (ASKSPEC.md §4-6): lock, claim-by-reply,
// refund. Pure construction — callers supply UTXOs and submit via RPC.
import {
  ScriptBuilder,
  createTransaction,
  createInputSignature,
  calculateTransactionFee,
  PrivateKey,
  Transaction,
  type IUtxoEntry,
} from "kaspa-wasm";
import {
  encodeReplyPayload,
  MAX_MESSAGE_BYTES,
  messageByteLength,
  messageTooLongError,
  REFUND_FEE_ALLOWANCE,
} from "./protocol";
import { xOnlyFromAddress } from "./covenant";
import { encryptKasia1 } from "./crypto";

/** Strip the canonical small-data push prefix that createInputSignature
 * prepends (VERIFIED empirically in the Phase 1 spike, finding F2). */
export function stripPushPrefix(sigScriptFragmentHex: string): Uint8Array {
  const bytes = Uint8Array.from(
    sigScriptFragmentHex.match(/.{2}/g)!.map((b) => parseInt(b, 16))
  );
  if (bytes.length >= 2 && bytes[0] === bytes.length - 1 && bytes[0] <= 75) {
    return bytes.subarray(1);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}

/** Claim signature script: push(sig||hashtype) push(0x01) push(redeem). */
export function buildClaimSignatureScript(
  redeemScriptHex: string,
  signatureFragmentHex: string
): string {
  return new ScriptBuilder()
    .addData(stripPushPrefix(signatureFragmentHex))
    .addData(Uint8Array.from([1]))
    .addData(hexToBytes(redeemScriptHex))
    .toString();
}

/** Open-refund signature script: push(<empty>) push(redeem). No signature. */
export function buildRefundSignatureScript(redeemScriptHex: string): string {
  return new ScriptBuilder()
    .addData(new Uint8Array(0))
    .addData(hexToBytes(redeemScriptHex))
    .toString();
}

/** Conventional claim-fee floor for short replies (matches the refund
 * allowance so all Phase 2 evidence stays byte-identical). */
export const CLAIM_FEE_FLOOR = REFUND_FEE_ALLOWANCE;

/** Placeholder signature fragment (push-prefixed 64-byte schnorr sig +
 * sighash byte) — same byte length as a real one, for mass quoting only. */
const DUMMY_SIG_FRAGMENT = "41" + "00".repeat(65);

export interface ClaimFeeQuote {
  /** Total network fee in sompi (mass-proportional minimum, floored). */
  fee: bigint;
  /** What the recipient nets: locked amount − fee. */
  net: bigint;
}

/** Compute the claim fee from ACTUAL transaction mass (Phase 3 gate
 * finding F7: the network minimum is proportional to byte size — a fixed
 * fee under-pays for long replies and the node rejects the broadcast).
 * Iterates because storage mass depends on output values; converges in
 * one or two rounds. Throws a human-readable error when the fee would
 * swallow the locked amount. */
export function quoteClaimFee(args: {
  networkId: string;
  covenantUtxo: IUtxoEntry;
  redeemScriptHex: string;
  recipientAddress: string;
  payloadHex: string;
}): ClaimFeeQuote {
  const total = BigInt(args.covenantUtxo.amount);
  let fee = CLAIM_FEE_FLOOR;
  for (let i = 0; i < 5; i++) {
    if (fee >= total) {
      throw new Error(
        `Reply too long for this Ask's amount — the network fee for a reply this size would exceed the locked funds. Shorten the reply.`
      );
    }
    const tx = createTransaction(
      [args.covenantUtxo],
      [{ address: args.recipientAddress, amount: total - fee }],
      0n,
      args.payloadHex,
      1
    );
    tx.inputs[0].signatureScript = buildClaimSignatureScript(
      args.redeemScriptHex,
      DUMMY_SIG_FRAGMENT
    );
    const min = calculateTransactionFee(args.networkId, tx, 1);
    if (min === undefined) {
      // The SDK yields undefined when no standard fee exists for this
      // shape — e.g. a huge payload against a tiny output (storage mass).
      throw new Error(
        `Reply too long for this Ask's amount — the network fee for a reply this size would exceed the locked funds. Shorten the reply.`
      );
    }
    const required = min > CLAIM_FEE_FLOOR ? min : CLAIM_FEE_FLOOR;
    if (required <= fee) return { fee, net: total - fee };
    fee = required;
  }
  throw new Error("fee quote did not converge");
}

export interface ClaimParams {
  /** Network id, e.g. "testnet-10" — needed for mass/fee calculation. */
  networkId: string;
  /** The covenant UTXO (from getUtxosByAddresses on the P2SH address). */
  covenantUtxo: IUtxoEntry;
  redeemScriptHex: string;
  recipientAddress: string;
  recipientPrivateKeyHex: string;
  /** Lock txid this reply claims. */
  lockTxid: string;
  /** Plaintext reply; encrypted to the SENDER with kasia1 before it ever
   * leaves this function (Q4: encrypted only). */
  replyText: string;
  /** Sender's address — the reply's encryption target. */
  senderAddress: string;
  /** Explicit fee override in sompi; default = quoteClaimFee (mass-based,
   * floored at CLAIM_FEE_FLOOR). */
  fee?: bigint;
}

/** Build the atomic claim-by-reply transaction (A3): spends the covenant
 * to the recipient AND carries the reply payload. All-or-nothing. */
export function buildClaimTransaction(params: ClaimParams): Transaction {
  if (messageByteLength(params.replyText) > MAX_MESSAGE_BYTES) {
    throw messageTooLongError("reply");
  }
  const payloadHex = encodeReplyPayload({
    v: 1,
    ref: params.lockTxid,
    msgEnc: "kasia1",
    message: encryptKasia1(xOnlyFromAddress(params.senderAddress), params.replyText),
  });
  const fee =
    params.fee ??
    quoteClaimFee({
      networkId: params.networkId,
      covenantUtxo: params.covenantUtxo,
      redeemScriptHex: params.redeemScriptHex,
      recipientAddress: params.recipientAddress,
      payloadHex,
    }).fee;
  const amount = BigInt(params.covenantUtxo.amount) - fee;
  if (amount <= 0n) throw new Error("fee exceeds locked amount");
  const tx = createTransaction(
    [params.covenantUtxo],
    [{ address: params.recipientAddress, amount }],
    0n,
    payloadHex,
    1
  );
  const sig = createInputSignature(
    tx,
    0,
    new PrivateKey(params.recipientPrivateKeyHex)
  );
  tx.inputs[0].signatureScript = buildClaimSignatureScript(
    params.redeemScriptHex,
    sig
  );
  return tx;
}

export interface RefundParams {
  covenantUtxo: IUtxoEntry;
  redeemScriptHex: string;
  senderAddress: string;
  deadlineDaa: bigint;
  /** Covenant-pinned minimum refund (amount - REFUND_FEE_ALLOWANCE at lock
   * time). The refund pays exactly this; the rest is miner fee. */
  minRefund: bigint;
}

/** Build the sig-less anyone-can-trigger refund transaction (A4). Valid
 * only once virtual DAA >= deadline (consensus finality + covenant CLTV).
 * The FIXED fee allowance is safe here: a refund never carries a payload,
 * so its mass is small and constant regardless of message/reply sizes. */
export function buildRefundTransaction(params: RefundParams): Transaction {
  const tx = createTransaction(
    [params.covenantUtxo],
    [{ address: params.senderAddress, amount: params.minRefund }],
    0n,
    undefined,
    0
  );
  // CLTV requirements (VERIFIED v2.0.1 opcodes/mod.rs): tx.lockTime >=
  // stack deadline, same threshold class, input sequence != MAX. The
  // sighash is irrelevant here — no signature exists.
  tx.lockTime = params.deadlineDaa;
  tx.inputs[0].sequence = 0n;
  tx.inputs[0].signatureScript = buildRefundSignatureScript(
    params.redeemScriptHex
  );
  return tx;
}
