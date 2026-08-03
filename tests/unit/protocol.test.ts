import { describe, it, expect } from "vitest";
import {
  ASK_PREFIX,
  MAX_PAYLOAD_BYTES,
  encodeAskPayload,
  encodeReplyPayload,
  parseAskPayload,
  toHex,
  type AskEnvelope,
  type ReplyEnvelope,
} from "../../src/lib/ask/protocol";

// kasia1 ciphertexts are opaque hex; a shaped dummy (>= 61 bytes) is enough
// for codec tests. Real crypto is covered in crypto.test.ts.
const CIPHERTEXT = "ab".repeat(80);

const ask: AskEnvelope = {
  v: 1,
  sender: "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6",
  recipient: "kaspatest:qredz8z5x6emeypx7y08ujuylp5f8q36k66vap4ffanl847f3wmsqskc374cr",
  deadlineDaa: "534052985",
  minRefund: "99500000",
  msgEnc: "kasia1",
  message: CIPHERTEXT,
};

const reply: ReplyEnvelope = {
  v: 1,
  ref: "a9ad888565d4aa713a2dd7a3ca368b09f8a46e5ecb0156ebc4ac35f6227ff01c",
  msgEnc: "kasia1",
  message: CIPHERTEXT,
};

describe("payload codec (ASKSPEC §2)", () => {
  it("round-trips an ask envelope", () => {
    const hex = encodeAskPayload(ask);
    const parsed = parseAskPayload(hex);
    expect(parsed).toEqual({ kind: "ask", envelope: ask });
  });

  it("round-trips a reply envelope", () => {
    const hex = encodeReplyPayload(reply);
    const parsed = parseAskPayload(hex);
    expect(parsed).toEqual({ kind: "reply", envelope: reply });
  });

  it("every encoded payload starts with the covenant-enforced prefix", () => {
    const prefixHex = toHex(new TextEncoder().encode(ASK_PREFIX));
    expect(encodeAskPayload(ask).startsWith(prefixHex)).toBe(true);
    expect(encodeReplyPayload(reply).startsWith(prefixHex)).toBe(true);
  });

  it("returns null for non-ASK payloads (foreign traffic is ignored)", () => {
    // Kasia comm message — same ciph_msg namespace, different kind.
    const kasia = toHex(new TextEncoder().encode("ciph_msg:1:comm:aabbccddeeff:SGVsbG8="));
    expect(parseAskPayload(kasia)).toBeNull();
    expect(parseAskPayload("")).toBeNull();
    expect(parseAskPayload("not-hex")).toBeNull();
    expect(parseAskPayload("00ff00ff")).toBeNull();
  });

  it("throws on malformed ASK-namespace payloads (R3: malformed payload)", () => {
    const bad = (s: string) => toHex(new TextEncoder().encode(s));
    expect(() => parseAskPayload(bad(`${ASK_PREFIX}nosubkind`))).toThrow();
    expect(() => parseAskPayload(bad(`${ASK_PREFIX}a:{not json`))).toThrow();
    expect(() => parseAskPayload(bad(`${ASK_PREFIX}z:{}`))).toThrow(/unknown subkind/);
    expect(() => parseAskPayload(bad(`${ASK_PREFIX}a:{"v":2}`))).toThrow(/malformed/);
    // deadline must be a decimal string
    const badDeadline = { ...ask, deadlineDaa: "0x123" };
    expect(() =>
      parseAskPayload(bad(`${ASK_PREFIX}a:${JSON.stringify(badDeadline)}`))
    ).toThrow(/malformed/);
    // reply ref must be a 64-hex txid
    const badRef = { ...reply, ref: "zz" };
    expect(() =>
      parseAskPayload(bad(`${ASK_PREFIX}r:${JSON.stringify(badRef)}`))
    ).toThrow(/malformed/);
  });

  it("rejects any msgEnc other than kasia1 — encrypted only (Q4)", () => {
    const bad = (s: string) => toHex(new TextEncoder().encode(s));
    for (const enc of ["plain", "none", "kasia2", ""]) {
      const env = { ...ask, msgEnc: enc };
      expect(() =>
        parseAskPayload(bad(`${ASK_PREFIX}a:${JSON.stringify(env)}`))
      ).toThrow(/malformed/);
    }
    // plaintext-looking message under kasia1 is malformed too
    const notHex = { ...ask, message: "hello there, this is plaintext!" };
    expect(() =>
      parseAskPayload(bad(`${ASK_PREFIX}a:${JSON.stringify(notHex)}`))
    ).toThrow(/malformed/);
    // too-short "ciphertext" cannot even hold nonce+key+tag
    const tooShort = { ...ask, message: "ab".repeat(30) };
    expect(() =>
      parseAskPayload(bad(`${ASK_PREFIX}a:${JSON.stringify(tooShort)}`))
    ).toThrow(/malformed/);
    // encoder enforces the same
    expect(() => encodeAskPayload(notHex as never)).toThrow(/kasia1/);
  });

  it("enforces size limits (R3: oversized payload)", () => {
    const big = { ...ask, message: "ab".repeat(MAX_PAYLOAD_BYTES) };
    expect(() => encodeAskPayload(big)).toThrow(/exceeds/);
    const nearLimitJunk = "y".repeat(MAX_PAYLOAD_BYTES * 2);
    expect(parseAskPayload(toHex(new TextEncoder().encode(nearLimitJunk)))).toBeNull();
  });
});
