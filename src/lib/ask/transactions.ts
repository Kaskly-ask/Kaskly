// ASK transaction construction (ASKSPEC.md §4-6): lock, claim-by-reply,
// refund. Pure construction — callers supply UTXOs and submit via RPC.
import {
  ScriptBuilder,
  createTransaction,
  createInputSignature,
  PrivateKey,
  Transaction,
  type IUtxoEntry,
} from "kaspa-wasm";
import {
  encodeReplyPayload,
  type ReplyEnvelope,
  REFUND_FEE_ALLOWANCE,
} from "./protocol";

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

export interface ClaimParams {
  /** The covenant UTXO (from getUtxosByAddresses on the P2SH address). */
  covenantUtxo: IUtxoEntry;
  redeemScriptHex: string;
  recipientAddress: string;
  recipientPrivateKeyHex: string;
  reply: ReplyEnvelope;
  /** Fee left to miners, sompi. Default = REFUND_FEE_ALLOWANCE. */
  fee?: bigint;
}

/** Build the atomic claim-by-reply transaction (A3): spends the covenant
 * to the recipient AND carries the reply payload. All-or-nothing. */
export function buildClaimTransaction(params: ClaimParams): Transaction {
  const fee = params.fee ?? REFUND_FEE_ALLOWANCE;
  const amount = BigInt(params.covenantUtxo.amount) - fee;
  if (amount <= 0n) throw new Error("fee exceeds locked amount");
  const payloadHex = encodeReplyPayload(params.reply);
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
 * only once virtual DAA >= deadline (consensus finality + covenant CLTV). */
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
