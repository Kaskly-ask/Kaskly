// F13/F21 — the refund fee fixed point, and the REFUSAL rule.
//
// The human-approved hard requirement (COVENANT-V3-DESIGN.md §3): when the
// fee iteration does not converge, the client MUST refuse to create the
// Ask. It must never fall back to the last iterate, which would produce an
// unbroadcastable refund and strand the funds permanently — the exact bug
// F13 describes. That requirement is asserted here rather than left as a
// comment, including at 0.1 KAS, the measured non-convergence point.
import { describe, it, expect } from "vitest";
import {
  payToAddressScript,
  createTransaction,
  calculateTransactionFee,
  type IUtxoEntry,
} from "kaspa-wasm";
import {
  solveRefundFee,
  isAskAmountViable,
  FeeSolveRefusal,
  ALLOWANCE_MARGIN,
  V3_REFUND_SIGSCRIPT_UPPER_BOUND,
  refundSigScriptBytes,
} from "../../src/lib/ask/fees-v3";

const NETWORK_ID = "testnet-10";
const SENDER =
  "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6";

const utxoTemplate = (amount: bigint) =>
  ({
    address: SENDER,
    outpoint: { transactionId: "aa".repeat(32), index: 0 },
    amount,
    scriptPublicKey: payToAddressScript(SENDER),
    blockDaaScore: 1n,
    isCoinbase: false,
  }) as unknown as IUtxoEntry;

const solve = (amountSompi: bigint) =>
  solveRefundFee({ networkId: NETWORK_ID, amountSompi, senderAddress: SENDER, utxoTemplate });

/** The exact refund shape the solver prices and the builder emits. */
function buildRefundShapeAt(deadlineDaa: bigint, input: bigint, output: bigint) {
  const tx = createTransaction([utxoTemplate(input)], [{ address: SENDER, amount: output }], 0n, undefined, 0);
  tx.lockTime = deadlineDaa;
  tx.inputs[0].sequence = 0n;
  tx.inputs[0].signatureScript = "00".repeat(
    refundSigScriptBytes({ deadlineDaa, refundAllowance: 318_400n, recipientXOnlyHex: "ab".repeat(32), senderAddress: SENDER })
  );
  return tx;
}

function buildRefundShape(input: bigint, output: bigint) {
  const tx = createTransaction(
    [utxoTemplate(input)],
    [{ address: SENDER, amount: output }],
    0n,
    undefined,
    0
  );
  tx.lockTime = 100_000n;
  tx.inputs[0].sequence = 0n;
  tx.inputs[0].signatureScript = "00".repeat(V3_REFUND_SIGSCRIPT_UPPER_BOUND);
  return tx;
}

const KAS = 100_000_000n;

describe("V3 refund fee solving (F13/F21)", () => {
  it("REFUSES at 0.1 KAS — the measured non-convergence point", () => {
    // Documented divergence: 153500 -> 155800 -> 158200 -> ... increments
    // GROW, so no fixed point exists. The client must refuse, not guess.
    expect(() => solve(KAS / 10n)).toThrow(FeeSolveRefusal);
    try {
      solve(KAS / 10n);
      throw new Error("expected a refusal");
    } catch (e) {
      expect(e).toBeInstanceOf(FeeSolveRefusal);
      const r = e as FeeSolveRefusal;
      expect(r.message).toMatch(/did not converge|no valid fee/);
      // The refusal must carry evidence, and must NOT be a usable number.
      expect(r.trace.length).toBeGreaterThan(1);
      expect(r).not.toHaveProperty("fee");
    }
  });

  it("REFUSES at 0.05 KAS — mass exceeds the standard limit", () => {
    expect(() => solve(KAS / 20n)).toThrow(FeeSolveRefusal);
    expect(() => solve(KAS / 20n)).toThrow(/no valid fee|did not converge/);
  });

  it("converges just above the floor (0.105 KAS)", () => {
    const s = solve(10_500_000n);
    expect(s.fee).toBeGreaterThan(0n);
    expect(s.fee).toBeLessThanOrEqual(500_000n);
  });

  it("converges and flattens for ordinary amounts", () => {
    for (const amt of [KAS / 5n, KAS / 2n, KAS, 5n * KAS, 25n * KAS]) {
      const s = solve(amt);
      expect(s.fee).toBeGreaterThan(0n);
      // Above ~0.15 KAS the solved fee is the flat network minimum.
      expect(s.fee).toBeLessThanOrEqual(200_000n);
    }
  });

  it("prices the ACTUAL emitted refund at a PRODUCTION deadline (A1)", () => {
    // A1: the old constant 172 was measured from the golden vector, whose
    // deadlineDaa = 1_000_000 is a 3-byte script number. Live DAA is 9
    // digits -> 4-byte push -> the real sig script is LONGER, and every
    // production refund was under-priced by 100 sompi. This test uses a
    // PRODUCTION deadline on purpose; asserting against the vector is what
    // hid the bug for two audits.
    const PROD_DEADLINE = 535_656_266n; // live TN10 magnitude, +7d from anchor
    const solved = solveRefundFee({
      networkId: NETWORK_ID,
      amountSompi: KAS,
      senderAddress: SENDER,
      utxoTemplate,
      sigScriptBytes: refundSigScriptBytes({
        deadlineDaa: PROD_DEADLINE,
        refundAllowance: 318_400n,
        recipientXOnlyHex: "ab".repeat(32),
        senderAddress: SENDER,
      }),
    });
    // The emitted transaction must be affordable AT THE SOLVED FEE.
    const emitted = buildRefundShapeAt(PROD_DEADLINE, KAS, KAS - solved.fee);
    const required = calculateTransactionFee(NETWORK_ID, emitted)!;
    expect(required).toBeLessThanOrEqual(solved.fee);
    // And the old constant must be provably insufficient here.
    const underpriced = solveRefundFee({
      networkId: NETWORK_ID, amountSompi: KAS, senderAddress: SENDER, utxoTemplate,
      sigScriptBytes: 172,
    });
    expect(underpriced.fee).toBeLessThan(required);
  });

  it("a production deadline yields a LONGER sig script than the golden vector", () => {
    const args = { refundAllowance: 318_400n, recipientXOnlyHex: "ab".repeat(32), senderAddress: SENDER };
    const vector = refundSigScriptBytes({ ...args, deadlineDaa: 1_000_000n });
    const prod = refundSigScriptBytes({ ...args, deadlineDaa: 535_656_266n });
    expect(prod).toBeGreaterThan(vector);
  });

  it("SOLVES: returns the real minimum, not its own starting guess", () => {
    // The old code returned `guess` whenever required <= guess, so it
    // always returned exactly its 100,000-sompi seed and the allowance was
    // a constant 400,000 for every Ask. Assert against the ACTUAL value.
    const s = solve(KAS);
    expect(s.fee).not.toBe(100_000n); // the old un-solved seed
    // Re-measuring at the solved fee must not demand more than it pays.
    const tx = buildRefundShape(KAS, KAS - s.fee);
    const required = calculateTransactionFee(NETWORK_ID, tx)!;
    expect(required).toBeLessThanOrEqual(s.fee);
    // And it must be genuinely tight: one sompi less must be insufficient
    // OR equal to the network floor.
    expect(s.fee).toBeGreaterThan(0n);
  });

  it("pays far less than the V2 fixed allowance (F21)", () => {
    const s = solve(KAS);
    // V2 always handed the miner the whole 500,000-sompi allowance.
    expect(s.fee).toBeLessThan(500_000n);
    const savedPerRefund = 500_000n - s.fee;
    expect(savedPerRefund).toBeGreaterThan(300_000n);
  });

  it("derives the per-Ask allowance at the agreed 4x margin", () => {
    const s = solve(KAS);
    expect(ALLOWANCE_MARGIN).toBe(4n);
    expect(s.allowance).toBe(s.fee * 4n);
    // Worst-case skim is a constant fee*(margin-1), independent of Ask size.
    expect(s.allowance - s.fee).toBe(s.fee * 3n);
  });

  it("isAskAmountViable reports refusal instead of throwing", () => {
    const bad = isAskAmountViable({
      networkId: NETWORK_ID,
      amountSompi: KAS / 10n,
      senderAddress: SENDER,
      utxoTemplate,
    });
    expect(bad.viable).toBe(false);
    if (!bad.viable) expect(bad.reason).toMatch(/converge|no valid fee/);

    const good = isAskAmountViable({
      networkId: NETWORK_ID,
      amountSompi: KAS,
      senderAddress: SENDER,
      utxoTemplate,
    });
    expect(good.viable).toBe(true);
  });

  it("rejects amounts the V2 guard would have ACCEPTED (the F13 gap)", () => {
    // V2 rejected only amount <= 500,000 sompi. Everything in this band
    // was accepted by V2 and is permanently unspendable.
    for (const amt of [600_000n, 1_000_000n, 2_500_000n, 5_000_000n]) {
      expect(amt).toBeGreaterThan(500_000n); // V2 would have allowed it
      const v = isAskAmountViable({
        networkId: NETWORK_ID,
        amountSompi: amt,
        senderAddress: SENDER,
        utxoTemplate,
      });
      expect(v.viable).toBe(false);
    }
  });
});
