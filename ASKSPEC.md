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

## Invariants already locked by the brief

- No fee outputs in any transaction, ever (D2).
- Refunds are always 100% of the locked amount (D9).
- Claims are all-or-nothing (R3).
- Non-custodial: no third party, including any app operator, may hold a
  unilateral spend path (C2).
