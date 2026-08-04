// V3 codec ↔ covenant script AGREEMENT.
//
// The covenant reads the askId with OpTxPayloadSubstr at fixed offsets.
// The codec WRITES those bytes. If the two ever disagree by one byte,
// every V3 claim is rejected and every V3 Ask strands — an F13-class bug
// introduced by the F22 fix. Same single-source-of-truth discipline as the
// golden vector: the codec imports the offsets from covenant-v3.ts, and
// these tests assert the bytes actually land where the script looks.
import { describe, it, expect } from "vitest";
import {
  ASK_V3_REPLY_HEADER,
  ASK_ID_OFFSET,
  ASK_ID_END,
  MIN_CLAIM_PAYLOAD_LEN,
} from "../../src/lib/ask/covenant-v3";
import {
  encodeReplyPayloadV3,
  encodeAskPayloadV3,
  parseAskPayloadV3,
  ASK_V3_ANNOUNCE_HEADER,
} from "../../src/lib/ask/protocol-v3";
import { fromHex, toHex } from "../../src/lib/ask/protocol";

const ASK_ID = "3c".repeat(32);
const CIPHERTEXT = "ab".repeat(80); // ≥122 hex chars, even length
const REF = "de".repeat(32);

const reply = (askIdHex = ASK_ID) =>
  encodeReplyPayloadV3({
    askIdHex,
    envelope: { v: 2, ref: REF, msgEnc: "kasia1", message: CIPHERTEXT },
  });

describe("V3 codec ↔ covenant offsets", () => {
  it("writes the header exactly where the script reads it (0..ASK_ID_OFFSET)", () => {
    const bytes = fromHex(reply());
    const header = new TextDecoder().decode(bytes.slice(0, ASK_ID_OFFSET));
    expect(header).toBe(ASK_V3_REPLY_HEADER);
    // The script compares against these same bytes.
    expect(ASK_ID_OFFSET).toBe(new TextEncoder().encode(ASK_V3_REPLY_HEADER).length);
  });

  it("writes the askId exactly where the script reads it (ASK_ID_OFFSET..ASK_ID_END)", () => {
    const bytes = fromHex(reply());
    expect(toHex(bytes.slice(ASK_ID_OFFSET, ASK_ID_END))).toBe(ASK_ID);
    expect(ASK_ID_END - ASK_ID_OFFSET).toBe(32);
  });

  it("never emits a payload shorter than the covenant's minimum", () => {
    expect(fromHex(reply()).length).toBeGreaterThanOrEqual(MIN_CLAIM_PAYLOAD_LEN);
    expect(MIN_CLAIM_PAYLOAD_LEN).toBe(ASK_ID_END);
  });

  it("round-trips: parse recovers the same askId the encoder embedded", () => {
    const parsed = parseAskPayloadV3(reply());
    expect(parsed?.kind).toBe("reply");
    if (parsed?.kind === "reply") {
      expect(parsed.askIdHex).toBe(ASK_ID);
      expect(parsed.envelope.ref).toBe(REF);
      expect(parsed.envelope.v).toBe(2);
    }
  });

  it("a different askId changes exactly the bytes the script compares", () => {
    const a = fromHex(reply("11".repeat(32)));
    const b = fromHex(reply("22".repeat(32)));
    expect(a.slice(0, ASK_ID_OFFSET)).toEqual(b.slice(0, ASK_ID_OFFSET));
    expect(a.slice(ASK_ID_OFFSET, ASK_ID_END)).not.toEqual(
      b.slice(ASK_ID_OFFSET, ASK_ID_END)
    );
    expect(a.slice(ASK_ID_END)).toEqual(b.slice(ASK_ID_END));
  });
});

describe("V3 codec validation", () => {
  it("rejects a bad askId", () => {
    expect(() =>
      encodeReplyPayloadV3({
        askIdHex: "zz",
        envelope: { v: 2, ref: REF, msgEnc: "kasia1", message: CIPHERTEXT },
      })
    ).toThrow();
  });

  it("rejects a non-kasia1 ciphertext (Q4: encrypted only)", () => {
    expect(() =>
      encodeReplyPayloadV3({
        askIdHex: ASK_ID,
        envelope: { v: 2, ref: REF, msgEnc: "kasia1", message: "abcd" },
      })
    ).toThrow();
  });

  it("throws on a truncated V3 reply rather than returning a partial", () => {
    const short = toHex(fromHex(reply()).slice(0, MIN_CLAIM_PAYLOAD_LEN - 1));
    expect(() => parseAskPayloadV3(short)).toThrow(/shorter than the covenant/);
  });

  it("throws on a V3 reply with a garbage JSON body (F14: caller must NOT read this as refunded)", () => {
    const bytes = fromHex(reply());
    const garbage = new Uint8Array(bytes.length);
    garbage.set(bytes.slice(0, ASK_ID_END), 0);
    garbage.fill(0x7a, ASK_ID_END);
    expect(() => parseAskPayloadV3(toHex(garbage))).toThrow(/invalid JSON/);
  });

  it("returns null (not a throw) for non-V3 payloads, so V2 can be tried", () => {
    expect(parseAskPayloadV3(toHex(new TextEncoder().encode("ciph_msg:1:ask:r:{}")))).toBeNull();
    expect(parseAskPayloadV3(toHex(new TextEncoder().encode("hello")))).toBeNull();
  });

  it("round-trips the announcement envelope with askId and allowance", () => {
    const hex = encodeAskPayloadV3({
      v: 2,
      sender: "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6",
      recipient: "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6",
      deadlineDaa: "1000000",
      askId: ASK_ID,
      refundAllowance: "296400",
      msgEnc: "kasia1",
      message: CIPHERTEXT,
    });
    expect(hex.startsWith(toHex(new TextEncoder().encode(ASK_V3_ANNOUNCE_HEADER)))).toBe(true);
    const parsed = parseAskPayloadV3(hex);
    expect(parsed?.kind).toBe("ask");
    if (parsed?.kind === "ask") {
      // Both are REQUIRED under V3: without them the covenant cannot be
      // rebuilt for the §4 escrow verification.
      expect(parsed.envelope.askId).toBe(ASK_ID);
      expect(parsed.envelope.refundAllowance).toBe("296400");
    }
  });
});
