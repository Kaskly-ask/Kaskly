// ASK protocol constants and payload codec (ASKSPEC.md §2).
// Namespace decision (Q3, human, 2026-08-03): provisional `ciph_msg:1:ask:`
// inside Kasia's namespace — PENDING confirmation with the Kasia team.

/** The on-chain namespace prefix. Also enforced BY THE COVENANT on claim
 * transactions (first PREFIX_LEN bytes of the tx payload). */
export const ASK_PREFIX = "ciph_msg:1:ask:";
export const ASK_PREFIX_BYTES = new TextEncoder().encode(ASK_PREFIX);

/** Payload subkinds within the ask namespace. */
export const SUBKIND_ASK = "a";
export const SUBKIND_REPLY = "r";

/** v0.1 size ceiling for the whole tx payload, bytes. Conservative bound
 * under Kasia's client heuristic (MAX_PAYLOAD_SIZE = 17.7 KiB, their
 * src/config/constants.ts); the consensus-level limit remains UNVERIFIED
 * and is tracked in PROGRESS.md. */
export const MAX_PAYLOAD_BYTES = 16384;

/** Plaintext message ceiling in UTF-8 BYTES, client-enforced — DERIVED
 * from MAX_PAYLOAD_BYTES: hex encoding doubles the ciphertext (which is
 * plaintext bytes + 61 of kasia1 framing), and the worst-case v1 envelope
 * adds ≈410 bytes of structure (ask subkind, two testnet addresses,
 * 12-digit DAA score, 20-digit sompi amount, JSON keys, namespace prefix).
 * 2×P + 410 ≤ 16,384 ⇒ P ≤ 7,987; 7,900 leaves margin. (The former
 * 10,000-UTF-16-char limit was inconsistent with the payload ceiling —
 * Phase 3 gate finding, 2026-08-04.) */
export const MAX_MESSAGE_BYTES = 7900;

/** UTF-8 byte length of a candidate message (what the limit measures —
 * multibyte characters count more than one). */
export function messageByteLength(text: string): number {
  return te.encode(text).length;
}

/** Shared, human-readable size rejection (UX rule from the Phase 3 gate:
 * never surface the raw payload-bytes error for ordinary typing). */
export function messageTooLongError(kind: "message" | "reply"): Error {
  return new Error(
    `${kind === "reply" ? "Reply" : "Message"} too long — max ~${MAX_MESSAGE_BYTES.toLocaleString("en-US")} characters (less with emoji or accented text)`
  );
}

/** Refund fee allowance in sompi: the covenant requires the refund to pay
 * at least (amount - this) back to the sender. */
export const REFUND_FEE_ALLOWANCE = 500_000n;

/** Message encoding. Q4 decision (human, 2026-08-03): ENCRYPTED ONLY —
 * "kasia1" (Kasia's ECDH+HKDF-SHA256+ChaCha20-Poly1305 scheme, see
 * crypto.ts) is the sole valid encoding in v1. A payload with any other
 * msgEnc (including "plain") is malformed per ASKSPEC §2.3. */
export type MessageEncoding = "kasia1";

/** Minimum kasia1 blob: nonce(12)+ephemeral(33)+tag(16) → 61 bytes hex. */
const MIN_KASIA1_HEX_CHARS = 122;
const HEX_RE = /^[0-9a-fA-F]+$/;

function isValidKasia1MessageHex(message: string): boolean {
  return (
    message.length >= MIN_KASIA1_HEX_CHARS &&
    message.length % 2 === 0 &&
    HEX_RE.test(message)
  );
}

export interface AskEnvelope {
  v: 1;
  /** Sender's kaspatest:/kaspa: address (refund destination, pinned by covenant). */
  sender: string;
  /** Recipient's address (claim key holder). */
  recipient: string;
  /** Absolute deadline as a DAA score (decimal string; BigInt-safe). */
  deadlineDaa: string;
  /** Minimum refund amount in sompi (decimal string) pinned by the covenant. */
  minRefund: string;
  msgEnc: MessageEncoding;
  /** Message: hex kasia1 ciphertext (encrypted to the RECIPIENT's key). */
  message: string;
}

export interface ReplyEnvelope {
  v: 1;
  /** The lock txid this reply claims. */
  ref: string;
  msgEnc: MessageEncoding;
  /** Hex kasia1 ciphertext (encrypted to the SENDER's key). */
  message: string;
}

const te = new TextEncoder();
const td = new TextDecoder();

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function encodePayload(subkind: string, envelope: object): string {
  const body = JSON.stringify(envelope);
  const payload = te.encode(`${ASK_PREFIX}${subkind}:${body}`);
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
  return toHex(payload);
}

/** Build the hex tx payload announcing an Ask (goes on the LOCK tx). */
export function encodeAskPayload(env: AskEnvelope): string {
  if (!isValidKasia1MessageHex(env.message)) {
    throw new Error("message must be a kasia1 ciphertext (hex)");
  }
  return encodePayload(SUBKIND_ASK, env);
}

/** Build the hex tx payload carrying a reply (goes on the CLAIM tx; must
 * keep the covenant-enforced prefix). */
export function encodeReplyPayload(env: ReplyEnvelope): string {
  if (!isValidKasia1MessageHex(env.message)) {
    throw new Error("message must be a kasia1 ciphertext (hex)");
  }
  return encodePayload(SUBKIND_REPLY, env);
}

export type ParsedAskPayload =
  | { kind: "ask"; envelope: AskEnvelope }
  | { kind: "reply"; envelope: ReplyEnvelope };

/** Parse a hex tx payload. Returns null for non-ASK payloads; throws on
 * ASK-namespace payloads that are malformed (R3: malformed payload). */
export function parseAskPayload(payloadHex: string): ParsedAskPayload | null {
  let bytes: Uint8Array;
  try {
    bytes = fromHex(payloadHex);
  } catch {
    return null;
  }
  if (bytes.length > MAX_PAYLOAD_BYTES) return null;
  let text: string;
  try {
    text = td.decode(bytes);
  } catch {
    return null;
  }
  if (!text.startsWith(ASK_PREFIX)) return null;
  const rest = text.slice(ASK_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) throw new Error("malformed ask payload: missing subkind");
  const subkind = rest.slice(0, sep);
  const body = rest.slice(sep + 1);
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error("malformed ask payload: invalid JSON body");
  }
  if (subkind === SUBKIND_ASK) {
    const env = validateAskEnvelope(json);
    return { kind: "ask", envelope: env };
  }
  if (subkind === SUBKIND_REPLY) {
    const env = validateReplyEnvelope(json);
    return { kind: "reply", envelope: env };
  }
  throw new Error(`malformed ask payload: unknown subkind '${subkind}'`);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

const DECIMAL = /^\d+$/;

function validateAskEnvelope(x: unknown): AskEnvelope {
  if (!isRecord(x)) throw new Error("malformed ask envelope");
  const { v, sender, recipient, deadlineDaa, minRefund, msgEnc, message } = x;
  if (
    v !== 1 ||
    typeof sender !== "string" ||
    typeof recipient !== "string" ||
    typeof deadlineDaa !== "string" ||
    !DECIMAL.test(deadlineDaa) ||
    typeof minRefund !== "string" ||
    !DECIMAL.test(minRefund) ||
    msgEnc !== "kasia1" ||
    typeof message !== "string" ||
    !isValidKasia1MessageHex(message)
  ) {
    throw new Error("malformed ask envelope");
  }
  return { v, sender, recipient, deadlineDaa, minRefund, msgEnc, message };
}

function validateReplyEnvelope(x: unknown): ReplyEnvelope {
  if (!isRecord(x)) throw new Error("malformed reply envelope");
  const { v, ref, msgEnc, message } = x;
  if (
    v !== 1 ||
    typeof ref !== "string" ||
    !/^[0-9a-fA-F]{64}$/.test(ref) ||
    msgEnc !== "kasia1" ||
    typeof message !== "string" ||
    !isValidKasia1MessageHex(message)
  ) {
    throw new Error("malformed reply envelope");
  }
  return { v, ref, msgEnc, message };
}
