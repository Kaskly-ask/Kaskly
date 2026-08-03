// Unit tests for the pure history classifier behind rebuild-from-chain
// (brief §3.3). Payloads are built with the project's own codec — the same
// bytes the chain carries — and malformed ones must be skipped per §2.3.
import { describe, it, expect } from "vitest";
import { scanHistory } from "../../src/lib/rebuild";
import {
  encodeAskPayload,
  encodeReplyPayload,
  REFUND_FEE_ALLOWANCE,
  toHex,
} from "../../src/lib/ask/protocol";

const OWN = "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6";
const OTHER_A = "kaspatest:qredz8z5x6emeypx7y08ujuylp5f8q36k66vap4ffanl847f3wmsqskc374cr";
const OTHER_B = "kaspatest:qq0d6h0prjm5mpdld5pncst3adu0yam6xch4tr69k2000000000000000000";

/** Minimum plausible kasia1 blob: 61 bytes of zeros, hex. */
const FAKE_CIPHERTEXT = "00".repeat(61);

const T1 = "a".repeat(64);
const T2 = "b".repeat(64);
const T3 = "c".repeat(64);
const T4 = "d".repeat(64);
const T5 = "e".repeat(64);
const REF = "f".repeat(64);

function askPayload(sender: string, recipient: string): string {
  return encodeAskPayload({
    v: 1,
    sender,
    recipient,
    deadlineDaa: "123456789",
    minRefund: "99500000",
    msgEnc: "kasia1",
    message: FAKE_CIPHERTEXT,
  });
}

describe("scanHistory (§3.3 rebuild classifier)", () => {
  it("collects asks involving the address, skips others and malformed", () => {
    const history = [
      { transaction_id: T1, payload: askPayload(OWN, OTHER_A) }, // sent by me
      { transaction_id: T2, payload: askPayload(OTHER_A, OWN) }, // sent to me
      { transaction_id: T3, payload: askPayload(OTHER_A, OTHER_B) }, // not mine
      // malformed: right namespace, garbage body (§2.3 → skip, not throw)
      { transaction_id: T4, payload: toHex(new TextEncoder().encode("ciph_msg:1:ask:a:{broken")) },
      // different Kasia kind: not ASK traffic at all
      { transaction_id: T5, payload: toHex(new TextEncoder().encode("ciph_msg:1:comm:aabbccddeeff:SGVsbG8=")) },
      { transaction_id: T5, payload: null },
    ];
    const { candidates, replyRefs } = scanHistory(history, OWN);
    expect(candidates.map((c) => c.askRef).sort()).toEqual([T1, T2]);
    expect(replyRefs).toEqual([]);
    const mine = candidates.find((c) => c.askRef === T1)!;
    expect(mine.senderAddress).toBe(OWN);
    expect(mine.recipientAddress).toBe(OTHER_A);
    expect(BigInt(mine.amountSompi)).toBe(99500000n + REFUND_FEE_ALLOWANCE);
    expect(mine.deadline).toBe("123456789");
    expect(mine.status).toBe("open");
    expect(mine.lockTxid).toBe(T1);
  });

  it("collects reply refs for recipient-side lock recovery", () => {
    const history = [
      {
        transaction_id: T1,
        payload: encodeReplyPayload({
          v: 1,
          ref: REF.toUpperCase(), // normalization expected
          msgEnc: "kasia1",
          message: FAKE_CIPHERTEXT,
        }),
      },
    ];
    const { candidates, replyRefs } = scanHistory(history, OWN);
    expect(candidates).toEqual([]);
    expect(replyRefs).toEqual([REF]);
  });
});
