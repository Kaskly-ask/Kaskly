// Beta-hardening tests for the cache-record validator: the cache API is
// open on a shared server, so junk must be rejected at the door and
// anything accepted must be bounded in size.
import { describe, it, expect } from "vitest";
import { validateAskRecord } from "../../src/lib/ask-record";

const VALID = {
  askRef: "a".repeat(64),
  senderAddress:
    "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6",
  recipientAddress:
    "kaspatest:qredz8z5x6emeypx7y08ujuylp5f8q36k66vap4ffanl847f3wmsqskc374cr",
  amountSompi: "100000000",
  messageCiphertext: "00".repeat(61),
  deadline: "123456789",
  lockTxid: "a".repeat(64),
  claimTxid: null,
  refundTxid: null,
  status: "open",
};

describe("validateAskRecord (beta hardening)", () => {
  it("accepts a well-formed record", () => {
    expect(validateAskRecord(VALID).askRef).toBe(VALID.askRef);
  });

  it("rejects oversized ciphertext (DB-bloat vector)", () => {
    expect(() =>
      validateAskRecord({ ...VALID, messageCiphertext: "00".repeat(16385) })
    ).toThrow(/invalid ask record/);
  });

  it("rejects non-hex and too-short ciphertext", () => {
    expect(() =>
      validateAskRecord({ ...VALID, messageCiphertext: "zz".repeat(61) })
    ).toThrow(/invalid ask record/);
    expect(() =>
      validateAskRecord({ ...VALID, messageCiphertext: "00".repeat(60) })
    ).toThrow(/invalid ask record/);
  });

  it("rejects overlong amounts and deadlines (BigInt bombs)", () => {
    expect(() =>
      validateAskRecord({ ...VALID, amountSompi: "9".repeat(21) })
    ).toThrow(/invalid ask record/);
    expect(() =>
      validateAskRecord({ ...VALID, deadline: "9".repeat(13) })
    ).toThrow(/invalid ask record/);
  });

  it("rejects malformed addresses", () => {
    expect(() =>
      validateAskRecord({ ...VALID, senderAddress: "<script>alert(1)</script>" })
    ).toThrow(/invalid ask record/);
    expect(() =>
      validateAskRecord({ ...VALID, recipientAddress: "kaspatest:" + "q".repeat(500) })
    ).toThrow(/invalid ask record/);
  });
});
