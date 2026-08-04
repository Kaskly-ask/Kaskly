# ASK — a reply-to-claim payment primitive for Kaspa

*One page for the KaChat / Kasia teams, from the Kaskly project
(kaskly.app · `kaskly.kas`).*

Ever sent a message to someone you respect — a creator, a founder,
anyone with a flooded inbox — and watched it die unopened? **Attach KAS
to it.** They reply, they get the money. They don't, you get every cent
back. The only two endings are a reply or a refund: **a reply, or your
money back — late replies lose to the refund.**

## The mechanic (chain-enforced, no trusted party, no fees)

Funds lock in a P2SH covenant (post-Toccata, KIP-10/17 introspection)
with exactly two spend paths:

- **Claim** — requires the recipient's signature AND an ASK-namespace
  payload in the same transaction: *sending the reply IS claiming the
  money*, atomically.
- **Refund** — after the deadline (CLTV on DAA score), **no signature
  at all**: anyone can broadcast it, and the covenant pins destination,
  output count, and amount so it can only pay the sender in full. Any
  watcher closes the late-reply window in the first post-deadline block.

There are **no protocol fees** — no fee outputs, no fee addresses, by
design, forever. Messages and replies are encrypted with **Kasia's own
scheme** (ECDH x-only → HKDF-SHA256 → ChaCha20-Poly1305, reimplemented
byte-for-byte with citations); the payload namespace is
`ciph_msg:1:ask:` — *inside* Kasia's namespace, so existing Kasia
clients already classify Ask traffic as Kasia-family. In fact,
**tn10.kaspa.stream already parses ASK claims natively** — its "Kasia
payload" panel shows `msg_type: ask` with zero changes on their side.

## Proven on testnet-10 (click through)

| Evidence | Txid |
|---|---|
| ANSWERED: lock (encrypted ask) | [`1a8bb02e…`](https://tn10.kaspa.stream/txs/1a8bb02ee6d481c024ca462ad047e32f7935e5b9dd59ecc09dec082b722c03a3) |
| ANSWERED: claim-by-reply (atomic spend + encrypted reply) | [`3f02de72…`](https://tn10.kaspa.stream/txs/3f02de726903e2709368254d144c82b0d2b6d867bd9597d4455dcdb1f08b9d60) |
| REFUNDED: lock (ignored ask) | [`4bf4980c…`](https://tn10.kaspa.stream/txs/4bf4980c769516db2db1342d263c831b4b220fa38142b5d077dfa91f0949d4e7) |
| REFUNDED: **sig-less, anyone-can-trigger refund** | [`0d45a744…`](https://tn10.kaspa.stream/txs/0d45a744714c7123213850807ef2b85e7b8e0a0e9ce6c4fb19dd717c6a3daeb3) |
| Covenant hardening: open-refund V2 lock | [`c851addd…`](https://tn10.kaspa.stream/txs/c851addddfec04b86cefe37182bd482d23b3e3d207e4c33197446139614cb3cc) |
| Covenant hardening: open refund accepted (117-byte sigscript, no signature) | [`878b8fc0…`](https://tn10.kaspa.stream/txs/878b8fc0a004f21e126ef97cc7b9d7e37fac6c3db52a174a1182637cf4103366) |

The automated suite re-proves the full lifecycle **and an 11-attack
adversarial set** on demand — wrong-key claims, payload-less claims,
early refunds, wrong-destination refunds, skimmed refunds, extra
outputs, double-spends — every attack rejected **by the chain**, every
amount dual-verified from independent chain data (no fee outputs,
provably). Late claims after the refund are dead double-spends; the
pre-refund race window is closed by the anyone-can-trigger refund plus
two normative client rules (auto-broadcast at deadline; refuse late
claim construction) — all specified.

## What adopting ASK takes for a Kasia client

**The spec is the product:** [ASKSPEC.md](./ASKSPEC.md) is
self-contained — payload format, covenant template with verified
encoding notes, claim/refund construction, discovery, deadline
semantics, error table, trust model. A client that already speaks Kasia
needs:

1. One new payload kind inside your existing namespace (`ask:` — final
   name is yours to bless, see below);
2. The covenant template + two transaction builders — the reference
   library is ~600 lines of ISC-licensed TypeScript on the official
   WASM SDK, lift it whole;
3. Discovery you already have: the same block-firehose prefix filter,
   plus a §4 escrow check (rebuild the redeem script, compare the
   funded P2SH);
4. Nothing server-side, no new trust: non-custodial, feeless, and a
   resident messenger even solves notifications for free — the one
   thing a web reference client can't.

**Two things we'd like from your team:** (1) bless or rename the
`ciph_msg:1:ask:` namespace (Q3 — we deliberately shipped inside your
namespace as the integration-friendly default); (2) a cipher interop
check — your repo has no fixed test vectors, so our compatibility claim
is structural + our own pinned KAT; trading one ciphertext each settles
it in minutes.

## See it live (2–3 minute demo)

Reference client: **kaskly.app** (production deploy pending; runs today
via `npm run dev` — see [README](./README.md) cold start).

1. Two browsers, two wallets (one faucet-funded). Recipient's Inbox tab open.
2. **Compose** an Ask to the recipient (or a `.kas` name): message,
   1 TKAS, "2 min (testing)" deadline. Send → lock txid + explorer link.
3. Recipient's Inbox pops the card live — with the **"✓ escrowed"**
   badge: the client verified the announcement reproduces the funded
   covenant before showing it.
4. Type a reply → **"Reply & claim ~0.995 TKAS"** → the header's
   **Earned** counter ticks up. Sender's Sent view flips to *answered*
   with the decrypted reply, in real time.
5. Send a second Ask; ignore it. At the deadline the client
   auto-broadcasts the sig-less refund — status flips to *refunded*,
   "every sompi is back in your wallet." Try replying late: the client
   refuses cleanly ("deadline passed — funds returned to sender").
6. Click any explorer link — tn10.kaspa.stream already renders the ASK
   payload natively. Then hit "rebuild from chain" on Sent: the local
   DB drops and every record reconstructs from public chain data.

## License & contact

ISC (same as Kasia), © 2026 **The Kaskly project** — kaskly.app ·
`kaskly.kas` (KNS #96310). Spec, reference client, evidence and audit
trail: https://github.com/Kaskly-ask/Kaskly.
