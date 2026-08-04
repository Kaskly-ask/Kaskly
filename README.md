# Kaskly — Just Ask Me

**Attach KAS to a message. They reply, they get the money. They don't,
you get every cent back.**

Kaskly is the reference client for **ASK**, an open reply-to-claim
payment protocol for [Kaspa](https://kaspa.org), built as an extension
to the [Kasia](https://github.com/K-Kluster/Kasia) encrypted-messaging
conventions and powered by Kaspa's native covenants (post-Toccata).
The escrow rules are enforced by the chain itself: only the recipient
can claim, only with a transaction that carries a reply, and after the
deadline the refund needs nobody's key — anyone can trigger it, and it
can only pay the sender.

- **Protocol spec:** [ASKSPEC.md](./ASKSPEC.md) — self-contained;
  implement an interoperable client from it alone
- **Trust model, in plain language:** [TRUST.md](./TRUST.md)
- **Pitch + demo script:** [PITCH.md](./PITCH.md)
- **Live app:** [kaskly.app](https://kaskly.app) (testnet beta) ·
  `kaskly.kas` on-chain (KNS inscription #96310)

> **TESTNET ONLY.** Everything here runs exclusively on Kaspa
> testnet-10. No real money is involved anywhere, and the client
> refuses to boot against a non-testnet network.

## Cold start

Prerequisites: **Node.js ≥ 24** (developed on v24.18.1) and npm. The
Kaspa WASM SDK is vendored in-repo — no external SDK download needed.

```bash
git clone https://github.com/Kaskly-ask/Kaskly.git
cd Kaskly
npm install
cp .env.example .env        # defaults are correct for testnet-10
npx prisma generate         # generates the DB client (install does not)
npx prisma migrate deploy   # creates the local SQLite cache (dev.db)
npm run dev
```

Open http://localhost:3000. Create a wallet with the button in the
header (keys are generated and stored in your browser only — they never
touch the server), then fund it with testnet KAS:

- Faucet: https://faucet-tn10.kaspanet.io (has bot protection; if it
  refuses you, ask in the Kaspa Discord `#testnet` channel)
- You need ~2 TKAS to try things comfortably. Claiming needs none —
  the network fee comes out of the claimed amount.

To try the full loop, open a second browser (or a phone on your LAN),
create a second wallet there, and send an Ask from the funded one.
Development builds include a "2 min (testing)" deadline for watching
the refund path without waiting an hour.

## Tests

```bash
npm test                    # unit suite (fast, no network)
npm run test:integration    # full lifecycle + attack suite on TN10
```

The integration suite drives the REAL testnet: it locks, claims,
refunds, and fires the whole adversarial attack set (wrong keys, early
refunds, skimmed refunds, oversized payloads, double-spends), expecting
the CHAIN to reject each attack. It needs funded test keys:

```bash
node spike/01-keys.cjs      # writes spike/.keys.json (gitignored)
# fund the printed sender address from the faucet (~5 TKAS), then:
npm run test:integration
```

## Repository layout

| Path | What it is |
|---|---|
| `ASKSPEC.md` | The protocol spec (the most important artifact here) |
| `src/lib/ask/` | Protocol library: codec, covenant, crypto, transactions, discovery |
| `src/app/`, `src/components/` | The reference client UI (Next.js) |
| `src/lib/` (rest) | Client state: wallet, chain, activity, rebuild-from-chain |
| `tests/` | Unit + on-chain integration/attack suites |
| `spike/` | Phase-1 feasibility scripts (throwaway by design, kept as evidence) |
| `vendor/kaspa-wasm32-sdk/` | Pinned official Kaspa WASM SDK v2.0.1 (nodejs + web builds) |
| `PROGRESS.md`, `TRACE.md`, `TRUST.md`, `IDEAS.md` | The build's audit trail: decisions, spec-to-test traceability, trust model, parking lot |

## Architecture in one paragraph

All keys, signing, and chain operations live in the **browser** (the
web build of the official Kaspa WASM SDK, over public-node wRPC — the
same architecture Kasia uses). The Next.js server only serves the app
and a SQLite **cache** of public chain data; the chain is the sole
source of truth, and a "rebuild from chain" action (plus an automated
test) proves the cache can be deleted and reconstructed from public
chain data alone. Messages and replies are end-to-end encrypted with
Kasia's scheme; addresses, amounts, and deadlines are public on-chain,
and the UI says so.

## License

[ISC](./LICENSE) — © 2026 The Kaskly project (kaskly.app /
`kaskly.kas`). Same license as Kasia. The Kasia project's conventions
are used with attribution; see ASKSPEC §12.
