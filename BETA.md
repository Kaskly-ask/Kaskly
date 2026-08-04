# Kaskly testnet beta — tester onboarding

## The Discord blurb (copy-paste, fill the URL)

> **Kaskly beta — attach TKAS to a message; a reply claims it, silence
> refunds you.** 🧪 Testnet-10 only, no real money anywhere.
>
> Ever sent a message that died unopened? Kaskly locks testnet KAS to
> it under a native Kaspa covenant: the recipient replies, they get the
> money — the reply IS the claim, one atomic transaction. No reply by
> your deadline? Anyone can trigger the refund, and it can only pay
> you. No fees, non-custodial, end-to-end encrypted, and every claim is
> enforced by the chain, not by us.
>
> 👉 Try it: **https://kaskly.app** (takes 3 minutes: make a wallet in
> the header, grab faucet TKAS, ask somebody something)
> 🚰 Faucet: https://faucet-tn10.kaspanet.io (if it blocks you, ask
> here for a top-up)
> 🐛 Feedback: right in this thread (there's a link in the app footer)

## Getting started (3 minutes)

1. Open the app and click **Connect wallet** (top right) → **Create
   testnet wallet**. Your keys are generated and stored in your browser
   only — they never touch our server. This also means: **your wallet
   lives in that browser profile.** Clear site data and it's gone
   (testnet, so nothing of value — but don't be surprised).
2. Get testnet KAS: paste your address (copy button in the wallet
   panel) into the faucet. ~2 TKAS is plenty. **Never paste a real
   mainnet key anywhere in this app** — it only speaks testnet, but
   good hygiene is good hygiene.
3. **Ask someone.** Grab a partner from the thread (or use two browsers
   yourself). Compose: their address, your message, an amount, a
   deadline. Sending locks the KAS under the covenant and delivers the
   encrypted message in the same transaction.

## What to try (and what to try to break)

- The happy path: send an Ask → partner's Inbox pops it live (note the
  **✓ escrowed** badge — the client verified the money is really locked
  before showing the card) → they reply → they claim, their **Earned**
  counter ticks up, you see the reply decrypted in Sent.
- The refund: send an Ask to someone who ignores it (1-hour minimum
  deadline — grab a coffee). At the deadline the app broadcasts the
  refund automatically; watch it land in Sent. Try replying after the
  deadline — the app must refuse cleanly.
- Explorer links on every card — tn10.kaspa.stream parses ASK payloads
  natively (look for the "Kasia payload" panel).
- "rebuild from chain" (top of Sent): drops your cached lists and
  reconstructs everything from public chain data.
- Try to break it: paste `<script>` junk in messages, mash huge
  replies, tiny amounts with giant replies, double-click Send… if you
  find something embarrassing, that's exactly what the thread is for.

## Known limitations (honest list, from TRUST.md)

- **Keep the tab open to receive.** Discovery is live (block firehose);
  there are no push notifications yet. Asks sent while you're offline
  are found when the sender's client or a rebuild reaches them — but
  the live pop needs the tab.
- **Contact names are stored in this browser only, like your keys.** You
  can name any address (tap the ✎ next to it) — the name is private to
  you, never transmitted, and the real address always stays visible
  beside it.
- **Your own sent text is stored only in your browser.** On-chain it's
  encrypted TO THE RECIPIENT — if you clear the browser, the money
  flows are untouched but you can't re-read your own words.
- **Deadlines are estimates on screen.** The chain counts DAA score
  (~10/s), not wall clocks; countdowns can drift a few seconds.
- **Late replies lose to the refund** — between the deadline passing
  and the refund landing there is a short window where a reply is
  technically still valid; every client (including yours) races to
  close it automatically. This is stated in the spec, not hidden.
- **Testnet infrastructure is community-run** — if public nodes have a
  bad moment you'll see a retry banner; nothing is lost.
- The encryption is Kasia's scheme, reimplemented from their source;
  cross-implementation interop with Kasia-produced ciphertext is
  pending a vector exchange with their team (structural claim +
  known-answer test on our side).

## Where to report

The footer's **"report a bug"** link points at the beta thread. Include
what you did, what you expected, what happened, and (if a transaction
is involved) the txid from the card's explorer link — every card links
its lock/claim/refund transactions.
