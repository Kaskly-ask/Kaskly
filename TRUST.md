# TRUST — What enforces what in ASK

_This file is the plain-language map of what the Kaspa chain enforces versus
what requires trusting the app. It must stay accurate with every escrow
change, and be readable by a non-developer. (Brief §7 L1, §8 R6.)_

## ⚠️ UNDER REVISION — three claims below were found FALSE (2026-08-04)

**A security review of our own escrow found real defects. We are
correcting this document immediately rather than waiting for the fix,
because an earlier version of it claimed protections the code does not
deliver.** This is testnet only, so no real money was ever at risk — but
the claims were wrong and you should know exactly how.

What was found (all recorded publicly in PROGRESS.md, findings F12-F23):

1. **A refund can pay you back LESS than you locked (F12 — proven on
   chain).** The escrow rule checks the refund's *outgoing* side but never
   limits how many locked Asks can be spent at once. Someone can refund
   several of your expired Asks in one transaction that pays you only the
   largest one, and the rest goes to a miner as fee. We demonstrated this
   on testnet: 4 KAS locked, 2.995 KAS returned, 0.995 KAS lost.
2. **Very small Asks can become permanently stuck (F13).** Below roughly
   0.105 KAS, the network fee required to move the money exceeds what the
   escrow rule allows the refund to spend — so neither a reply nor a
   refund can ever succeed and the funds stay locked forever. The app
   currently only blocks Asks below 0.005 KAS, which is far too low.
3. **A "reply" is enforced much more loosely than we said (F22).** The
   chain only checks that a claim's payload *starts with* our 15-byte
   label. It does not verify the reply is real, readable, or that it
   belongs to your Ask — so one payload can claim several people's Asks
   at once, and a claim carrying nonsense still takes the money.

A fourth, related problem: when a claim like that happens, this app has
been **showing the sender "refunded — every sompi is back in your
wallet"** even though the money went to the recipient (F14). That is a
display bug in the app, not the chain, and it is being fixed.

A revised escrow rule covering these is being designed and will be
re-proven on testnet before it ships. Until then, treat the guarantees
below as the corrected — and smaller — set.

## What the chain really enforces (corrected 2026-08-04)

Still true, and re-proven by the automated suite on every run:

1. **Only the recipient can move the money, and only in a transaction
   carrying a payload with our label.** Chain rejects wrong-key claims and
   claims with no payload or a non-ASK payload. True — but see F22 above:
   "carrying our label" is much weaker than "carrying a genuine reply to
   this Ask", which is what we previously implied.
2. **Before the deadline, the sender cannot take the money back.** Chain
   rejects early refunds. Proven.
3. **After the deadline, the refund needs nobody's permission and nobody's
   key.** The refund carries NO signature — anyone can send it, and it can
   only pay *your* address, as the only output. The chain rejects refunds
   to any other address and refunds with extra outputs. Proven. **What it
   does NOT guarantee: that you get the full amount back** — see F12.
4. **Once a refund happens, a late reply can never take the money.**
   Proven: the chain rejects it as a double-spend.
5. **There are no app fees.** Every test decodes the real transactions
   from independent chain data: money goes recipient-or-sender, and no fee
   output exists anywhere. Proven on every run. (Network *miner* fees are
   separate and unavoidable — F12 and F13 are both about those.)

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
- **Contact names are yours alone.** Naming an address stores the label
  in your browser only — never sent anywhere, and never a substitute for
  the address itself, which stays visible beside every name.
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

## A trust assumption we chose on purpose: the transaction indexer

This one is a deliberate design limit, not an oversight, and it is the
main thing to know before trusting what a *settled* Ask says on screen.

Kaspa nodes do not index transactions by id. A node can tell you what is
unspent right now, but it cannot hand you an old transaction or an address
history — that is what a separate *indexer* service is for. This app reads
one (`api-tn10.kaspa.org`). There is no second source to check it against,
because building one means running real infrastructure, not writing a
patch. So we state the assumption rather than paper over it.

**What a dishonest indexer could do:** change the message text you see on
an Ask, misreport whether a finished Ask was answered or refunded, alter
the reply text shown to a sender, or make a settled Ask look unresolved.
That is deception, and it is worth taking seriously.

**What it cannot do — the bound that matters:**

- **It cannot move your money.** Refunds are pinned by the covenant to the
  sender's address, and claims require the recipient's signature. No
  indexer, and no operator of this app, has a spend path.
- **It cannot invent a settlement or hide one.** Whether the escrow is
  still funded comes from your Kaspa node, not the indexer. The app only
  consults the indexer *after* the node says the funds have moved.
- **It cannot forge a message on its own.** Displayed text is checked
  against the announcement in the lock transaction; a mismatch is refused
  rather than shown. Faking that requires the indexer *and* a write to
  this app's cache.

So the honest summary: a hostile indexer can lie to your eyes about a
finished Ask. It cannot take, redirect, or freeze a single sompi.

Tracked as **OPW-2**, status *documented-and-bounded* — the same standing
as the mainnet gates: a known assumption with a stated limit, carried
deliberately, and named as such in the external review brief so a reviewer
knows it was chosen rather than missed.

## Always true, regardless of outcome

- **Testnet only** for this entire project (no real money).
- **No fees**, ever, at the protocol level (D2).
- **Non-custodial**: your keys never touch a server (D4).

## Why this page changed

We ran an adversarial review of our own code with "how would I steal
these funds" as the goal, and it found the problems above. We chose to
correct this page the same day rather than quietly fix the code first,
because a trust document that overstates its guarantees is worse than no
trust document. The full findings — including the ones not listed here,
and the ones that turned out to be fine — are in PROGRESS.md, and the
testnet transaction that demonstrates F12 is recorded there with its
transaction id so anyone can check it against the chain.

No path was found for anyone to steal a locked Ask from its intended
recipient, and no path was found to keys or funds through this app's
server — it never holds either.
