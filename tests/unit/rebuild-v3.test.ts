// PHASE 2 — rebuild-from-chain must recover V3 Asks.
//
// Brief §3.3 makes the cache a cache: "the DB can be dropped and
// reconstructed". `scanHistory` is where that promise is kept — it turns
// raw indexer history back into records. It only ever called the V2 parser.
//
// A V3 announcement uses the header `ciph_msg:1:ask:a2:`, which still starts
// with the V2 namespace prefix, so it passes rebuild's prefix filter and
// then falls into a parser that does not understand it. The `catch` treats
// that as a malformed payload and skips it — silently. Result: after the
// wiring, every Ask the client creates is invisible to rebuild. Drop the DB
// and the sender's own Asks do not come back, including open ones still
// holding their money.
//
// EXPECTED STATE WHEN FIRST COMMITTED: red — the V3 announcement produces
// zero candidates. The V2 control passes throughout, so a failure here is
// the version gap and not a broken fixture.
import { describe, it, expect } from "vitest";
import { scanHistory, type RestFullTx } from "../../src/lib/rebuild";
import { encodeAskPayloadV3, encodeReplyPayloadV3 } from "../../src/lib/ask/protocol-v3";
import { encodeAskPayload, REFUND_FEE_ALLOWANCE } from "../../src/lib/ask/protocol";
import { DAA_ANCHORS } from "../../src/lib/ask/daa-guard";

const ANCHOR = DAA_ANCHORS["testnet-10"];
// Live-magnitude deadline, per the anti-fixture rule.
const DEADLINE = (
  ANCHOR.daaScore + BigInt(8 * 86_400 * ANCHOR.ratePerSecond)
).toString();

const SENDER = "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6";
const RECIPIENT = "kaspatest:qrxx6ay3mxr8k3rlpvsxjtvhy8ptqpwvxsx9rvfx8xrgvsxpqgn4qs5r0kd0z";
const CIPHERTEXT = "00".repeat(80);
const ASK_ID = "7a".repeat(32);
const ALLOWANCE = 321_600n;
const AMOUNT = 100_000_000n;
const V3_LOCK = "d3".repeat(32);
const V2_LOCK = "d2".repeat(32);

const v3Announcement: RestFullTx = {
  transaction_id: V3_LOCK,
  payload: encodeAskPayloadV3({
    v: 2,
    sender: SENDER,
    recipient: RECIPIENT,
    deadlineDaa: DEADLINE,
    askId: ASK_ID,
    refundAllowance: ALLOWANCE.toString(),
    amountSompi: AMOUNT.toString(),
    msgEnc: "kasia1",
    message: CIPHERTEXT,
  }),
};

const v2Announcement: RestFullTx = {
  transaction_id: V2_LOCK,
  payload: encodeAskPayload({
    v: 1,
    sender: SENDER,
    recipient: RECIPIENT,
    deadlineDaa: DEADLINE,
    minRefund: (AMOUNT - REFUND_FEE_ALLOWANCE).toString(),
    msgEnc: "kasia1",
    message: CIPHERTEXT,
  }),
};

const v3Reply: RestFullTx = {
  transaction_id: "e3".repeat(32),
  payload: encodeReplyPayloadV3({
    askIdHex: ASK_ID,
    envelope: { v: 2, ref: V3_LOCK, msgEnc: "kasia1", message: CIPHERTEXT },
  }),
};

describe("rebuild-from-chain recovers V3 Asks", () => {
  it("CONTROL: a V2 announcement still rebuilds as a V2 record", () => {
    const { candidates } = scanHistory([v2Announcement], SENDER);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].protocolVersion).toBe(1);
    expect(candidates[0].askId).toBeNull();
    expect(candidates[0].amountSompi).toBe(AMOUNT.toString());
  });

  it("a V3 announcement rebuilds with its covenant parameters intact", () => {
    const { candidates } = scanHistory([v3Announcement], SENDER);
    expect(
      candidates,
      "the V3 announcement was skipped — after the wiring that means a " +
        "dropped cache loses every Ask this client created, funds included"
    ).toHaveLength(1);
    const c = candidates[0];
    expect(c.protocolVersion).toBe(2);
    // Without BOTH of these the covenant cannot be rebuilt, so the record
    // would be unusable even if it were surfaced.
    expect(c.askId).toBe(ASK_ID);
    expect(c.refundAllowance).toBe(ALLOWANCE.toString());
    // V3 announces the amount outright; it is NOT minRefund + a constant.
    expect(c.amountSompi).toBe(AMOUNT.toString());
    expect(c.lockTxid).toBe(V3_LOCK);
    expect(c.messageCiphertext).toBe(CIPHERTEXT);
  });

  it("a V3 reply yields a recipient-side lead to its lock", () => {
    // The recipient's own history contains the CLAIM, not the lock. This ref
    // is how rebuild walks back to the Ask.
    const { replyRefs } = scanHistory([v3Reply], RECIPIENT);
    expect(replyRefs).toContain(V3_LOCK.toLowerCase());
  });

  it("both versions rebuild from one mixed history", () => {
    const { candidates } = scanHistory([v2Announcement, v3Announcement], SENDER);
    expect(candidates.map((c) => c.protocolVersion).sort()).toEqual([1, 2]);
  });

  it("a malformed V3 payload is skipped, never surfaced", () => {
    const junk: RestFullTx = {
      transaction_id: "ee".repeat(32),
      payload: Buffer.from("ciph_msg:1:ask:a2:{not json", "utf8").toString("hex"),
    };
    expect(scanHistory([junk], SENDER).candidates).toHaveLength(0);
  });
});
