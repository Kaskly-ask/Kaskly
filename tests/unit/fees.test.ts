// Unit tests for mass-proportional claim fees (Phase 3 gate finding F7):
// the network minimum scales with byte size, so a fixed fee under-pays for
// long replies. No network access — the SDK computes mass locally.
import { describe, it, expect } from "vitest";
import { payToAddressScript, calculateTransactionFee, createTransaction } from "kaspa-wasm";
import {
  quoteClaimFee,
  buildClaimSignatureScript,
  CLAIM_FEE_FLOOR,
  deriveAskCovenant,
  xOnlyFromAddress,
  encodeReplyPayload,
} from "../../src/lib/ask";
import type { IUtxoEntry } from "kaspa-wasm";

const NETWORK_ID = "testnet-10";
const SENDER =
  "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6";
const RECIPIENT =
  "kaspatest:qredz8z5x6emeypx7y08ujuylp5f8q36k66vap4ffanl847f3wmsqskc374cr";

function fixture(amount: bigint, plaintextBytes: number) {
  const cov = deriveAskCovenant(
    {
      recipientXOnlyHex: xOnlyFromAddress(RECIPIENT),
      senderAddress: SENDER,
      deadlineDaa: 123_456_789n,
      minRefund: amount - 500_000n,
    },
    NETWORK_ID
  );
  const spk = payToAddressScript(cov.p2shAddress).toJSON() as unknown as {
    version: number;
    script: string;
  };
  const covenantUtxo = {
    outpoint: { transactionId: "0".repeat(64), index: 0 },
    amount,
    scriptPublicKey: { version: spk.version, script: spk.script },
    blockDaaScore: 0n,
    isCoinbase: false,
  } as unknown as IUtxoEntry;
  const payloadHex = encodeReplyPayload({
    v: 1,
    ref: "0".repeat(64),
    msgEnc: "kasia1",
    message: "00".repeat(plaintextBytes + 61),
  });
  return { cov, covenantUtxo, payloadHex };
}

describe("quoteClaimFee (F7: mass-proportional fees)", () => {
  it("short replies stay at the conventional floor", () => {
    const { cov, covenantUtxo, payloadHex } = fixture(100_000_000n, 40);
    const { fee, net } = quoteClaimFee({
      networkId: NETWORK_ID,
      covenantUtxo,
      redeemScriptHex: cov.redeemScriptHex,
      recipientAddress: RECIPIENT,
      payloadHex,
    });
    expect(fee).toBe(CLAIM_FEE_FLOOR);
    expect(net).toBe(100_000_000n - CLAIM_FEE_FLOOR);
  });

  it("near-limit replies scale above the floor and self-verify", () => {
    const { cov, covenantUtxo, payloadHex } = fixture(100_000_000n, 7_800);
    const { fee, net } = quoteClaimFee({
      networkId: NETWORK_ID,
      covenantUtxo,
      redeemScriptHex: cov.redeemScriptHex,
      recipientAddress: RECIPIENT,
      payloadHex,
    });
    expect(fee).toBeGreaterThan(CLAIM_FEE_FLOOR);
    expect(net).toBe(100_000_000n - fee);
    // Self-consistency: a transaction built AT the quoted fee must satisfy
    // the SDK's own minimum for its final serialized form.
    const tx = createTransaction(
      [covenantUtxo],
      [{ address: RECIPIENT, amount: net }],
      0n,
      payloadHex,
      1
    );
    tx.inputs[0].signatureScript = buildClaimSignatureScript(
      cov.redeemScriptHex,
      "41" + "00".repeat(65)
    );
    const min = calculateTransactionFee(NETWORK_ID, tx, 1)!;
    expect(fee).toBeGreaterThanOrEqual(min);
  });

  it("rejects replies whose fee would swallow a small Ask", () => {
    const { cov, covenantUtxo, payloadHex } = fixture(1_000_000n, 7_800);
    expect(() =>
      quoteClaimFee({
        networkId: NETWORK_ID,
        covenantUtxo,
        redeemScriptHex: cov.redeemScriptHex,
        recipientAddress: RECIPIENT,
        payloadHex,
      })
    ).toThrow(/too long for this Ask/i);
  });
});
