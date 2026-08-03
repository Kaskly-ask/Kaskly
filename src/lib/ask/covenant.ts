// The ASK escrow covenant (ASKSPEC.md §3). V2 design, proven on TN10
// 2026-08-03 (PROGRESS.md Phase 1/2 spike results):
//   claim branch:  payload prefix check + recipient schnorr sig
//   refund branch: CLTV(deadline) + output pinning — NO signature, anyone
//                  can trigger; funds can only go to the sender.
// Every opcode semantic used here was verified against rusty-kaspa v2.0.1
// sources (see PROGRESS.md ground truth for citations).
import {
  ScriptBuilder,
  Opcodes,
  addressFromScriptPublicKey,
  payToAddressScript,
  PublicKey,
  XOnlyPublicKey,
  Address,
  type ScriptPublicKey,
} from "kaspa-wasm";
import { ASK_PREFIX_BYTES } from "./protocol";

export interface AskCovenantParams {
  /** Recipient's 32-byte x-only schnorr pubkey, hex. */
  recipientXOnlyHex: string;
  /** Sender address (refund destination — pinned into the script). */
  senderAddress: string;
  /** Absolute deadline as DAA score. MUST be < 500_000_000_000
   * (LOCK_TIME_THRESHOLD) so it is interpreted as a DAA score. */
  deadlineDaa: bigint;
  /** Covenant-enforced minimum refund amount in sompi. */
  minRefund: bigint;
}

export const LOCK_TIME_THRESHOLD = 500_000_000_000n;

const XONLY_RE = /^[0-9a-f]{64}$/i;

/** Serialize an SPK exactly as OpTxOutputSpk pushes it: 2-byte big-endian
 * version || script bytes (rusty-kaspa v2.0.1 SpkEncoding::to_bytes). */
export function spkToStackBytes(spk: ScriptPublicKey): Uint8Array {
  const j = spk.toJSON() as unknown as { version: number; script: string };
  const script = j.script;
  const out = new Uint8Array(2 + script.length / 2);
  out[0] = (j.version >> 8) & 0xff;
  out[1] = j.version & 0xff;
  for (let i = 0; i < script.length / 2; i++) {
    out[2 + i] = parseInt(script.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** A schnorr Kaspa address payload IS the x-only pubkey — Kasia's own
 * identity trick (their cipher/src/lib.rs). Used for both the covenant
 * claim key and kasia1 encryption. */
export function xOnlyFromAddress(address: string): string {
  const hex = XOnlyPublicKey.fromAddress(new Address(address)).toString();
  if (!XONLY_RE.test(hex)) {
    throw new Error(`address does not carry an x-only schnorr key: ${address}`);
  }
  return hex;
}

/** x-only pubkey hex for a keypair-owned public key (hex compressed or
 * uncompressed input accepted by the SDK's PublicKey). */
export function xOnlyHexFromPublicKey(publicKeyHex: string): string {
  const hex = new PublicKey(publicKeyHex).toXOnlyPublicKey().toString();
  if (!XONLY_RE.test(hex)) throw new Error(`unexpected x-only key: ${hex}`);
  return hex;
}

export function buildAskRedeemScript(params: AskCovenantParams): ScriptBuilder {
  const { recipientXOnlyHex, senderAddress, deadlineDaa, minRefund } = params;
  if (!XONLY_RE.test(recipientXOnlyHex)) throw new Error("bad recipient x-only key");
  if (deadlineDaa <= 0n || deadlineDaa >= LOCK_TIME_THRESHOLD) {
    throw new Error("deadline must be a DAA score below LOCK_TIME_THRESHOLD");
  }
  if (minRefund <= 0n) throw new Error("minRefund must be positive");
  const senderSpkBytes = spkToStackBytes(payToAddressScript(senderAddress));
  const recipientKey = Uint8Array.from(
    recipientXOnlyHex.match(/.{2}/g)!.map((b) => parseInt(b, 16))
  );
  return new ScriptBuilder()
    .addOp(Opcodes.OpIf)
    .addI64(0n)
    .addI64(BigInt(ASK_PREFIX_BYTES.length))
    .addOp(Opcodes.OpTxPayloadSubstr)
    .addData(ASK_PREFIX_BYTES)
    .addOp(Opcodes.OpEqualVerify)
    .addData(recipientKey)
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpElse)
    .addLockTime(deadlineDaa)
    .addOp(Opcodes.OpCheckLockTimeVerify)
    .addOp(Opcodes.OpTxOutputCount)
    .addI64(1n)
    .addOp(Opcodes.OpNumEqualVerify)
    .addI64(0n)
    .addOp(Opcodes.OpTxOutputSpk)
    .addData(senderSpkBytes)
    .addOp(Opcodes.OpEqualVerify)
    .addI64(0n)
    .addOp(Opcodes.OpTxOutputAmount)
    .addI64(minRefund)
    .addOp(Opcodes.OpGreaterThanOrEqual)
    .addOp(Opcodes.OpEndIf);
}

export interface AskCovenantInfo {
  redeemScriptHex: string;
  p2shAddress: string;
}

/** Build the covenant and derive its P2SH address for a network
 * ("testnet-10" etc.). */
export function deriveAskCovenant(
  params: AskCovenantParams,
  networkId: string
): AskCovenantInfo {
  const redeem = buildAskRedeemScript(params);
  const address = addressFromScriptPublicKey(
    redeem.createPayToScriptHashScript(),
    networkId
  );
  if (!address) throw new Error("failed to derive P2SH address");
  return { redeemScriptHex: redeem.toString(), p2shAddress: address.toString() };
}
