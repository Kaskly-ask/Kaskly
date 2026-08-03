# TRUST — What enforces what in ASK

_This file is the plain-language map of what the Kaspa chain enforces versus
what requires trusting the app. It must stay accurate with every escrow
change, and be readable by a non-developer. (Brief §7 L1, §8 R6.)_

## Current status (after Phase 2 library + test suite, 2026-08-03)

The escrow design is **proven on the Kaspa test network**, now via an
automated test suite that re-proves it on demand. In plain words, what the
chain itself enforces — meaning no one, including the people who run this
app, can break these rules:

1. **Only the recipient can claim the money, and only with a transaction
   that carries a reply.** Chain rejects wrong-key claims, claims with no
   reply, and claims with a non-ASK payload. Proven.
2. **Before the deadline, the sender cannot take the money back.** Chain
   rejects early refunds. Proven.
3. **After the deadline, the refund needs nobody's permission and nobody's
   key.** The refund transaction carries NO signature — anyone can send it,
   and the covenant only lets it pay the full amount (minus network fee) to
   the sender, as the only output. The chain rejects refunds to any other
   address, refunds with extra outputs, and refunds that shortchange the
   sender. All proven.
4. **Once the refund happens, a late reply can never take the money.**
   Proven: the chain rejects it as a double-spend.
5. **There are no app fees, provably.** Every test decodes the real
   transactions from independent chain data: money goes
   recipient-or-sender, whole, nothing else. Proven on every run.

## The one honest caveat

**Between the deadline passing and the refund landing, a late reply is
still technically valid.** The chain cannot make a claim "expire" on its
own — the refund transaction closes the door. Because the refund needs no
key (point 3), *any* participant can slam it shut in the first block after
the deadline — sender's app, recipient's app, or an independent watcher —
and the protocol requires clients to do exactly that, and requires
recipient apps to refuse late replies. The honest product statement, chosen
deliberately at the Phase 1 gate: **"a reply or your money back — late
replies lose to the refund."**

## Message privacy (decided 2026-08-03 — Q4)

**Everything you write is encrypted. There is no plaintext mode.** Ask
messages are encrypted so only the recipient can read them; replies are
encrypted so only the original sender can read them — using the same
encryption scheme as Kasia itself (the encrypted messenger ASK extends).
Nobody needs to exchange keys first: a Kaspa address is enough.

What is still public, permanently, on-chain: who asked whom (addresses),
how much, the deadline, and whether it ended in a reply or a refund. The
words themselves are not.

One honest asterisk: Kasia publishes no official test files for their
encryption, so our "same scheme" claim rests on a careful line-by-line
reimplementation of their code, not on a cross-check against their output.
We flag this for confirmation with the Kasia team.

## The reference client (Kaskly) — what the app itself can and cannot do

The web app ("Kaskly") is one client for the open protocol; everything
above is enforced by the chain no matter which client you use. What the
app adds, honestly:

- **Your keys live in your browser only** (generated there, stored in
  browser localStorage so the wallet survives a reload). They are never
  sent to any server. This storage is appropriate for TESTNET keys only —
  which is all this project uses — and the app refuses to run on any
  non-testnet network.
- **The app's database is a disposable cache.** It stores only public
  chain data and ciphertexts — never plaintext, never keys. Every status
  it shows is re-derived from the chain, and a "rebuild from chain" action
  (plus an automated test) proves the whole cache can be deleted and
  reconstructed from public chain data alone.
- **Your own words are kept only on your device.** On-chain, your message
  is encrypted to the recipient (and their reply to you) — so the app
  keeps YOUR copy of what YOU wrote in your browser's local storage. If
  you clear it, the money flows are unaffected; you just can't re-read
  your own sent text.
- **Deadlines are watched automatically.** Once a deadline passes, the
  app broadcasts the (anyone-can-trigger) refund by itself — from the
  sender's view AND the recipient's — and the recipient's reply box is
  replaced by a clear "deadline passed" notice. This is required client
  behavior in the protocol spec, not a courtesy.
- **.kas names are a convenience lookup** against the third-party KNS
  service (api.knsdomains.org). If you use one, you are trusting that
  service to return the right address — the address itself is always
  shown before you send.

## Always true, regardless of outcome

- **Testnet only** for this entire project (no real money).
- **No fees**, ever, at the protocol level (D2).
- **Non-custodial**: your keys never touch a server (D4).
