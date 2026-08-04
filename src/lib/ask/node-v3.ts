// V3 Ask creation (COVENANT-V3-DESIGN.md). Mirrors node.ts createAsk, but
// builds the V3 covenant and announcement.
//
// Split deliberately in two:
//   prepareAskV3()  — PURE. Derives the covenant, per-Ask allowance and
//                     announcement payload. No chain, no keys, no I/O, so
//                     the wiring can be proven without spending TKAS.
//   createAskV3()   — funds it: builds, signs and submits the lock tx.
//
// Two V3 fields are MANDATORY in the announcement and must survive to any
// reader: askId (binds a claim to THIS Ask — F22) and refundAllowance (the
// per-Ask fee allowance — F13). Without both, §4 escrow verification
// cannot rebuild the covenant, so an honest client could never confirm the
// funded P2SH matches the announcement.
import {
  createTransactions,
  type RpcClient,
} from "kaspa-wasm";
import { deriveAskCovenantV3, type AskCovenantV3Params } from "./covenant-v3";
import { encodeAskPayloadV3, type AskEnvelopeV3 } from "./protocol-v3";
import { solveRefundFee } from "./fees-v3";
import {
  assertPlausibleDaaScore,
  assertDeadlineWithinBound,
  DAA_ANCHORS,
} from "./daa-guard";
import { xOnlyFromAddress } from "./covenant";
import { encryptKasia1 } from "./crypto";
import { messageByteLength, messageTooLongError, MAX_MESSAGE_BYTES } from "./protocol";

/** Cryptographically random 32-byte askId, hex. Uniqueness IS the F22
 * argument — never derive this from anything guessable. */
export function randomAskIdHex(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export interface PrepareAskV3Params {
  networkId: string;
  senderAddress: string;
  recipientAddress: string;
  amount: bigint;
  message: string;
  deadlineDaa: bigint;
  /** The DAA score this deadline was derived from (F24). When supplied,
   * it is sanity-checked against a recorded anchor and the resulting lock
   * is bounded to 90 days. Production callers MUST pass it — omitting it
   * skips the guard, which is only acceptable in fixture tests that build
   * covenants from synthetic scores. */
  currentDaa?: bigint;
  /** Injectable clock for the plausibility check. */
  nowMs?: number;
  /** Supply to make derivation deterministic in tests; omit in production. */
  askIdHex?: string;
  /** A UTXO shape for fee measurement (amount is what matters). */
  utxoTemplate: (amount: bigint) => Parameters<typeof solveRefundFee>[0]["utxoTemplate"] extends (
    a: bigint
  ) => infer U
    ? U
    : never;
}

export interface PreparedAskV3 {
  covenantParams: AskCovenantV3Params;
  redeemScriptHex: string;
  p2shAddress: string;
  askIdHex: string;
  /** Per-Ask allowance actually pinned into the covenant (F13/F21). */
  refundAllowance: bigint;
  /** Solved refund fee the allowance was derived from. */
  solvedRefundFee: bigint;
  envelope: AskEnvelopeV3;
  payloadHex: string;
}

/**
 * PURE. Throws (via solveRefundFee) when the amount is too small for a
 * refund ever to be broadcastable — the F13 refusal. Callers MUST treat
 * that as "refuse to create this Ask", never catch-and-continue.
 */
export function prepareAskV3(params: PrepareAskV3Params): PreparedAskV3 {
  if (messageByteLength(params.message) > MAX_MESSAGE_BYTES) {
    throw messageTooLongError("message");
  }

  // --- F24: bound what an untrusted node can do to the deadline --------
  // Purely additive, and BEFORE the covenant is built. The DAA score comes
  // from a wRPC node chosen by Resolver(); a hostile one reporting
  // 499_000_000_000 yields a covenant locked ~1,585 years, invisibly,
  // because the countdown reads the same node. Both guards throw, and the
  // caller must treat that as "refuse to create this Ask".
  if (params.currentDaa !== undefined) {
    assertPlausibleDaaScore(params.networkId, params.currentDaa, params.nowMs);
    assertDeadlineWithinBound({
      currentDaa: params.currentDaa,
      deadlineDaa: params.deadlineDaa,
      ratePerSecond: DAA_ANCHORS[params.networkId]?.ratePerSecond ?? 10,
    });
  }

  // F13: the allowance is derived per-Ask from the REAL refund mass.
  const { fee, allowance } = solveRefundFee({
    networkId: params.networkId,
    amountSompi: params.amount,
    senderAddress: params.senderAddress,
    utxoTemplate: params.utxoTemplate,
  });

  const askIdHex = params.askIdHex ?? randomAskIdHex();
  const covenantParams: AskCovenantV3Params = {
    recipientXOnlyHex: xOnlyFromAddress(params.recipientAddress),
    senderAddress: params.senderAddress,
    deadlineDaa: params.deadlineDaa,
    askIdHex,
    refundAllowance: allowance,
  };
  const cov = deriveAskCovenantV3(covenantParams, params.networkId);

  const envelope: AskEnvelopeV3 = {
    v: 2,
    sender: params.senderAddress,
    recipient: params.recipientAddress,
    deadlineDaa: params.deadlineDaa.toString(),
    askId: askIdHex,
    refundAllowance: allowance.toString(),
    // Mandatory in V3: the per-Ask allowance broke V2's amount derivation,
    // so the amount must be announced explicitly or §4 cannot check funding.
    amountSompi: params.amount.toString(),
    msgEnc: "kasia1",
    // Encrypted to the RECIPIENT (Q4: encrypted only).
    message: encryptKasia1(xOnlyFromAddress(params.recipientAddress), params.message),
  };

  return {
    covenantParams,
    redeemScriptHex: cov.redeemScriptHex,
    p2shAddress: cov.p2shAddress,
    askIdHex,
    refundAllowance: allowance,
    solvedRefundFee: fee,
    envelope,
    payloadHex: encodeAskPayloadV3(envelope),
  };
}

/**
 * Rebuild the V3 covenant from the ANNOUNCEMENT alone.
 *
 * ⚠️ THIS PROVES THE ADDRESS, NOT THE FUNDING. It returns only a script
 * and a P2SH; it never sees the funded UTXO, so it cannot tell you the
 * covenant holds what the announcement claims.
 *
 * CORRECTION (second audit, 2026-08-04): an earlier version of this
 * comment called it "what makes an announcement trustworthy" and said
 * `amountSompi` closed the §4 funding gap. Both were wrong. `amountSompi`
 * is announced and copied into the cache record, but NOTHING in `src/`
 * compares it against the funded output on the V3 path, and this function
 * has no production caller — the live derivation path
 * (`asks-client.ts covenantFor`) is still V2-only, so V3 announcements
 * currently fail closed rather than verify.
 *
 * A complete §4 check needs BOTH: this address rebuild, AND
 * `utxo.amount === BigInt(envelope.amountSompi)` with
 * `utxo.outpoint.transactionId === lockTxid` — the identity check the V2
 * path performs at `asks-client.ts:141-146` and the spec does not require.
 */
export function rebuildCovenantFromAnnouncementV3(
  envelope: AskEnvelopeV3,
  networkId: string
): { redeemScriptHex: string; p2shAddress: string } {
  return deriveAskCovenantV3(
    {
      recipientXOnlyHex: xOnlyFromAddress(envelope.recipient),
      senderAddress: envelope.sender,
      deadlineDaa: BigInt(envelope.deadlineDaa),
      askIdHex: envelope.askId,
      refundAllowance: BigInt(envelope.refundAllowance),
    },
    networkId
  );
}

export interface CreatedAskV3 extends PreparedAskV3 {
  lockTxid: string;
}

/** Fund a prepared V3 Ask: one transaction carrying the covenant output
 * AND the announcement payload. */
export async function createAskV3(
  rpc: RpcClient,
  prepared: PreparedAskV3,
  opts: {
    networkId: string;
    senderAddress: string;
    senderPrivateKeyHex: string;
    amount: bigint;
  }
): Promise<CreatedAskV3> {
  const { entries } = await rpc.getUtxosByAddresses({ addresses: [opts.senderAddress] });
  const { transactions } = await createTransactions({
    entries,
    outputs: [{ address: prepared.p2shAddress, amount: opts.amount }],
    changeAddress: opts.senderAddress,
    priorityFee: 0n,
    networkId: opts.networkId,
    payload: prepared.payloadHex,
  });
  let lockTxid = "";
  for (const pending of transactions) {
    await pending.sign([opts.senderPrivateKeyHex]);
    lockTxid = await pending.submit(rpc);
  }
  if (!lockTxid) throw new Error("lock transaction was not submitted");
  return { ...prepared, lockTxid };
}
