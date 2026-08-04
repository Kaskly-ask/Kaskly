// The ASK escrow covenant, V3 (COVENANT-V3-DESIGN.md).
//
// V2 lives on in ./covenant.ts and is NOT modified: in-flight V2 Asks must
// stay readable and refundable. Clients CREATE only V3 and READ both.
//
// V3 closes four findings from the 2026-08-04 adversarial review:
//   F12 (CRITICAL, proven on chain, txid ab5575a6…) — the V2 refund branch
//        pinned the OUTPUT side but not the INPUT side, so N expired
//        covenants of one sender could be batch-refunded into a single
//        output and the surplus taken as miner fee. V3 pins the input
//        count and derives the floor from the input's real amount.
//   F22 (CRITICAL) — the V2 claim branch checked only a 15-byte prefix, so
//        one reply payload could claim several senders' Asks. V3 binds
//        each claim to a per-Ask random askId that must appear in the
//        payload (mechanism M1).
//   F13/F21 — the fixed REFUND_FEE_ALLOWANCE both stranded small Asks and
//        overpaid miners. V3 takes the allowance as a PER-ASK parameter;
//        the floor becomes (this input's amount − allowance).
//
// OPCODE SEMANTICS — every non-obvious behaviour used below was verified
// empirically on TN10, because the SDK enum proves existence, not
// behaviour (spikes 11 and 11b, PROGRESS.md / COVENANT-V3-DESIGN.md §0):
//   • introspection opcodes POP an input index → the idiom is
//     `OpTxInputIndex OpTxInputAmount` (spike 11: an implicit form failed
//     with "Number too big… 32 bytes exceeds the max allowed of 8").
//   • OpTxInputAmount returns sompi usable as a script number, and OpSub
//     handles those magnitudes — the floor comparison COMPUTES and
//     CONSTRAINS (spike 11b Q4: below-floor rejected, above-floor accepted,
//     txid 27f38aeb…), against a PASSING positive control.
//   • OpTxPayloadSubstr fails closed out of range (spike 11b Q3) — but that
//     was proven at offset 0 only, which is why the explicit
//     OpTxPayloadLen guard below is NOT optional. See UNVERIFIED note.
//
//   • OpTxPayloadLen (196) BEHAVES as a script number under
//     OpGreaterThanOrEqual — verified in isolation and in this exact claim
//     shape by spike 11c (2026-08-04), against a passing positive control:
//       len 49 rejected / len 51 accepted (8a949659…)   [guard alone]
//       len 17 rejected, len 49 rejected                [real offsets]
//       len 50 with a WRONG askId rejected              [the F22 property]
//       len 50 with the correct askId ACCEPTED (0c5da1bd…)
//     This retires the authoring gate. The script is still NOT proven
//     end-to-end: the re-proof campaign (design §9) — probe 07 flipping
//     CONFIRMED→REFUTED, cross-Ask probe 08, floor probe 09, DAA probe 10,
//     the full R3 suite and a regenerated golden vector — must pass before
//     this file enters any tag.
import {
  ScriptBuilder,
  Opcodes,
  addressFromScriptPublicKey,
  payToAddressScript,
  type ScriptPublicKey,
} from "kaspa-wasm";
import { spkToStackBytes, LOCK_TIME_THRESHOLD } from "./covenant";

/** V3 claim-payload header. Kept INSIDE Kasia's `ciph_msg:1:` namespace so
 * existing Kasia clients and explorers keep classifying ASK traffic
 * natively (tn10.kaspa.stream already shows msg_type: ask). The subkind —
 * `r2:` rather than `r:` — is what announces the incompatible V3 layout,
 * so an old parser meets an unknown subkind at byte 15 and skips instead
 * of mis-reading 32 raw askId bytes as the start of JSON (ASKSPEC §11).
 *
 * The marker lives in this ONE constant: reversing the version-marker
 * decision is a one-line change plus a regenerated golden vector. */
export const ASK_V3_REPLY_HEADER = "ciph_msg:1:ask:r2:";
export const ASK_V3_HEADER_BYTES = new TextEncoder().encode(ASK_V3_REPLY_HEADER);

/** Byte offsets of the askId inside a V3 reply payload:
 * [header][32-byte askId][JSON envelope]. */
export const ASK_ID_OFFSET = ASK_V3_HEADER_BYTES.length; // 18
export const ASK_ID_BYTES = 32;
export const ASK_ID_END = ASK_ID_OFFSET + ASK_ID_BYTES; // 50
/** Minimum payload length the claim branch will accept. Equals ASK_ID_END:
 * header + askId. The JSON envelope follows and is client-validated. */
export const MIN_CLAIM_PAYLOAD_LEN = ASK_ID_END; // 50

const XONLY_RE = /^[0-9a-f]{64}$/i;
const ASK_ID_RE = /^[0-9a-f]{64}$/i;

export interface AskCovenantV3Params {
  /** Recipient's 32-byte x-only schnorr pubkey, hex. */
  recipientXOnlyHex: string;
  /** Sender address (refund destination — pinned into the script). */
  senderAddress: string;
  /** Absolute deadline as DAA score, < LOCK_TIME_THRESHOLD. */
  deadlineDaa: bigint;
  /** Per-Ask random 32-byte identifier, hex (mechanism M1). MUST be
   * generated with a CSPRNG and MUST NOT be reused across Asks — its
   * uniqueness is the entire F22 argument. */
  askIdHex: string;
  /** Per-Ask refund fee allowance in sompi (F13/F21): the maximum the
   * refund may withhold from the sender. Derived at creation from the
   * REAL refund mass with margin — never a global constant. */
  refundAllowance: bigint;
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}

/**
 * V3 redeem script.
 *
 * CLAIM branch (selector TRUE) — F22 + the F14 subkind route:
 *   payload length >= 50            (explicit guard; see UNVERIFIED note)
 *   payload[0:18]  == "ciph_msg:1:ask:r2:"   → kind is a V3 reply
 *   payload[18:50] == askId                  → binds THIS Ask
 *   recipient schnorr signature
 * WHAT THE askId BINDING ACTUALLY GUARANTEES — stated precisely, because
 * an earlier version of this comment overclaimed ("one reply can never
 * claim two Asks", second audit 2026-08-04):
 *
 *  - V3 vs V3: a transaction carries exactly ONE payload, so two V3
 *    covenants with DIFFERENT askIds impose contradictory requirements on
 *    payload[18:50] and cannot both be satisfied. Holds — chain-proven by
 *    spike 08, including two Asks funded by one lock transaction.
 *  - V3 vs V3 with the SAME askId: NOT prevented by the script. askIds are
 *    public in every announcement and nothing rejects duplicates, so a
 *    hostile sender can deliberately collide with a live askId. Blocked
 *    today only by the input pin below. Client-side duplicate detection is
 *    still owed.
 *  - V2 + V3 mixed: was NOT prevented by the askId at all. V2's claim
 *    branch checks only the 15 bytes that the V3 header begins with, so
 *    one V3 payload satisfied a V2 covenant too. Now blocked by the input
 *    pin below — chain-proven by spike 13.
 *
 * In short: the askId binding is what makes V3-vs-V3 claims distinct; the
 * input pin is what makes ANY multi-covenant claim impossible. The second
 * is doing the heavy lifting, and the first should not be described as if
 * it were.
 *
 * REFUND branch (selector FALSE) — F12 + F13/F21:
 *   exactly ONE input               (kills the batched-refund drain)
 *   CLTV(deadline)
 *   exactly ONE output, to the sender's SPK
 *   output[0].amount >= thisInput.amount − allowance
 * No signature: anyone may trigger it, and it can only pay the sender.
 * Deriving the floor from the input's real amount also stops an overfunded
 * covenant from leaking the surplus to a miner.
 */
export function buildAskRedeemScriptV3(
  params: AskCovenantV3Params
): ScriptBuilder {
  const {
    recipientXOnlyHex,
    senderAddress,
    deadlineDaa,
    askIdHex,
    refundAllowance,
  } = params;

  if (!XONLY_RE.test(recipientXOnlyHex)) throw new Error("bad recipient x-only key");
  if (!ASK_ID_RE.test(askIdHex)) throw new Error("askId must be 32 bytes of hex");
  if (deadlineDaa <= 0n || deadlineDaa >= LOCK_TIME_THRESHOLD) {
    throw new Error("deadline must be a DAA score below LOCK_TIME_THRESHOLD");
  }
  if (refundAllowance <= 0n) throw new Error("refundAllowance must be positive");

  const senderSpkBytes = spkToStackBytes(
    payToAddressScript(senderAddress) as ScriptPublicKey
  );

  return (
    new ScriptBuilder()
      .addOp(Opcodes.OpIf)
      // --- claim branch ------------------------------------------------
      // Exactly ONE input (human decision, 2026-08-04, second audit).
      // V2's claim branch checks only payload[0:15] == "ciph_msg:1:ask:",
      // and the V3 header "ciph_msg:1:ask:r2:" BEGINS with those 15 bytes —
      // so a single V3-shaped payload satisfied a V2 covenant too. A
      // recipient holding one V2 and one V3 Ask could spend BOTH in one
      // transaction with one reply, and the V2 sender lost their Ask to a
      // reply encrypted to someone else. V2 is deployed and immutable, so
      // the fix has to live here.
      // TRADE (accepted deliberately): this permanently forecloses
      // claim-side fee subsidy — a recipient adding their own input to
      // cover the fee, which is the only thing that rescues an Ask near
      // the viability floor. Weighed against a live fund-loss path for V2
      // senders, and chosen knowing the script cannot be upgraded without
      // changing every address again.
      .addOp(Opcodes.OpTxInputCount)
      .addI64(1n)
      .addOp(Opcodes.OpNumEqualVerify)
      // Explicit length guard: makes "a short payload cannot bypass
      // the askId comparison" a local, auditable property of this script
      // rather than a claim resting on OpTxPayloadSubstr's out-of-range
      // behaviour, which is only proven at offset 0 (spike 11b Q3).
      .addOp(Opcodes.OpTxPayloadLen)
      .addI64(BigInt(MIN_CLAIM_PAYLOAD_LEN))
      .addOp(Opcodes.OpGreaterThanOrEqual)
      .addOp(Opcodes.OpVerify)
      // header (kind = V3 reply)
      .addI64(0n)
      .addI64(BigInt(ASK_ID_OFFSET))
      .addOp(Opcodes.OpTxPayloadSubstr)
      .addData(ASK_V3_HEADER_BYTES)
      .addOp(Opcodes.OpEqualVerify)
      // askId (binds this claim to THIS Ask — F22)
      .addI64(BigInt(ASK_ID_OFFSET))
      .addI64(BigInt(ASK_ID_END))
      .addOp(Opcodes.OpTxPayloadSubstr)
      .addData(hexToBytes(askIdHex))
      .addOp(Opcodes.OpEqualVerify)
      .addData(hexToBytes(recipientXOnlyHex))
      .addOp(Opcodes.OpCheckSig)
      .addOp(Opcodes.OpElse)
      // --- refund branch -----------------------------------------------
      // F12: pin the INPUT side. Without this, N covenants of one sender
      // collapse into one output and the surplus goes to a miner.
      .addOp(Opcodes.OpTxInputCount)
      .addI64(1n)
      .addOp(Opcodes.OpNumEqualVerify)
      .addLockTime(deadlineDaa)
      .addOp(Opcodes.OpCheckLockTimeVerify)
      .addOp(Opcodes.OpTxOutputCount)
      .addI64(1n)
      .addOp(Opcodes.OpNumEqualVerify)
      .addI64(0n)
      .addOp(Opcodes.OpTxOutputSpk)
      .addData(senderSpkBytes)
      .addOp(Opcodes.OpEqualVerify)
      // floor = this input's REAL amount − allowance (F13/F21 + overfunding)
      .addI64(0n)
      .addOp(Opcodes.OpTxOutputAmount)
      .addOp(Opcodes.OpTxInputIndex)
      .addOp(Opcodes.OpTxInputAmount)
      .addI64(refundAllowance)
      .addOp(Opcodes.OpSub)
      .addOp(Opcodes.OpGreaterThanOrEqual)
      .addOp(Opcodes.OpEndIf)
  );
}

export interface AskCovenantV3Info {
  redeemScriptHex: string;
  p2shAddress: string;
}

/** Build the V3 covenant and derive its P2SH address. */
export function deriveAskCovenantV3(
  params: AskCovenantV3Params,
  networkId: string
): AskCovenantV3Info {
  const redeem = buildAskRedeemScriptV3(params);
  const address = addressFromScriptPublicKey(
    redeem.createPayToScriptHashScript(),
    networkId
  );
  if (!address) throw new Error("failed to derive P2SH address");
  return { redeemScriptHex: redeem.toString(), p2shAddress: address.toString() };
}
