# TRUST — What enforces what in ASK

_This file is the plain-language map of what the Kaspa chain enforces versus
what requires trusting the app. It must stay accurate with every escrow
change, and be readable by a non-developer. (Brief §7 L1, §8 R6.)_

## Current status

**Nothing is built yet (Phase 0).** No funds can be locked, so there is
nothing to trust or distrust. This file will be filled in when the escrow
design is proven in Phase 1.

## What will be decided in Phase 1

ASK's goal is that the **chain itself** enforces all three of these, with no
trust in this app or its operator:

1. The recipient can take the locked money **only** with a transaction that
   carries their reply.
2. After the deadline, the sender can always get **100%** of the money back.
3. Nobody else — including the people who run this app — can touch the money.

Phase 1 tests whether Kaspa's new covenant feature (from the Toccata
upgrade) can really express these rules today. Two possible outcomes:

- **Covenant path (target):** the chain enforces all three rules. Trust
  required in the app: none for the money.
- **Plan B (fallback, only if covenants can't do it yet):** pre-signed
  refund transactions + app-cosigned claims. This has a real trust
  component, and if it is chosen, this file will spell out exactly what you
  are trusting, in plain words, before any UI ships.

**Rule we follow either way:** we never claim "trustless" beyond what the
code provably enforces (brief D5).

## Reply privacy (to be decided at Phase 2 — Q4)

Either replies are end-to-end encrypted (Kasia's scheme), or v1 uses
plaintext replies with an unmissable "your reply is permanent and PUBLIC
on-chain" warning. Whichever ships will be stated here plainly.

## Always true, regardless of outcome

- **Testnet only** for this entire project (no real money).
- **No fees**, ever, at the protocol level (D2).
- **Non-custodial**: your keys never touch a server (D4).
