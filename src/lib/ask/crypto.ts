// kasia1 message encryption — a byte-level reimplementation of Kasia's
// cipher (K-Kluster/Kasia cipher/src/lib.rs, verified 2026-08-03):
//   ephemeral ECDH on secp256k1 (shared secret = raw x-coordinate; RustCrypto
//   elliptic-curve SharedSecret semantics, docs.rs) →
//   HKDF-SHA256 with NO salt and EMPTY info, 32-byte okm →
//   ChaCha20-Poly1305, random 96-bit nonce, no AAD.
// Wire format (their EncryptedMessage::to_bytes):
//   nonce(12) ‖ ephemeral pubkey SEC1 compressed(33) ‖ ciphertext
// (a 32-byte legacy x-only ephemeral key is accepted on parse, as in their
//  from_bytes). Recipient key = x-only key from the Kaspa address payload,
// lifted with EVEN parity — encryption needs only the address.
//
// COMPATIBILITY STATUS (stated honestly per the Q4 gate decision): Kasia's
// repo contains NO fixed test vectors (only a randomized round-trip test,
// cipher/src/lib.rs:346). Compatibility is therefore verified structurally
// (each step cited against their code) and by our own round-trip + known-
// answer tests — NOT against official Kasia vectors. Cross-client interop
// should be confirmed with the Kasia team alongside the Q3 namespace.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { fromHex, toHex } from "./protocol";

const NONCE_LEN = 12;
const EPHEMERAL_LEN = 33;
const TAG_LEN = 16;
/** nonce + ephemeral key + Poly1305 tag: the minimum valid blob. */
export const MIN_KASIA1_BYTES = NONCE_LEN + EPHEMERAL_LEN + TAG_LEN;

const te = new TextEncoder();
const td = new TextDecoder();

function deriveKey(sharedPoint: Uint8Array): Uint8Array {
  // getSharedSecret returns the SEC1 compressed point (33B); the k256
  // SharedSecret Kasia feeds to HKDF is the raw x-coordinate — drop the
  // parity byte. Salt: none (zero-block per RFC 5869); info: empty.
  const x = sharedPoint.subarray(1);
  return hkdf(sha256, x, undefined, undefined, 32);
}

/** Encrypt a message to a recipient identified only by their x-only pubkey
 * (i.e. their Kaspa schnorr address payload). */
export function encryptKasia1(recipientXOnlyHex: string, plaintext: string): string {
  return encryptKasia1Internal(
    recipientXOnlyHex,
    plaintext,
    secp256k1.utils.randomSecretKey(),
    randomBytes(NONCE_LEN)
  );
}

/** Deterministic variant — TEST/VECTOR USE ONLY (fixed ephemeral secret and
 * nonce). Never call with non-random inputs in production: nonce reuse
 * breaks ChaCha20-Poly1305. */
export function encryptKasia1Internal(
  recipientXOnlyHex: string,
  plaintext: string,
  ephemeralSecret: Uint8Array,
  nonce: Uint8Array
): string {
  if (!/^[0-9a-f]{64}$/i.test(recipientXOnlyHex)) {
    throw new Error("recipient x-only pubkey must be 32-byte hex");
  }
  // Even-parity lift, exactly as Kasia's encrypt_message.
  const receiverPub = fromHex("02" + recipientXOnlyHex);
  const ephemeralPub = secp256k1.getPublicKey(ephemeralSecret, true);
  const key = deriveKey(secp256k1.getSharedSecret(ephemeralSecret, receiverPub, true));
  const ciphertext = chacha20poly1305(key, nonce).encrypt(te.encode(plaintext));
  const out = new Uint8Array(NONCE_LEN + EPHEMERAL_LEN + ciphertext.length);
  out.set(nonce, 0);
  out.set(ephemeralPub, NONCE_LEN);
  out.set(ciphertext, NONCE_LEN + EPHEMERAL_LEN);
  return toHex(out);
}

/** Decrypt a kasia1 blob with the recipient's 32-byte private key (hex). */
export function decryptKasia1(blobHex: string, privateKeyHex: string): string {
  const blob = fromHex(blobHex);
  if (blob.length < MIN_KASIA1_BYTES) throw new Error("kasia1 blob too short");
  const nonce = blob.subarray(0, NONCE_LEN);
  // 33-byte SEC1 compressed ephemeral key (02/03 prefix), or the 32-byte
  // legacy x-only form Kasia still accepts (lifted even).
  let ephemeralPub: Uint8Array;
  let ctStart: number;
  if (blob[NONCE_LEN] === 0x02 || blob[NONCE_LEN] === 0x03) {
    ephemeralPub = blob.subarray(NONCE_LEN, NONCE_LEN + 33);
    ctStart = NONCE_LEN + 33;
  } else {
    const lifted = new Uint8Array(33);
    lifted[0] = 0x02;
    lifted.set(blob.subarray(NONCE_LEN, NONCE_LEN + 32), 1);
    ephemeralPub = lifted;
    ctStart = NONCE_LEN + 32;
  }
  const key = deriveKey(secp256k1.getSharedSecret(fromHex(privateKeyHex), ephemeralPub, true));
  const plaintext = chacha20poly1305(key, nonce).decrypt(blob.subarray(ctStart));
  return td.decode(plaintext);
}
