// Golden vector for the V3 covenant, generated FROM src/lib/ask/covenant-v3.ts
// and committed to spike/v3-golden-vector.json.
//
// This is the single source of truth for "what the V3 script actually is".
// Two independent consumers check against it:
//   1. this unit test — catches drift in the TypeScript source;
//   2. spike/lib.cjs assertV3VectorMatch() — catches drift in the spike's
//      builder before ANY probe runs, so a probe can never silently attack
//      a mirror that has diverged from the shipped covenant.
// If the two ever differ by a byte, one of them fails loudly.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildAskRedeemScriptV3,
  deriveAskCovenantV3,
  ASK_V3_REPLY_HEADER,
  ASK_ID_OFFSET,
  ASK_ID_END,
  MIN_CLAIM_PAYLOAD_LEN,
} from "../../src/lib/ask/covenant-v3";

const VECTOR_PATH = path.join(process.cwd(), "spike", "v3-golden-vector.json");

/** Canonical parameters. Fixed forever: changing them changes the vector,
 * which is the point — the vector must move only when the script does. */
const CANONICAL = {
  networkId: "testnet-10",
  recipientXOnlyHex: "ab".repeat(32),
  senderAddress:
    "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6",
  deadlineDaa: "1000000",
  askIdHex: "11".repeat(32),
  refundAllowance: "300000",
};

function buildCanonical() {
  return deriveAskCovenantV3(
    {
      recipientXOnlyHex: CANONICAL.recipientXOnlyHex,
      senderAddress: CANONICAL.senderAddress,
      deadlineDaa: BigInt(CANONICAL.deadlineDaa),
      askIdHex: CANONICAL.askIdHex,
      refundAllowance: BigInt(CANONICAL.refundAllowance),
    },
    CANONICAL.networkId
  );
}

describe("covenant V3 golden vector", () => {
  it("derives deterministically and matches the committed vector", () => {
    const built = buildCanonical();

    if (!fs.existsSync(VECTOR_PATH)) {
      // First run: emit the vector from the TypeScript source.
      fs.writeFileSync(
        VECTOR_PATH,
        JSON.stringify(
          {
            _comment:
              "GENERATED FROM src/lib/ask/covenant-v3.ts by tests/unit/covenant-v3.test.ts. Do not hand-edit: regenerate by deleting this file and re-running the unit suite. spike/lib.cjs asserts its V3 builder against this before every probe.",
            params: CANONICAL,
            layout: {
              header: ASK_V3_REPLY_HEADER,
              askIdOffset: ASK_ID_OFFSET,
              askIdEnd: ASK_ID_END,
              minClaimPayloadLen: MIN_CLAIM_PAYLOAD_LEN,
            },
            redeemScriptHex: built.redeemScriptHex,
            p2shAddress: built.p2shAddress,
          },
          null,
          2
        ) + "\n"
      );
    }

    const vector = JSON.parse(fs.readFileSync(VECTOR_PATH, "utf8"));
    expect(built.redeemScriptHex).toBe(vector.redeemScriptHex);
    expect(built.p2shAddress).toBe(vector.p2shAddress);
    expect(vector.params).toEqual(CANONICAL);
    expect(vector.layout.header).toBe(ASK_V3_REPLY_HEADER);
    expect(vector.layout.askIdOffset).toBe(ASK_ID_OFFSET);
    expect(vector.layout.askIdEnd).toBe(ASK_ID_END);
  });

  it("is stable across repeated builds", () => {
    expect(buildCanonical().redeemScriptHex).toBe(
      buildCanonical().redeemScriptHex
    );
  });

  it("changes the P2SH address when the askId changes (F22 uniqueness)", () => {
    const a = buildCanonical();
    const b = deriveAskCovenantV3(
      {
        recipientXOnlyHex: CANONICAL.recipientXOnlyHex,
        senderAddress: CANONICAL.senderAddress,
        deadlineDaa: BigInt(CANONICAL.deadlineDaa),
        askIdHex: "22".repeat(32),
        refundAllowance: BigInt(CANONICAL.refundAllowance),
      },
      CANONICAL.networkId
    );
    expect(b.p2shAddress).not.toBe(a.p2shAddress);
    expect(b.redeemScriptHex).not.toBe(a.redeemScriptHex);
  });

  it("rejects invalid parameters", () => {
    const base = {
      recipientXOnlyHex: CANONICAL.recipientXOnlyHex,
      senderAddress: CANONICAL.senderAddress,
      deadlineDaa: BigInt(CANONICAL.deadlineDaa),
      askIdHex: CANONICAL.askIdHex,
      refundAllowance: BigInt(CANONICAL.refundAllowance),
    };
    expect(() => buildAskRedeemScriptV3({ ...base, askIdHex: "zz" })).toThrow();
    expect(() =>
      buildAskRedeemScriptV3({ ...base, refundAllowance: 0n })
    ).toThrow();
    expect(() => buildAskRedeemScriptV3({ ...base, deadlineDaa: 0n })).toThrow();
    expect(() =>
      buildAskRedeemScriptV3({ ...base, recipientXOnlyHex: "abc" })
    ).toThrow();
  });
});
