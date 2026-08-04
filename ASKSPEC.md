# ASKSPEC — The ASK Protocol Extension for Kasia

**Version 0.1 (draft for review). 2026-08-03.**

> ASK is a reply-to-claim payment primitive for Kaspa: KAS locked to a
> message, where the recipient's reply is the claim, and silence past a
> deadline refunds the sender. **A reply, or your money back — late replies
> lose to the refund.**

This document is self-contained: a developer with no access to the
reference implementation can build an interoperable ASK client from it.
Every chain-capability claim below was verified against rusty-kaspa v2.0.1
(the Toccata mainnet release) sources and/or demonstrated on testnet-10;
citations are given inline. Requires the post-Toccata script ruleset
(KIP-17 introspection opcodes, active on mainnet since 2026-06-30 and on
testnet-10 since 2026-05-18).

Status of this spec: **v0.1 draft**. The reference implementation and the
on-chain evidence live at the ASK repository (see §12).

---

## 1. Terminology and constants

| Term | Meaning |
|---|---|
| **Sender (S)** | The party locking KAS to a message. |
| **Recipient (R)** | The party who can claim by replying. |
| **Ask** | The locked funds + message + deadline, as one on-chain object. |
| **DAA score** | Kaspa's monotone chain-progress counter (~10/second post-Crescendo; measure, don't assume). |
| sompi | 1 KAS = 100,000,000 sompi. All protocol amounts are integer sompi. |

Protocol constants (v1):

| Constant | Value | Notes |
|---|---|---|
| `ASK_PREFIX` | `ciph_msg:1:ask:` (UTF-8, 15 bytes) | **PENDING (Q3):** provisional, inside Kasia's `ciph_msg:` namespace so existing Kasia clients classify Ask traffic as Kasia-family; final name to be confirmed with the Kasia team. A change bumps the version (§11). |
| `SUBKIND_ASK` | `a` | Ask announcement payloads. |
| `SUBKIND_REPLY` | `r` | Reply (claim) payloads. |
| `MAX_PAYLOAD_BYTES` | 16,384 | Whole-tx-payload ceiling, conservative under Kasia's client heuristic (17.7 KiB). The consensus payload bound is not separately verified; clients MUST enforce this limit themselves. |
| `MAX_MESSAGE_BYTES` | 7,900 | Plaintext ceiling in **UTF-8 bytes**, client-enforced. Derived from `MAX_PAYLOAD_BYTES`: hex encoding doubles the ciphertext (plaintext + 61 bytes of kasia1 framing) and the worst-case v1 envelope adds ≈410 bytes of structure, so 2·P + 410 ≤ 16,384 ⇒ P ≤ 7,987; 7,900 leaves margin. (v0.1 drafts said 10,000 UTF-16 chars — inconsistent with the payload ceiling; corrected 2026-08-04.) |
| `REFUND_FEE_ALLOWANCE` | 500,000 sompi | See §5.2/§6. |
| `LOCK_TIME_THRESHOLD` | 500,000,000,000 | Lock times below this are DAA scores (rusty-kaspa `consensus/core/src/constants.rs`). |

## 2. Payload format

ASK payloads ride in the Kaspa transaction `payload` field (hex-encoded on
the wire; byte semantics below), following Kasia's convention of a
namespace prefix followed by structured content
(`K-Kluster/Kasia src/config/protocol.ts`).

```
<ASK_PREFIX><subkind>:<JSON body>       (UTF-8 bytes)
```

### 2.1 Ask announcement (`a`) — carried by the LOCK transaction

```json
{ "v": 1,
  "sender":     "<Kaspa address of S — refund destination>",
  "recipient":  "<Kaspa address of R>",
  "deadlineDaa":"<decimal string, absolute DAA score>",
  "minRefund":  "<decimal string, sompi>",
  "msgEnc":     "kasia1",
  "message":    "<hex kasia1 ciphertext, encrypted to R>" }
```

### 2.2 Reply (`r`) — carried by the CLAIM transaction

```json
{ "v": 1,
  "ref":    "<64-hex txid of the lock transaction>",
  "msgEnc": "kasia1",
  "message":"<hex kasia1 ciphertext, encrypted to S>" }
```

### 2.2.1 Message encryption — encrypted only

**v1 messages and replies are ALWAYS encrypted** (Q4 decision, human,
2026-08-03: no plaintext mode exists; privacy is enforced by construction).
`kasia1` is Kasia's message encryption scheme, reimplemented byte-for-byte
from `K-Kluster/Kasia cipher/src/lib.rs`:

1. The encryption target's x-only pubkey is the payload of their schnorr
   Kaspa address, lifted to a full point with **even parity** (x-coordinate
   ECDH makes the true parity irrelevant).
2. A fresh ephemeral secp256k1 keypair per message; ECDH shared secret =
   the **raw x-coordinate** (32 bytes) of the DH point.
3. Key = HKDF-SHA256(ikm = x-coordinate, salt = none, info = empty,
   length = 32).
4. AEAD = ChaCha20-Poly1305, random 96-bit nonce, no AAD.
5. Wire bytes, hex-encoded into `message`:
   `nonce(12) ‖ ephemeral pubkey SEC1 compressed(33) ‖ ciphertext‖tag`.
   (Parsers MUST also accept a legacy 32-byte x-only ephemeral key, lifted
   even, as Kasia's `from_bytes` does.)

Asks encrypt to the **recipient**; replies encrypt to the **sender**. No
handshake is needed in either direction — the address alone suffices.

**Compatibility status (stated honestly):** the Kasia repository contains
no fixed cipher test vectors (only a randomized round-trip test,
`cipher/src/lib.rs:346-363`, checked 2026-08-03). This spec's reference
implementation is verified structurally against Kasia's code (every step
cited) with its own pinned known-answer vector, but cross-implementation
interop has not been proven against Kasia-produced ciphertext — confirm
with the Kasia team alongside the Q3 namespace decision.

### 2.3 Parsing rules

- A payload not starting with `ASK_PREFIX` is not ASK traffic: ignore.
- A payload with the prefix but an unknown subkind, non-JSON body, missing
  or type-invalid fields, non-decimal numeric strings, a `ref` that is not
  64 hex chars, **any `msgEnc` other than `kasia1` (including `plain`)**, a
  `message` that is not plausible ciphertext hex (even-length hex, ≥ 61
  bytes), or any size over the ceilings: **malformed — reject**; MUST NOT
  be surfaced as an Ask or a reply.
- Unknown JSON fields MUST be ignored (forward compatibility).

## 3. The escrow covenant

Funds lock in a **P2SH output** whose redeem script is (opcode names per
KIP-17 / rusty-kaspa `crypto/txscript`):

```
OpIf
    <0> <15> OpTxPayloadSubstr            // spending tx payload[0..15]
    <ASK_PREFIX bytes> OpEqualVerify      // must be the ask namespace
    <R x-only pubkey (32B)> OpCheckSig    // recipient's schnorr key
OpElse
    <deadlineDaa> OpCheckLockTimeVerify   // POPS its arg (Kaspa CLTV)
    OpTxOutputCount <1> OpNumEqualVerify  // exactly one output
    <0> OpTxOutputSpk
    <S SPK stack bytes> OpEqualVerify     // it pays the sender
    <0> OpTxOutputAmount
    <minRefund> OpGreaterThanOrEqual      // at least minRefund
OpEndIf
```

Encoding notes (all verified in rusty-kaspa v2.0.1 sources):

- `OpTxPayloadSubstr` pops `[start, end]` and pushes `payload[start..end]`
  (`opcodes/mod.rs:1173`). An absent/short payload makes it FAIL
  ("substring out of bounds") — this is what makes the reply mandatory.
- Kaspa `OpCheckLockTimeVerify` **pops** its argument (no `OpDrop` after,
  unlike Bitcoin), requires the stack value and the tx `lockTime` to be in
  the same threshold class, `stackValue <= tx.lockTime`, and the spending
  input's `sequence != MAX_U64` (`opcodes/mod.rs:1014-1064`).
- `<deadlineDaa>` and `<minRefund>` are pushed as trimmed little-endian
  bytes (`ScriptBuilder::add_lock_time`/`add_i64` semantics,
  `script_builder.rs:312-327`).
- `<S SPK stack bytes>` is the sender's script-public-key exactly as
  `OpTxOutputSpk` pushes it: **2-byte big-endian version ‖ script bytes**
  (`SpkEncoding::to_bytes`, `crypto/txscript/src/lib.rs`).
- `<R x-only pubkey>`: for schnorr addresses, the address payload IS the
  x-only key (Kasia uses the same identity, `cipher/src/lib.rs`), so R's
  key is derivable from R's address alone — no handshake needed.
- The refund branch contains **no signature check**: the refund is
  *anyone-can-trigger*, and safe because destination, output count, and
  minimum amount are pinned by introspection.

`minRefund` MUST equal `amount − REFUND_FEE_ALLOWANCE`. The P2SH address
derives from the redeem script per Kaspa standard P2SH.

## 4. Lock transaction (lifecycle CREATE)

A standard transaction, built from S's UTXOs, with:

- one output of `amount` sompi to the covenant P2SH address (plus optional
  change to S);
- the **ask announcement payload** (§2.1) on the same transaction.

One transaction therefore both escrows the funds and delivers the message.
Recipients MUST verify, before trusting a discovered Ask, that the
announced parameters reproduce the P2SH address actually funded (rebuild
the redeem script from `sender`, own address, `deadlineDaa`, `minRefund`,
and compare) — an announcement that doesn't match its own escrow is
malformed.

## 5. Claim transaction (lifecycle CLAIM-BY-REPLY)

Spends the covenant UTXO. **One atomic transaction**: the reply and the
payment cannot be separated.

- Inputs: the covenant UTXO (signature script below). `sigOpCount = 1`.
- Outputs: recipient-chosen; conventionally one output of
  `amount − fee` to R. (The claim branch does not pin outputs — after
  replying, the money is R's.)
- Payload: a reply payload (§2.2). The chain enforces only the 15-byte
  prefix; the rest is client-validated (§2.3).
- Signature: schnorr, `SIGHASH_ALL`, over the transaction with the
  covenant UTXO's SPK/amount committed (standard Kaspa sighash).
- Signature script: `push(sig ‖ sighashType) push(0x01) push(redeemScript)`
  — the last push must be the redeem script (Kaspa P2SH rule); `0x01`
  selects the claim branch.

### 5.1 Timing

A claim is valid until the covenant UTXO is spent. See §8 for the
late-claim semantics.

### 5.2 Fees

Network fee comes out of the locked amount (recipient receives
`amount − fee`). **The protocol has no fees of its own — no fee outputs,
no fee addresses, ever.** Any transaction claiming to be ASK that routes
value anywhere except R (claim) or S (refund) is not ASK.

**The network minimum fee scales with transaction mass**, and for large
reply payloads mass is dominated by byte size (transient mass; observed
on testnet-10 / rusty-kaspa 2.0.1: floor of 100 sompi per gram — a
near-limit reply weighs ~31,000 grams, requiring a ~3.1M-sompi fee,
demonstrated by live rejection of an underfunded claim, 2026-08-04).
Clients MUST therefore fund claims from the actual serialized
transaction's mass, not a fixed constant (the reference implementation
computes it with the SDK's `calculateTransactionFee` and floors at
`REFUND_FEE_ALLOWANCE` for short replies). Because the fee comes out of
the locked amount, clients SHOULD display the net amount for long
replies, and MUST reject replies whose minimum fee would meet or exceed
the locked amount.

The refund path is unaffected: refund transactions carry no payload, so
their mass is small and constant — the fixed `REFUND_FEE_ALLOWANCE`
pinned by the covenant is always sufficient.

## 6. Refund transaction (lifecycle REFUND)

Spends the covenant UTXO after the deadline. Requires **no signature** —
any party (S's client, R's client, a watchtower, anyone) can broadcast it.

- `lockTime = deadlineDaa` (same threshold class; consensus refuses the tx
  before that DAA score — "input not finalized").
- Input `sequence` MUST NOT be `MAX_U64` (use 0). `sigOpCount = 0`.
- Exactly one output: `minRefund` sompi to S's address (the covenant
  rejects anything else: wrong destination, extra outputs, or a smaller
  amount all fail script verification).
- No payload required (the prefix check lives only in the claim branch).
- Signature script: `push(<empty>) push(redeemScript)`.

## 7. Discovery

Clients discover ASK traffic the same way Kasia clients discover messages
(`Kasia src/service/block-processor-service.ts`): subscribe to new blocks
over wRPC (`subscribeBlockAdded`), and for each transaction check whether
the hex payload starts with `hex(ASK_PREFIX)`; parse per §2.3.

- **Recipient inbox:** `a` payloads whose `recipient` is an owned address
  (after §4 escrow verification).
- **Sender status:** watch the covenant address UTXO. UTXO present →
  `open`; spent by a tx with an `r` payload → `answered` (the reply is in
  that tx); spent otherwise after deadline → `refunded`. Every status is
  derivable from chain state alone; indexers/caches are optional.
- Historical sync: any means of scanning past blocks/transactions works
  (e.g. a REST indexer); the chain remains the source of truth.

## 8. Deadline semantics and the late-reply rule

The deadline is an **absolute DAA score** (`deadlineDaa <
LOCK_TIME_THRESHOLD`). Clients convert wall-clock durations using the
network's DAA cadence (~10/s currently; measure at send time) and SHOULD
display approximate times.

What the chain enforces, with the boundary stated honestly:

- Before `deadlineDaa`: refund impossible (consensus finality + CLTV);
  claim possible.
- From `deadlineDaa` on: refund possible **and remains anyone-triggerable
  forever**; a claim remains *technically* valid until the refund lands.
  No Kaspa script primitive can observe current chain time, so the claim
  branch cannot expire on-chain (verified against the full v2.0.1 opcode
  set; `OpTxInputDaaScore` exposes only the spent UTXO's creation score).
- After the refund: claims are rejected by consensus as double-spends.

**Normative client rules** (both were human-gate decisions and are part of
this protocol, not suggestions):

1. Clients aware of an Ask past its deadline MUST attempt to broadcast the
   refund transaction (§6) — including the recipient's own client. Anyone
   may do so; the covenant makes it safe.
2. Recipient clients MUST refuse to construct a claim once
   `currentDaaScore >= deadlineDaa`, and MUST show a "deadline passed —
   funds returned to sender" state instead.

The product truth is: **a reply, or your money back; late replies lose to
the refund.**

## 9. Error and edge-case behavior

Chain-rejected by the covenant/consensus (each verified on testnet-10 with
recorded transactions; rejection strings from rusty-kaspa 2.0.1):

| Case | Rejection |
|---|---|
| Claim without payload | script fail: "substring [0:15] is out of bounds" |
| Claim with non-ASK-prefix payload | script fail: "verification failed" |
| Claim signed by a key other than R's | script fail: "false stack entry" |
| Refund before deadline | "transaction input #0 is not finalized" |
| Refund to any non-S destination | script fail: "verification failed" |
| Refund with >1 output | script fail: "verification failed" |
| Refund paying S less than `minRefund` | script fail: "false stack entry" |
| Double-claim / double-refund / claim-after-refund | double-spend (orphan) |
| Partial-amount claim | impossible: a UTXO is consumed whole |

Client-rejected (MUST): malformed payloads per §2.3; oversized payloads;
Asks whose announcement doesn't reproduce the funded P2SH (§4);
post-deadline claim construction (§8). Clients MUST render message and
reply text inertly (no markup/script execution).

## 10. Trust model

Chain-enforced (trustless, demonstrated on testnet-10): claim requires R's
signature AND an ASK-namespace payload; no refund before the deadline;
refunds can only pay ≥ `minRefund` to S as the sole output; after the
refund, late claims are dead; no fee outputs exist in the protocol.

Not chain-enforced (stated plainly): claim expiry between deadline and
refund (§8 — mitigated by anyone-can-trigger refunds and the normative
client rules); payload structure beyond the 15-byte prefix (client
validation). Message and reply CONTENT is always encrypted between S and R
(§2.2.1) — but transaction METADATA is permanently public: addresses,
amounts, deadlines, timing, and the fact that an Ask was answered or
refunded. Clients SHOULD say so.

No app operator, cosigner, or third party holds any spend path. There are
no protocol fees (see §5.2). This section mirrors TRUST.md in the
reference repository.

## 11. Versioning

The namespace version is the `1` in `ciph_msg:1:ask:`... combined with the
envelope `v` field. Breaking changes to the payload schema, covenant
template, or lifecycle bump the version; clients MUST ignore versions they
don't implement. The Q3 namespace decision, once final, fixes the prefix
for v1 permanently.

## 12. Attribution and license

This specification and its reference implementation are
**© 2026 The Kaskly project** (kaskly.app; on-chain identity
`kaskly.kas`, KNS inscription #96310), released under the **ISC
license** — the same license Kasia itself uses. When implementing or
extending this spec, please attribute "the ASK protocol (Kaskly
project)".

The reference implementation, the on-chain evidence (testnet-10 txids
for every lifecycle path and attack), and this spec's change history
live in the ASK reference repository:
https://github.com/Kaskly-ask/Kaskly.

---

*Spec and implementation are maintained together; divergence found at any
phase gate is a defect (reference repo rule P6).*
