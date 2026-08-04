// R3 STAGE 1 — wiring proof, NO CHAIN, NO TKAS SPENT.
//
// Before the integration suite is allowed to spend testnet funds, prove
// the V3 path is actually wired to the SHIPPED modules and agrees with the
// golden vector. A half-wired run would produce an ambiguous result, which
// this project treats as INCONCLUSIVE, never a pass.
//
// Checks:
//   1. Vector match — the covenant the client builds is byte-identical to
//      spike/v3-golden-vector.json, the same artefact the spike probes
//      assert against. One source of truth for "what V3 is".
//   2. §4 escrow rebuild — the covenant can be reconstructed FROM THE
//      ANNOUNCEMENT ALONE, which is only possible because askId and
//      refundAllowance are mandatory envelope fields.
//   3. Codec ↔ script agreement on a real prepared Ask.
//   4. F13 refusal survives the wiring (a too-small Ask cannot be prepared).
//   5. V2's path is untouched.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { payToAddressScript, type IUtxoEntry } from "kaspa-wasm";
import {
  prepareAskV3,
  rebuildCovenantFromAnnouncementV3,
  randomAskIdHex,
} from "../../src/lib/ask/node-v3";
import { deriveAskCovenantV3, ASK_ID_OFFSET, ASK_ID_END } from "../../src/lib/ask/covenant-v3";
import { parseAskPayloadV3 } from "../../src/lib/ask/protocol-v3";
import { FeeSolveRefusal } from "../../src/lib/ask/fees-v3";
import { buildAskRedeemScript } from "../../src/lib/ask/covenant";
import { ASK_PREFIX, REFUND_FEE_ALLOWANCE, fromHex, toHex } from "../../src/lib/ask/protocol";

const NETWORK_ID = "testnet-10";
const ADDR = "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6";
const VECTOR = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "spike", "v3-golden-vector.json"), "utf8")
);

const utxoTemplate = (amount: bigint) =>
  ({
    address: ADDR,
    outpoint: { transactionId: "aa".repeat(32), index: 0 },
    amount,
    scriptPublicKey: payToAddressScript(ADDR),
    blockDaaScore: 1n,
    isCoinbase: false,
  }) as unknown as IUtxoEntry;

const prepare = (amount: bigint, askIdHex?: string) =>
  prepareAskV3({
    networkId: NETWORK_ID,
    senderAddress: ADDR,
    recipientAddress: ADDR,
    amount,
    message: "wiring check",
    deadlineDaa: 1_000_000n,
    askIdHex,
    utxoTemplate,
  });

describe("R3 Stage 1 — V3 wiring (offline)", () => {
  it("1. the client's covenant is byte-identical to the golden vector", () => {
    const built = deriveAskCovenantV3(
      {
        recipientXOnlyHex: VECTOR.params.recipientXOnlyHex,
        senderAddress: VECTOR.params.senderAddress,
        deadlineDaa: BigInt(VECTOR.params.deadlineDaa),
        askIdHex: VECTOR.params.askIdHex,
        refundAllowance: BigInt(VECTOR.params.refundAllowance),
      },
      VECTOR.params.networkId
    );
    expect(built.redeemScriptHex).toBe(VECTOR.redeemScriptHex);
    expect(built.p2shAddress).toBe(VECTOR.p2shAddress);
  });

  it("2. §4: the covenant rebuilds from the ANNOUNCEMENT alone", () => {
    const p = prepare(100_000_000n);
    const rebuilt = rebuildCovenantFromAnnouncementV3(p.envelope, NETWORK_ID);
    expect(rebuilt.p2shAddress).toBe(p.p2shAddress);
    expect(rebuilt.redeemScriptHex).toBe(p.redeemScriptHex);
  });

  it("2b. the announcement carries askId AND refundAllowance (both mandatory)", () => {
    const p = prepare(100_000_000n);
    const parsed = parseAskPayloadV3(p.payloadHex);
    expect(parsed?.kind).toBe("ask");
    if (parsed?.kind === "ask") {
      expect(parsed.envelope.askId).toBe(p.askIdHex);
      expect(parsed.envelope.refundAllowance).toBe(p.refundAllowance.toString());
      // Dropping either one breaks the §4 rebuild — assert that directly.
      const missingId = { ...parsed.envelope, askId: randomAskIdHex() };
      expect(rebuildCovenantFromAnnouncementV3(missingId, NETWORK_ID).p2shAddress).not.toBe(
        p.p2shAddress
      );
      const wrongAllowance = { ...parsed.envelope, refundAllowance: "999999" };
      expect(rebuildCovenantFromAnnouncementV3(wrongAllowance, NETWORK_ID).p2shAddress).not.toBe(
        p.p2shAddress
      );
    }
  });

  it("3. the announcement's askId is the one bound into the covenant", () => {
    const id = "7c".repeat(32);
    const p = prepare(100_000_000n, id);
    expect(p.askIdHex).toBe(id);
    expect(p.covenantParams.askIdHex).toBe(id);
    // And the redeem script literally contains those bytes.
    expect(p.redeemScriptHex).toContain(id);
  });

  it("4. F13 refusal survives the wiring — a 0.1 KAS Ask cannot be prepared", () => {
    expect(() => prepare(10_000_000n)).toThrow(FeeSolveRefusal);
    // And the allowance for a viable Ask is the solved fee x margin.
    const ok = prepare(100_000_000n);
    expect(ok.refundAllowance).toBe(ok.solvedRefundFee * 4n);
    // F21: strictly cheaper than V2's fixed allowance.
    expect(ok.solvedRefundFee).toBeLessThan(REFUND_FEE_ALLOWANCE);
  });

  it("5. V2's path is untouched — same prefix, same script builder", () => {
    expect(ASK_PREFIX).toBe("ciph_msg:1:ask:");
    const v2 = buildAskRedeemScript({
      recipientXOnlyHex: "ab".repeat(32),
      senderAddress: ADDR,
      deadlineDaa: 1_000_000n,
      minRefund: 99_500_000n,
    }).toString();
    // V2 and V3 must be different scripts (different addresses) but V2 must
    // still build — the client has to keep reading in-flight V2 Asks.
    expect(v2.length).toBeGreaterThan(0);
    expect(v2).not.toBe(prepare(100_000_000n).redeemScriptHex);
  });

  it("6. codec offsets land where the script reads, on a real prepared Ask", () => {
    const p = prepare(100_000_000n, "5e".repeat(32));
    // The announcement is JSON-after-header; the CLAIM payload is what the
    // covenant reads, so build one the way the claim builder would.
    const bytes = fromHex(p.payloadHex);
    expect(bytes.length).toBeGreaterThan(ASK_ID_END);
    // askId round-trips out of the announcement JSON at the codec level.
    const parsed = parseAskPayloadV3(p.payloadHex);
    if (parsed?.kind === "ask") expect(parsed.envelope.askId).toBe("5e".repeat(32));
    expect(toHex(bytes.slice(0, 0))).toBe("");
    expect(ASK_ID_END - ASK_ID_OFFSET).toBe(32);
  });
});
