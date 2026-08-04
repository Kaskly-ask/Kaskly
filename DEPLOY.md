# Deploying Kaskly (testnet beta)

*Deployment itself is human-led; this documents the recommendation, the
exact steps, and the reasoning. Written for the Discord testnet beta,
2026-08-04.*

## Hosting recommendation: a persistent Node host (Render or Railway)

**Recommended for the beta: Render (or Railway) running `next start`
with a persistent disk. NOT Vercel or Cloudflare Pages yet.**

Why: the cache DB is SQLite on local disk. Vercel and Cloudflare Pages
run serverless/workers with no persistent writable filesystem — SQLite
would silently reset or fail there. Migrating the cache to hosted
Postgres is designed-for (the repository layer is Postgres-swappable,
brief T2) but is real work and real risk to take on the night before a
beta; do it for the public launch if serverless is wanted then. A plain
Node host runs this repo **unchanged**.

Everything else is host-agnostic: keys and signing stay in the tester's
browser (wRPC goes browser → public Kaspa nodes directly — our server
never touches chain traffic), and the 11.5 MB wasm is a static asset
any host serves fine.

## Server setup (Render example — Railway is equivalent)

1. Create a **Web Service** from the GitHub repo (`Kaskly-ask/Kaskly`).
   Private repos work via the GitHub integration — no need to flip the
   repo public for the beta.
2. Runtime: Node **24**. Add a **persistent disk** (1 GB is plenty),
   mounted at e.g. `/data`.
3. Build command: `npm ci && npx prisma generate && npm run build`
4. Start command: `npx prisma migrate deploy && npm run start`
5. Environment variables — copy from `.env.example`, with these values:

| Variable | Production-testnet value |
|---|---|
| `DATABASE_URL` | `file:/data/kaskly.db` (on the persistent disk) |
| `KASPA_NETWORK_ID` / `NEXT_PUBLIC_KASPA_NETWORK_ID` | `testnet-10` |
| `NEXT_PUBLIC_KASPA_WRPC_URL` | empty (public-node resolver) |
| `NEXT_PUBLIC_EXPLORER_TX_URL_BASE` | `https://tn10.kaspa.stream/txs/` |
| `NEXT_PUBLIC_KASPA_REST_API_BASE` | `https://api-tn10.kaspa.org` |
| `NEXT_PUBLIC_FEEDBACK_URL` | the Discord beta thread URL |

> **`NEXT_PUBLIC_*` values are baked in at BUILD time.** Changing one
> (e.g. the feedback URL) requires a rebuild/redeploy, not just a
> restart. Render triggers the rebuild automatically on env-var changes.

### Temporary soak-testing override (REMOVE BEFORE BETA)

`NEXT_PUBLIC_BETA_MIN_DEADLINE_SECONDS` — when set to a value in
`1..3599` (e.g. `120`), the deployed compose picker gains one extra
"(soak test)" deadline chip at exactly that value, for repeated
refund-cycle testing on the production deploy. Deliberately env-gated,
NOT NODE_ENV-gated. When absent (the normal state) the floor is 1 hour
and no trace of the option renders. Honesty note: the chain accepts any
deadline — this floor is client policy, and the flag reaches the client
at build time so the picker options and the pre-send validation read
the same value; there is no server-side enforcement point to drift from.

**This var MUST be removed (and the auto-rebuild verified) before the
beta announcement** — see the checklist below.

## Pre-beta announcement checklist

Run top to bottom before posting the BETA.md blurb:

- [ ] **Remove `NEXT_PUBLIC_BETA_MIN_DEADLINE_SECONDS`** from Render env
      → wait for the auto-rebuild → verify the compose picker shows NO
      "(soak test)" chip and 1 hour is the shortest option
- [ ] `NEXT_PUBLIC_FEEDBACK_URL` set to the Discord beta thread → footer
      "report a bug" link present and pointing at the right thread
- [ ] `https://<domain>/kaspa_bg.wasm` returns binary (starts `00 61 73
      6d`), and a hard-refreshed browser loads the app with no console
      errors
- [ ] Create-wallet → faucet → send → reply loop works once end-to-end
      on the deployed site
- [ ] DNS: kaskly.app resolves with valid TLS (if launching on the
      domain rather than the onrender URL)
- [ ] Fill the URL into the BETA.md blurb, then post

The client refuses to boot on any non-testnet network id, and
production builds statically exclude the "2 min (testing)" deadline
chip — the deployed minimum is 1 hour by construction.

## DNS: pointing kaskly.app at the service (human steps, Cloudflare)

1. In Render: service → Settings → Custom Domains → add `kaskly.app`
   (and `www.kaskly.app` if wanted). Render shows the target hostname
   (e.g. `kaskly.onrender.com`) and a verification record if asked.
2. In the Cloudflare dashboard for kaskly.app → **DNS**:
   - Add `CNAME` — Name: `@` (apex; Cloudflare supports CNAME
     flattening) — Target: the Render hostname — Proxy status: **DNS
     only (grey cloud) first**, until the host has issued its TLS cert
     for the domain; flip to Proxied (orange) afterwards if you want
     Cloudflare in front.
   - Optionally `CNAME www` → same target.
3. Back in Render, wait for the domain to verify and the certificate to
   issue (minutes). Visit https://kaskly.app.
4. DNSSEC (pending on the registration) is independent — enable it in
   Cloudflare → DNS → Settings whenever; it doesn't block any of this.

## Beta-scale notes

- ~20 concurrent testers is trivial load: each browser talks to public
  Kaspa nodes itself; our server only serves static assets and the tiny
  cache API (which is hardened: per-address deletes only, hard field
  caps on writes, and nothing renders without chain verification).
- The cache DB is disposable by design — if it's ever wiped, testers
  lose only cached lists; "rebuild from chain" and the firehose restore
  reality. Their keys and message plaintexts live in their browsers.
- If the public TN10 nodes have a bad day (they're community-run), the
  app shows a calm retry banner; nothing breaks.
