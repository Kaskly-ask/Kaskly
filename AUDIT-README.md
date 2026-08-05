# External review brief — Kaskly / ASK protocol

**Read `audit/KNOWN-AND-CLOSED.md` next.** It lists everything already
found internally, with status and evidence. Those are **out of scope as
rediscoveries** — but breaking one of the *fixes* is a high-value finding.

## What this is

ASK is a reply-to-claim payment primitive on Kaspa: KAS locked to a
message, where the recipient's **reply is the claim**, and silence past a
deadline **auto-refunds the sender**. It uses native post-Toccata L1
covenants (KIP-10/17 introspection). Kaskly is the reference client.

**Testnet-10 only.** The client refuses to boot on any non-testnet network
(`src/lib/config.ts`). No real money is at risk anywhere in this codebase.

## What to attack

1. **Steal locked funds** — any path to the escrow other than a
   recipient-signed claim or a sender-destined refund.
2. **Claim without the recipient's key.**
3. **Block or redirect a refund** — including denial: anything that stops
   a sender recovering their own funds.
4. **Extract keys from the browser.**
5. **Forge a reply, or forge what a user is shown.**

Covenant construction, claim/refund transaction building, key handling,
the kasia1 cipher implementation, and payload parsing are all in scope.
UI polish, marketing pages, and the PWA shell are not.

## The honest state of this tag

Everything below was found and fixed by the **same assistant that wrote
the code**. Internal adversarial passes and self-review do not substitute
for an outside reviewer — that limit is why this tag exists.

**Recently fixed, with failing-first proofs committed in the failing
state** (each has a RED commit before its GREEN commit):

- V3 covenant **wired into the shipping client** and proven on chain
  through `sendAsk`/`claimAsk`/`maybeAutoRefund` — not merely in
  isolation. A previous tag (`hardened-v1`) claimed these fixed while the
  app still created V2 covenants; that overstatement is documented in the
  🔴 CORRECTION block of `KNOWN-AND-CLOSED.md` and is left standing.
- **F12, F13, F21, F22** — covenant defects, now reachable-and-proven.
- **OPW-1** — displayed message anchored to the on-chain announcement.
- **OPW-3 + F16** — dust-eviction denial (window and `entries[0]`).
- **OPW-4** — transient node error no longer suppresses auto-refund.

## Deliberate assumptions — chosen, not missed

**OPW-2 — the transaction indexer is a trusted third party.** Kaspa nodes
do not index transactions by id; wRPC exposes no transaction-by-id and no
address-history method (enumerated from the installed SDK's types). Any
settled-state verdict therefore comes from one REST indexer
(`api-tn10.kaspa.org`), with no second source to corroborate it. Fixing
this means **running a second indexing service — infrastructure, not a
patch** — so it is documented and bounded rather than fake-fixed.

The bound, stated so you can try to break it:

- A hostile indexer **can** alter displayed message text, misreport
  answered-vs-refunded, alter shown reply text, or make a settled Ask look
  unresolved. Deception is in scope.
- It **cannot move funds** — refunds are covenant-pinned to the sender,
  claims require the recipient's signature, and no operator has a spend
  path.
- It **cannot invent or hide a settlement** — "is the escrow still
  funded" is answered by the user's own node over wRPC; the indexer is
  consulted only after the node reports the funds gone.
- It **cannot forge a message alone** — since OPW-1 the ciphertext is
  checked against the lock transaction; a lie yields a refusal. Forgery
  needs the indexer *and* a cache write.

**If you can defeat that bound — especially move or freeze funds through
the indexer — that is the single highest-value finding available here.**

Also deliberate: `/api/asks` is an **unauthenticated cache** (F18). It is
a cache by design — nothing renders without chain verification — but its
write path is open, and OPW-1's fix narrowed rather than closed what a
hostile write can achieve.

## Known-open, not yet fixed

- **Claim net-to-recipient is not clamped to the escrow input.** A local
  invariant (nothing can pay out more than was locked) that would kill an
  inflated-"Earned" display with zero indexer trust. Identified, not built.
- **`is_accepted`** is declared on the REST DTO and never read.
- Browser `localStorage` key storage (testnet-only justification).
- Mainnet gates in `PROGRESS.md` — the DAA-per-second constant and the
  refund fee ceiling are both testnet-measured.

## Reproducing

`README.md` is cold-start verified (a fresh clone was walked verbatim and
the gaps fixed; the failing first-run log is kept in `audit/`). Integration
tests need a faucet-funded testnet key — see `README.md`.

- `npm test` — unit suite
- `npm run test:integration` — live testnet-10; costs TKAS
- `tests/integration/shipped-path-v3.test.ts` — the end-to-end proof that
  the shipped client path builds V3, and that in-flight V2 Asks still
  settle. Runs against live 9-digit DAA values, deliberately never fixture
  values.

## The one rule I would ask you to hold us to

A rejection is not a defense: any "the code blocks this" claim should come
with the honest path proven to succeed in the same harness, and a failure
by an unexpected mechanism is **inconclusive**, not a pass. That standard
is what surfaced most of the findings above, including the ones where the
first "proof" turned out to be measuring the wrong thing.
