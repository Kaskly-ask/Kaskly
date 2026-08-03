# ASKSPEC — The ASK Protocol Extension for Kasia

**Status: SKELETON (Phase 0). Not yet a specification. Grown from Phase 1
onward alongside the implementation (brief P6). Nothing below is normative
until marked otherwise.**

ASK is a reply-to-claim payment primitive for Kaspa, specified as an open
extension to the Kasia messaging protocol:

> KAS locked to a message, where the recipient's reply is the claim, and
> silence past a deadline auto-refunds the sender.

## Planned structure (per brief §6)

1. **Overview & lifecycle** — CREATE → NOTIFY → CLAIM-BY-REPLY → REFUND,
   plus LATE REPLY rejection (brief A1–A5).
2. **Payload namespace & versioning** — versioned namespace header following
   Kasia's payload conventions (placeholder `ask:1:`; final name is human
   decision Q3). Field encodings and size limits.
3. **Escrow design** — the covenant/script template (or, if Plan B is
   approved at the Phase 1 gate, the pre-signed transaction set), with every
   chain-capability claim citing where it was verified (R6).
4. **Deadline semantics** — DAA score vs. timestamp, defined from real chain
   capabilities (D9), including the late-reply/refund boundary.
5. **Claim construction** — the single atomic transaction that spends the
   lock to the recipient and carries the reply payload (A3).
6. **Refund construction** — 100% return to sender after deadline (A4).
7. **Discovery** — how a client scans for ask-namespace payloads addressed
   to it (A2), following Kasia's existing discovery pattern.
8. **Error & edge-case behavior** — late reply, double-claim, malformed
   payload, and the rest of the R3 attack set as MUST-reject cases.
9. **Trust model** — what the chain enforces vs. what clients enforce vs.
   what requires trust; mirrors TRUST.md (P3).
10. **Versioning policy** — breaking changes bump the namespace version (P5).
11. **Attribution & license** — human decision Q5 (P4).

## DRAFT §3 — Escrow covenant (from the Phase 1 spike; normative once v0.1 freezes)

Proven on testnet-10 (rusty-kaspa 2.0.1) on 2026-08-03; lifecycle txids in
PROGRESS.md. Requires the post-Toccata script ruleset (KIP-17).

An Ask locks funds in a **P2SH output** whose redeem script is:

```
OpIf
    <0> <prefix_len> OpTxPayloadSubstr        // spending tx's payload[0..prefix_len]
    <ask_prefix_bytes> OpEqualVerify          // must equal the ASK namespace prefix
    <recipient_xonly_pubkey> OpCheckSig       // 32-byte schnorr x-only key
OpElse
    <deadline> OpCheckLockTimeVerify          // NOTE: Kaspa CLTV POPS its argument
    <sender_xonly_pubkey> OpCheckSig
OpEndIf
```

- `ask_prefix_bytes`: UTF-8 bytes of the versioned namespace prefix
  (placeholder `ciph_msg:1:ask:`, 15 bytes — final name pending Q3).
- `deadline`: an absolute DAA score, pushed with trimmed little-endian
  encoding (must be `< 500_000_000_000`, the LOCK_TIME_THRESHOLD, to be
  interpreted as a DAA score; rusty-kaspa `consensus/core/src/constants.rs`).
- The P2SH address is derived per Kaspa standard P2SH
  (`ScriptBuilder.createPayToScriptHashScript()` → address).

**Claim (reply) transaction** — one atomic transaction:
- spends the Ask UTXO with signature script:
  `push(schnorr_sig||sighash_type) push(0x01) push(redeem_script)`;
- carries the reply in the transaction `payload`, which MUST begin with the
  ASK namespace prefix (chain-enforced via OpTxPayloadSubstr);
- pays the full amount minus network fee to the recipient. Signature is
  SIGHASH_ALL over the tx (payload is committed via the signed tx).

**Refund transaction** (valid only from `deadline` onward):
- spends the Ask UTXO with signature script:
  `push(schnorr_sig||sighash_type) push(<empty>) push(redeem_script)`;
- MUST set tx `lockTime = deadline` (same threshold class; consensus
  finality then forbids acceptance before the deadline) and input
  `sequence != MAX_U64` (Kaspa CLTV requirement);
- pays the full amount minus network fee back to the sender.

**Chain-enforced properties (each demonstrated by an on-chain rejection):**
wrong-key claims; claims without the namespace payload; refunds before the
deadline; claims after the refund has executed.

**Explicit non-property (trust model, mirrors TRUST.md):** the chain cannot
expire the claim branch at the deadline (no script primitive observes
current DAA score — verified against rusty-kaspa v2.0.1 opcode set). The
refund transaction is what forecloses late claims; clients MUST
auto-broadcast refunds at deadline and MUST refuse to construct
post-deadline claims. A hardened refund variant (anyone-can-trigger with
covenant-pinned destination and amount) is under consideration for v0.1.

## Invariants already locked by the brief

- No fee outputs in any transaction, ever (D2).
- Refunds are always 100% of the locked amount (D9).
- Claims are all-or-nothing (R3).
- Non-custodial: no third party, including any app operator, may hold a
  unilateral spend path (C2).
