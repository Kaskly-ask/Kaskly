// V3 claim and refund transaction builders (COVENANT-V3-DESIGN.md).
//
// Two rules this module exists to enforce, both from findings:
//
//  F13/F21 — THE FEE COMES FROM THE SOLVER, NEVER A CONSTANT. The whole
//  F13 fix lives in fees-v3.ts: a builder that hardcodes a fee (as V2's
//  buildRefundTransaction did, paying the fixed 500,000-sompi allowance)
//  reintroduces both the stranding bug and the miner overpayment. There is
//  deliberately NO default fee parameter here.
//
//  F22 — the claim payload is produced by protocol-v3.ts, which imports
//  its offsets from covenant-v3.ts. The bytes the covenant READS and the
//  bytes this builder WRITES therefore come from one definition.
import {
  createTransaction,
  createInputSignature,
  calculateTransactionFee,
  PrivateKey,
  ScriptBuilder,
  type IUtxoEntry,
  type Transaction,
} from "kaspa-wasm";
import { encodeReplyPayloadV3, type ReplyEnvelopeV3 } from "./protocol-v3";
import { solveRefundFee, FeeSolveRefusal } from "./fees-v3";
import { encryptKasia1 } from "./crypto";
import { xOnlyFromAddress } from "./covenant";
import { messageByteLength, messageTooLongError, MAX_MESSAGE_BYTES } from "./protocol";

/** Signature script for the CLAIM branch: push(sig) push(0x01) push(redeem).
 * The 0x01 selects the OpIf branch; the redeem script must be the last
 * push (Kaspa P2SH rule). */
function claimSigScript(redeemScriptHex: string, signatureHex: string): string {
  const sig = Buffer.from(signatureHex, "hex");
  const raw =
    sig.length >= 2 && sig[0] === sig.length - 1 && sig[0] <= 75 ? sig.subarray(1) : sig;
  return new ScriptBuilder()
    .addData(raw)
    .addData(Buffer.from([1]))
    .addData(Buffer.from(redeemScriptHex, "hex"))
    .drain();
}

/** Signature script for the REFUND branch: push(<empty>) push(redeem).
 * No signature exists — anyone may broadcast it. */
function refundSigScript(redeemScriptHex: string): string {
  return new ScriptBuilder()
    .addData(Buffer.from([]))
    .addData(Buffer.from(redeemScriptHex, "hex"))
    .drain();
}

export const CLAIM_FEE_MAX_ITERS = 10;

export interface ClaimV3Params {
  networkId: string;
  covenantUtxo: IUtxoEntry;
  redeemScriptHex: string;
  recipientAddress: string;
  recipientPrivateKeyHex: string;
  /** Per-Ask id bound into the covenant — MUST match, or the claim is
   * rejected by OpEqualVerify at payload[18:50]. */
  askIdHex: string;
  /** Lock txid this reply refers to (JSON field, client-validated). */
  lockTxid: string;
  replyText: string;
  /** Sender's address — the reply is encrypted to their key. */
  senderAddress: string;
}

/**
 * Build the atomic claim-by-reply transaction. The fee is derived from the
 * real serialized mass by iteration; a non-converging quote THROWS rather
 * than guessing (same rule as the refund path).
 */
export function buildClaimTransactionV3(params: ClaimV3Params): Transaction {
  if (messageByteLength(params.replyText) > MAX_MESSAGE_BYTES) {
    throw messageTooLongError("reply");
  }
  const envelope: ReplyEnvelopeV3 = {
    v: 2,
    ref: params.lockTxid,
    msgEnc: "kasia1",
    message: encryptKasia1(xOnlyFromAddress(params.senderAddress), params.replyText),
  };
  const payloadHex = encodeReplyPayloadV3({ askIdHex: params.askIdHex, envelope });

  const input = BigInt(params.covenantUtxo.amount);
  let fee = 150_000n;
  const trace: string[] = [];
  for (let i = 0; i < CLAIM_FEE_MAX_ITERS; i++) {
    const amount = input - fee;
    if (amount <= 0n) {
      throw new Error(
        `claim fee ${fee} exceeds the locked amount ${input} — this Ask is too small to claim`
      );
    }
    const tx = createTransaction(
      [params.covenantUtxo],
      [{ address: params.recipientAddress, amount }],
      0n,
      payloadHex,
      1
    );
    const sig = createInputSignature(tx, 0, new PrivateKey(params.recipientPrivateKeyHex));
    tx.inputs[0].signatureScript = claimSigScript(params.redeemScriptHex, sig);

    const required = calculateTransactionFee(params.networkId, tx);
    trace.push(`${fee}->${required === undefined ? "none" : required}`);
    if (required === undefined) {
      throw new Error(`no valid claim fee exists (mass over limit) [${trace.join(" ")}]`);
    }
    if (required <= fee) return tx;
    fee = required;
  }
  throw new Error(
    `claim fee did not converge in ${CLAIM_FEE_MAX_ITERS} iterations [${trace.join(" ")}]`
  );
}

export interface RefundV3Params {
  networkId: string;
  covenantUtxo: IUtxoEntry;
  redeemScriptHex: string;
  senderAddress: string;
  deadlineDaa: bigint;
  /** The covenant's per-Ask allowance, i.e. the MAXIMUM the refund may
   * withhold. The floor the script enforces is (input - allowance). */
  refundAllowance: bigint;
}

/**
 * Build the sig-less, anyone-can-trigger refund.
 *
 * F21: pays (input - SOLVED fee), not the floor — the sender keeps the
 * difference that V2 handed to a miner.
 * F13: the fee comes from solveRefundFee, which THROWS when the fixed
 * point does not converge. That throw must propagate: constructing a
 * refund with a guessed fee is how funds get stranded.
 */
export function buildRefundTransactionV3(params: RefundV3Params): Transaction {
  const input = BigInt(params.covenantUtxo.amount);
  const floor = input - params.refundAllowance;

  const { fee } = solveRefundFee({
    networkId: params.networkId,
    amountSompi: input,
    senderAddress: params.senderAddress,
    utxoTemplate: () => params.covenantUtxo,
  });

  const amount = input - fee;
  if (amount < floor) {
    // Would be rejected by the covenant's OpGreaterThanOrEqual. Refuse
    // locally rather than broadcasting something invalid.
    throw new FeeSolveRefusal(
      `solved refund fee ${fee} exceeds the covenant allowance ${params.refundAllowance}`,
      input,
      []
    );
  }

  const tx = createTransaction(
    [params.covenantUtxo],
    [{ address: params.senderAddress, amount }],
    0n,
    undefined,
    0
  );
  // CLTV: tx.lockTime >= the script's deadline, same threshold class, and
  // input sequence != MAX_U64.
  tx.lockTime = params.deadlineDaa;
  tx.inputs[0].sequence = 0n;
  tx.inputs[0].signatureScript = refundSigScript(params.redeemScriptHex);
  return tx;
}
