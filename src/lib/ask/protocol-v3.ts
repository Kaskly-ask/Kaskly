// V3 payload codec (COVENANT-V3-DESIGN.md §2, §10).
//
// V3 changes the reply payload LAYOUT, because mechanism M1 needs the
// per-Ask askId at a FIXED byte offset the covenant can read with
// OpTxPayloadSubstr — the chain cannot parse JSON.
//
//   V2 reply:  "ciph_msg:1:ask:r:"  ‖ JSON
//   V3 reply:  "ciph_msg:1:ask:r2:" ‖ <32 raw askId bytes> ‖ JSON
//                \__ 18 bytes ____/   \__ offsets 18..50 __/
//
// The subkind changed (`r:` → `r2:`) rather than the namespace, so Kasia
// clients and explorers keep classifying ASK traffic natively while an old
// parser meets an unknown subkind at byte 15 and SKIPS instead of
// mis-reading 32 raw bytes as the start of JSON (ASKSPEC §11).
//
// SINGLE SOURCE OF TRUTH FOR OFFSETS: this module does not restate the
// layout. It IMPORTS the same constants the redeem script is built from,
// so the codec that WRITES the payload and the script that READS it cannot
// disagree. If they ever did, every claim would strand. Pinned by
// tests/unit/protocol-v3.test.ts.
import {
  ASK_V3_REPLY_HEADER,
  ASK_ID_OFFSET,
  ASK_ID_END,
  ASK_ID_BYTES,
  MIN_CLAIM_PAYLOAD_LEN,
} from "./covenant-v3";
import { MAX_PAYLOAD_BYTES, MAX_MESSAGE_BYTES, toHex, fromHex } from "./protocol";

export const ASK_V3_ANNOUNCE_HEADER = "ciph_msg:1:ask:a2:";

const te = new TextEncoder();
const td = new TextDecoder();
const HEX64 = /^[0-9a-fA-F]{64}$/;
const HEX_RE = /^[0-9a-fA-F]+$/;
const DECIMAL = /^\d+$/;
const MIN_KASIA1_HEX_CHARS = 122;

function isValidKasia1MessageHex(m: string): boolean {
  return m.length >= MIN_KASIA1_HEX_CHARS && m.length % 2 === 0 && HEX_RE.test(m);
}

/** Announcement envelope (lock tx). Carries everything a client needs to
 * REBUILD the covenant and verify the funded P2SH (ASKSPEC §4) — which
 * under V3 means askId and the per-Ask refundAllowance are mandatory. */
export interface AskEnvelopeV3 {
  v: 2;
  sender: string;
  recipient: string;
  deadlineDaa: string;
  /** Per-Ask random 32-byte id, hex — bound into the covenant (F22). */
  askId: string;
  /** Per-Ask refund fee allowance in sompi (F13) — replaces the fixed
   * REFUND_FEE_ALLOWANCE, which stranded small Asks. */
  refundAllowance: string;
  msgEnc: "kasia1";
  message: string;
}

/** Reply envelope (claim tx JSON part). NOTE: askId is NOT in the JSON —
 * it lives in the fixed-offset binary field so the covenant can read it.
 * Duplicating it here would create two sources of truth. */
export interface ReplyEnvelopeV3 {
  v: 2;
  ref: string;
  msgEnc: "kasia1";
  message: string;
}

/** Build the V3 claim payload: header ‖ askId ‖ JSON. */
export function encodeReplyPayloadV3(params: {
  askIdHex: string;
  envelope: ReplyEnvelopeV3;
}): string {
  const { askIdHex, envelope } = params;
  if (!HEX64.test(askIdHex)) throw new Error("askId must be 32 bytes of hex");
  if (!isValidKasia1MessageHex(envelope.message)) {
    throw new Error("message must be a kasia1 ciphertext (hex)");
  }
  const head = te.encode(ASK_V3_REPLY_HEADER);
  const askId = fromHex(askIdHex);
  const body = te.encode(JSON.stringify(envelope));
  const out = new Uint8Array(head.length + askId.length + body.length);
  out.set(head, 0);
  out.set(askId, ASK_ID_OFFSET);
  out.set(body, ASK_ID_END);
  if (out.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
  // Belt-and-braces: the covenant rejects anything under this length.
  if (out.length < MIN_CLAIM_PAYLOAD_LEN) {
    throw new Error("payload shorter than the covenant's minimum");
  }
  return toHex(out);
}

/** Build the V3 announcement payload (lock tx). Plain JSON after a header
 * — no fixed-offset field, because no covenant reads it. */
export function encodeAskPayloadV3(env: AskEnvelopeV3): string {
  if (!HEX64.test(env.askId)) throw new Error("askId must be 32 bytes of hex");
  if (!isValidKasia1MessageHex(env.message)) {
    throw new Error("message must be a kasia1 ciphertext (hex)");
  }
  const bytes = te.encode(`${ASK_V3_ANNOUNCE_HEADER}${JSON.stringify(env)}`);
  if (bytes.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
  return toHex(bytes);
}

export type ParsedV3Payload =
  | { kind: "ask"; envelope: AskEnvelopeV3 }
  | { kind: "reply"; askIdHex: string; envelope: ReplyEnvelopeV3 };

/**
 * Parse a V3 payload. Returns null for anything that is not a V3 ASK
 * payload (including V2 payloads — callers fall back to the V2 parser).
 * THROWS for V3-namespace payloads that are malformed.
 *
 * IMPORTANT (F14): a caller must NOT treat a throw, or a null, as
 * "refunded". A spend is a refund only if it passes the positive refund
 * test in status derivation.
 */
export function parseAskPayloadV3(payloadHex: string): ParsedV3Payload | null {
  let bytes: Uint8Array;
  try {
    bytes = fromHex(payloadHex);
  } catch {
    return null;
  }
  if (bytes.length > MAX_PAYLOAD_BYTES) return null;

  const headText = (() => {
    try {
      return td.decode(bytes.slice(0, ASK_ID_OFFSET));
    } catch {
      return "";
    }
  })();

  if (headText === ASK_V3_REPLY_HEADER) {
    if (bytes.length < MIN_CLAIM_PAYLOAD_LEN) {
      throw new Error("malformed v3 reply: shorter than the covenant minimum");
    }
    const askIdHex = toHex(bytes.slice(ASK_ID_OFFSET, ASK_ID_END));
    let json: unknown;
    try {
      json = JSON.parse(td.decode(bytes.slice(ASK_ID_END)));
    } catch {
      throw new Error("malformed v3 reply: invalid JSON body");
    }
    return { kind: "reply", askIdHex, envelope: validateReplyV3(json) };
  }

  let text: string;
  try {
    text = td.decode(bytes);
  } catch {
    return null;
  }
  if (text.startsWith(ASK_V3_ANNOUNCE_HEADER)) {
    let json: unknown;
    try {
      json = JSON.parse(text.slice(ASK_V3_ANNOUNCE_HEADER.length));
    } catch {
      throw new Error("malformed v3 ask: invalid JSON body");
    }
    return { kind: "ask", envelope: validateAskV3(json) };
  }
  return null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function validateReplyV3(x: unknown): ReplyEnvelopeV3 {
  if (!isRecord(x)) throw new Error("malformed v3 reply envelope");
  const { v, ref, msgEnc, message } = x;
  if (
    v !== 2 ||
    typeof ref !== "string" ||
    !HEX64.test(ref) ||
    msgEnc !== "kasia1" ||
    typeof message !== "string" ||
    !isValidKasia1MessageHex(message)
  ) {
    throw new Error("malformed v3 reply envelope");
  }
  return { v, ref, msgEnc, message };
}

function validateAskV3(x: unknown): AskEnvelopeV3 {
  if (!isRecord(x)) throw new Error("malformed v3 ask envelope");
  const { v, sender, recipient, deadlineDaa, askId, refundAllowance, msgEnc, message } = x;
  if (
    v !== 2 ||
    typeof sender !== "string" ||
    typeof recipient !== "string" ||
    typeof deadlineDaa !== "string" ||
    !DECIMAL.test(deadlineDaa) ||
    typeof askId !== "string" ||
    !HEX64.test(askId) ||
    typeof refundAllowance !== "string" ||
    !DECIMAL.test(refundAllowance) ||
    msgEnc !== "kasia1" ||
    typeof message !== "string" ||
    !isValidKasia1MessageHex(message)
  ) {
    throw new Error("malformed v3 ask envelope");
  }
  return {
    v,
    sender,
    recipient,
    deadlineDaa,
    askId,
    refundAllowance,
    msgEnc,
    message,
  };
}

export { ASK_ID_OFFSET, ASK_ID_END, ASK_ID_BYTES, MIN_CLAIM_PAYLOAD_LEN, MAX_MESSAGE_BYTES };
