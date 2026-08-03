import { describe, it, expect } from "vitest";
import { deriveAskCovenant } from "../../src/lib/ask/covenant";
import { xOnlyFromAddress } from "../../src/lib/ask/node";

// GOLDEN VECTOR: the exact V2 covenant that executed on testnet-10 on
// 2026-08-03 — lock c851addd...4cb3cc, sig-less open refund 878b8fc0...3366
// (both R2-verified from raw chain data; PROGRESS.md Phase 2). If this test
// breaks, the library no longer produces the proven script.
const SENDER = "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6";
const RECIPIENT = "kaspatest:qredz8z5x6emeypx7y08ujuylp5f8q36k66vap4ffanl847f3wmsqskc374cr";
const GOLDEN_REDEEM =
  "63005fb80f636970685f6d73673a313a61736b3a8820f2d11c5436b3bc9026f11e7e4b84f86893823ab6b4ce86a94f67f3d7c98bb700ac67047900d51fb0b4519d00c324000020a39d1a2a2bc880e3cf84b48d8e025213f1f12a27835b37a8e38855e354a9f314ac8800c204e03fee05a268";
const GOLDEN_P2SH =
  "kaspatest:pzmq6f882flz0f076wtex6jtvem5xctqn3xwr0r8wuxmsn4j6vy4vuaqdg3ej";

describe("ASK covenant builder (ASKSPEC §3)", () => {
  it("reproduces the on-chain-proven V2 redeem script byte-for-byte", () => {
    const covenant = deriveAskCovenant(
      {
        recipientXOnlyHex: xOnlyFromAddress(RECIPIENT),
        senderAddress: SENDER,
        deadlineDaa: 534052985n,
        minRefund: 99500000n,
      },
      "testnet-10"
    );
    expect(covenant.redeemScriptHex).toBe(GOLDEN_REDEEM);
    expect(covenant.p2shAddress).toBe(GOLDEN_P2SH);
  });

  it("different params yield different P2SH addresses", () => {
    const a = deriveAskCovenant(
      {
        recipientXOnlyHex: xOnlyFromAddress(RECIPIENT),
        senderAddress: SENDER,
        deadlineDaa: 534052985n,
        minRefund: 99500000n,
      },
      "testnet-10"
    );
    const b = deriveAskCovenant(
      {
        recipientXOnlyHex: xOnlyFromAddress(RECIPIENT),
        senderAddress: SENDER,
        deadlineDaa: 534052986n, // deadline +1
        minRefund: 99500000n,
      },
      "testnet-10"
    );
    expect(a.p2shAddress).not.toBe(b.p2shAddress);
  });

  it("rejects invalid parameters", () => {
    const base = {
      recipientXOnlyHex: xOnlyFromAddress(RECIPIENT),
      senderAddress: SENDER,
      deadlineDaa: 534052985n,
      minRefund: 99500000n,
    };
    expect(() =>
      deriveAskCovenant({ ...base, recipientXOnlyHex: "beef" }, "testnet-10")
    ).toThrow();
    expect(() =>
      deriveAskCovenant({ ...base, deadlineDaa: 500_000_000_000n }, "testnet-10")
    ).toThrow(/DAA score/);
    expect(() =>
      deriveAskCovenant({ ...base, deadlineDaa: 0n }, "testnet-10")
    ).toThrow();
    expect(() =>
      deriveAskCovenant({ ...base, minRefund: 0n }, "testnet-10")
    ).toThrow(/minRefund/);
  });
});
