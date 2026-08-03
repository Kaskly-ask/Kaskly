# TRUST — What enforces what in ASK

_This file is the plain-language map of what the Kaspa chain enforces versus
what requires trusting the app. It must stay accurate with every escrow
change, and be readable by a non-developer. (Brief §7 L1, §8 R6.)_

## Current status (after the Phase 1 feasibility test, 2026-08-03)

The covenant design was **proven on the Kaspa test network** (no app exists
yet). Here is, in plain words, what the chain itself enforces — meaning no
one, including the people who run this app, can break these rules:

1. **Only the recipient can claim the money, and only with a transaction
   that carries a reply.** We proved the chain rejects a claim signed by
   anyone else, and rejects a claim with no reply attached.
2. **Before the deadline, the sender cannot take the money back.** We
   proved the chain rejects an early refund.
3. **After the deadline, the sender can reclaim 100% of the money** (minus
   only the normal network transaction fee). Proven on-chain.
4. **Once the refund happens, a late reply can never take the money.**
   Proven: the chain rejects it.
5. **There are no app fees, provably.** We decoded the actual test
   transactions: the money goes recipient-or-sender, whole, nothing else.

## The one honest caveat

**Between the deadline passing and the refund landing, a late reply is
still technically valid.** The chain has no way to make a claim "expire" on
its own — the refund transaction is what closes the door (it typically
lands within seconds on Kaspa). What this means for you as a sender: your
refund is guaranteed *available* from the deadline onward, but if the
recipient replies in the brief moment before the refund lands, the reply
wins. The app will refund automatically at the deadline, and honest
recipient apps refuse to send late replies. How this is worded and handled
in the final protocol is an open decision being made deliberately.

## Reply privacy (to be decided at Phase 2 — Q4)

Either replies are end-to-end encrypted (Kasia's scheme), or v1 uses
plaintext replies with an unmissable "your reply is permanent and PUBLIC
on-chain" warning. Whichever ships will be stated here plainly.

## Reply privacy (to be decided at Phase 2 — Q4)

Either replies are end-to-end encrypted (Kasia's scheme), or v1 uses
plaintext replies with an unmissable "your reply is permanent and PUBLIC
on-chain" warning. Whichever ships will be stated here plainly.

## Always true, regardless of outcome

- **Testnet only** for this entire project (no real money).
- **No fees**, ever, at the protocol level (D2).
- **Non-custodial**: your keys never touch a server (D4).
