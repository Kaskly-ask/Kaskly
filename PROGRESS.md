# PROGRESS — ASK Protocol

## Current phase

**Phase 0 — Scaffold + Ground Truth** (in progress)

## Phase 0 checklist

- [x] Git repository initialized (`main` branch)
- [x] Five tracking files created (PROGRESS, TRUST, TRACE, IDEAS, ASKSPEC skeleton)
- [x] Ground truth: Toccata covenant capabilities researched, sources cited (see below)
- [x] Ground truth: covenant testnet identified (TN10 working default) + endpoints recorded (see below; faucet URL still REPORTED-only)
- [x] Ground truth: Kasia payload namespace / encryption / discovery documented from their repo (see below)
- [x] Next.js + TypeScript + Tailwind scaffold (Node v24.18.1, npm 11.16.0)
- [x] Prisma + SQLite with schema per brief §3.3 (Prisma 7.9.1; migration `20260803122023_init` applied)
- [x] rusty-kaspa WASM SDK installed, version pinned (`kaspa-wasm@2.0.1` vendored, `file:` pin), script/covenant types enumerated from the installed `.d.ts` (see WASM SDK section)
- [x] App boots (production build green; `next start` served HTTP 200); DB migrates
- [x] Committed + tagged `phase-0`

## Session log

### 2026-08-03 — Session 1

- Read CLAUDE.md brief in full; began Phase 0.
- `git init` (branch `main`).
- Discovered Node.js is not installed on this machine. Per user instruction, the user is installing Node themselves from nodejs.org; scaffold resumes when they confirm.
- Launched two ground-truth research tasks (results to be recorded below with sources when complete):
  1. Kaspa: Toccata status, real covenant capabilities, current covenant testnet + endpoints/faucet, official WASM SDK package + version, timelock semantics, explorer.
  2. Kasia (github.com/K-Kluster/Kasia): payload namespace format, encryption scheme, discovery mechanism, tx mechanics, size limits, license, KNS support.
- Created PROGRESS.md, TRUST.md, TRACE.md (all spec IDs pre-populated, `unstarted`), IDEAS.md (seeded with DROPS v1.0 parking-lot items + D11 list), ASKSPEC.md skeleton.
- User installed Node.js v24.18.1 (npm 11.16.0); reachable via explicit path, no terminal restart needed.
- Scaffolded Next.js (App Router) + TypeScript + Tailwind via create-next-app (template `app-tw`, npm, no git) — pending move from `ask-client-tmp/` into repo root.
- Both research agents returned; findings recorded below with sources and confidence labels.
- Key ground-truth takeaways: (1) npm's kaspa packages are stale (0.13.0, Nov 2023) — must vendor `kaspa-wasm32-sdk-v2.0.1.zip` from the rusty-kaspa v2.0.1 GitHub release; (2) TN10 is the verified post-Toccata testnet (working default; TN12 = covenant dev-staging, endpoints unverified); (3) no published precedent exists for an ASK-shaped two-path covenant — Phase 1 spike is load-bearing; (4) Kasia's payload convention is `ciph_msg:1:<kind>:...` and their encryption needs no handshake (address = x-only pubkey).
- Recorded Q1 context from the human (KaChat dev / Kaspa Silver quote — see section above).
- Scaffold moved to repo root. create-next-app generated its own CLAUDE.md (a pointer) — discarded; kept its `AGENTS.md` (warns Next.js 16 has breaking changes vs. training data; docs ship in `node_modules/next/dist/docs/` — aligns with R6).
- Prisma 7.9.1: connection URL moved to `prisma.config.ts` (Prisma 7 change — `url` in schema.prisma is no longer supported; confirmed at prisma.io/docs/orm/reference/prisma-config-reference). SQLite `dev.db` at repo root, gitignored. Statuses are strings (Prisma+SQLite has no enums) validated at the repository layer.
- Vendored the official WASM SDK v2.0.1 (zip SHA256 above), pinned via `file:` dependency; enumerated covenant/script types from the installed `.d.ts` (see WASM SDK section).
- tsconfig: target ES2020 (BigInt literals needed for sompi), `vendor/` excluded from type-check; package renamed `ask-reference-client`.
- Verified boot: `next build` green (Next.js 16.2.12); `next start` answered HTTP 200 on localhost:3000.

### R4 self-review (Phase 0 scaffold unit)

Diff reviewed against [D10, T1, T2, T3, T4, §3.3]; deviations:
- **amount stored as `amount_sompi BigInt`** instead of the brief's literal
  `amount_kas` — money is never stored as a float; UI converts to KAS. Flagged
  for human awareness; spec (§3.3) intent (thin cache) is preserved.
- `deadline` stored as BigInt with semantics deliberately deferred to ASKSPEC.md
  (D9 says exact semantics are defined from real chain capabilities in Phase 1/2).
- No other deviations. No code exists that maps to no spec ID (scaffold
  boilerplate maps to T1; schema to §3.3; vendor pin to C1/T3).

## Ground truth (every claim carries a source, per R6)

_Confidence labels: **VERIFIED** = source fetched and read directly during research
(2026-08-03). **REPORTED** = appeared only in search-result summaries; URL given,
page not independently fetched. **UNVERIFIED** = could not be confirmed — treat as
unknown._

### Kaspa / Toccata / covenants

- **VERIFIED** Toccata activated on Kaspa mainnet at DAA score 474,165,565, ~June 30
  2026 16:15 UTC. Source: rusty-kaspa `docs/toccata-guide.md`; confirmed active by
  https://docs.kaspa.org/toccata and https://kaspaexplained.com/toccata-status.
- **VERIFIED** Covenant capability comes from **KIP-17** ("Covenants and Improved
  Scripting Capabilities", Status: Active): transaction introspection opcodes
  (`OpTxLockTime`, `OpTxPayloadSubstr`, `OpTxPayloadLen`, `OpTxInputDaaScore`,
  `OpTxInputSpk`/`OpTxOutputSpk` substr/len variants, `OpOutpointTxId`, …), byte ops
  (`OpCat`, `OpSubstr`, bitwise), arithmetic (`OpMul`/`OpDiv`/`OpMod`),
  crypto (`OpCheckSigFromStack`, `OpBlake3`, `OpZkPrecompile`), and
  `MAX_SCRIPT_ELEMENT_SIZE` raised 520 → 1,000,000 bytes. Source:
  https://github.com/kaspanet/kips/blob/master/kip-0017.md (fetched raw).
- **VERIFIED** **KIP-20** Covenant IDs (Active): consensus-tracked 32-byte UTXO
  lineage identifiers + opcodes (`OpAuthOutputCount`, `OpCovInputIdx`). Source:
  https://github.com/kaspanet/kips/blob/master/kip-0020.md. **KIP-10** introspection
  (`OpTxInputAmount`, `OpTxOutputAmount`, `OpTxOutputSpk`, input/output counts) is
  Active. Source: https://github.com/kaspanet/kips/blob/master/kip-0010.md.
- **VERIFIED** In rusty-kaspa, all new opcodes are gated behind a runtime
  `covenants_enabled` flag. Source: `crypto/txscript/src/opcodes/mod.rs` (fetched).
- **VERIFIED** Node releases: rusty-kaspa **v2.0.0** "Mainnet Toccata Release"
  (2026-06-05) and **v2.0.1** (2026-06-15; adds RPC for seq-commit state + lane
  proofs). New RPC fields `RpcTransactionOutput.covenant`,
  `RpcUtxoEntry.covenant_id`; `mass` → `storage_mass`; min fee raised to 100
  sompi/gram. Sources: GitHub releases API; `docs/toccata-guide.md`.
- **VERIFIED** Official covenant example code: rusty-kaspa
  `crypto/txscript/examples/covenants.rs` (stateful counter covenant: P2SH with
  script pushed in sig script; uses `OpTxPayloadSubstr`, `OpTxInputSpk`,
  `OpTxOutputSpk`, `OpTxOutputCount`, `OpBlake2bWithKey`, `OpOutpointTxId`), plus
  `covenant_id.rs`, `kip-10.rs`. Caveat: these run in a **local TxScriptEngine test
  harness**, not against a live network. No published end-to-end live-testnet
  covenant walkthrough found.
- **VERIFIED** Timelocks: `OpCheckLockTimeVerify` (0xb0) and `OpCheckSequenceVerify`
  (0xb1) are implemented and active (NOT behind the covenants flag). Source:
  `crypto/txscript/src/opcodes/mod.rs`. `LOCK_TIME_THRESHOLD = 500_000_000_000`
  (`consensus/core/src/constants.rs`): lock times below it are **DAA scores**, at or
  above are timestamps (per kaspad `constants.go` doc comment; exact ms-unit
  semantics to re-confirm from installed source in Phase 1).
- **UNVERIFIED / no precedent found**: an ASK-shaped two-path covenant
  ("claim-with-reply-payload by key R before deadline OR refund to S after") has no
  published example anywhere. **The Phase 1 spike is genuinely load-bearing.**
- Ecosystem tooling: docs.kaspa.org/toccata names **Silverscript** as the main
  covenant authoring path (VERIFIED at docs.kaspa.org/toccata; language ref at
  vprogs.xyz unreachable during research). **Portrait** covenant pattern library
  (VERIFIED https://portrait.kaspa-kii.org/ — 35 testnet-only patterns incl.
  timelock, escrow; repo github.com/kaspakii/portrait). **Covex** TN12 covenant
  explorer (UNVERIFIED — repo 404 unauthenticated).

### Testnet selection (D10)

- **VERIFIED** **Testnet-10 (`testnet-10`) carries the post-Toccata ruleset** —
  activated via tn10-toc2 (hardfork 2026-05-18, DAA 467,579,632) and tn10-toc3 (ZK
  hardening, DAA 476,232,000). Sources: GitHub releases API;
  kaspaexplained.com/toccata-status (confirmed TN10 virtual DAA past both scores).
- **REPORTED** **Testnet-12 (TN12)** is the covenant-focused developer/staging net
  where Silverscript tooling works; explorer https://tn12.kaspa.stream/ (host live,
  HTTP 200). TN12 exact network-id string, node endpoints, faucet: **UNVERIFIED**.
- Endpoints: TN10 REST **https://api-tn10.kaspa.org** (via kaspaexplained). wRPC:
  use the SDK **Resolver** against the Public Node Network with `testnet-10`
  (REPORTED via kaspa-ng/kaspa-rest-server README), or run a local node
  (`kaspad --testnet --utxoindex` + TN10 netsuffix). TN10 node map:
  https://nodes-tn10.kaspa.ws/ (REPORTED).
- Faucets: **https://faucet-tn10.kaspanet.io** (REPORTED; probe returned 403 —
  likely bot protection). Fallback: Kaspa Discord #testnet. No TN12 faucet found.
- Explorers: https://explorer-tn10.kaspa.org/ (host live; probed) and
  https://tn10.kaspa.stream/. Tx URL pattern likely `/txs/<txid>` — **UNVERIFIED**,
  confirm by click-through before wiring C4 links.
- **Working decision (inference, not fact): default to TN10** — verified Toccata
  ruleset + real infrastructure; probe TN12 in Phase 1 if Silverscript tooling is
  needed. Revisit at the Phase 1 gate.

### WASM SDK

- **VERIFIED — npm is STALE; do not npm-install the SDK.** npm `kaspa` latest is
  0.13.0 published **2023-11-17** (registry JSON fetched); `kaspa-wasm` likewise
  0.13.0. No npm package carries the Toccata-era v2.x SDK.
- **VERIFIED** Current official SDK ships as a GitHub release asset:
  **`kaspa-wasm32-sdk-v2.0.1.zip`** (53.5 MB) on rusty-kaspa v2.0.1 (GitHub API,
  `/releases/latest`). Built from `rusty-kaspa/wasm`; browser variants
  (KeyGen/RPC/Core/Full) + one all-features Node.js package. Docs:
  https://kaspa.aspectron.org/docs/ (TypeDoc; host refused connections during
  research). → **Plan: vendor the zip, pin via `file:` dependency (T3).**
- **VERIFIED** WASM bindings export `ScriptBuilder` (`crypto/txscript/src/wasm/
  builder.rs`) and an `Opcodes` enum including the KIP-17 set: `OpTxLockTime=0xb5`,
  `OpTxPayloadSubstr=0xb8`, `OpTxInputDaaScore=0xc0`, `OpTxInputSpk=0xbf`,
  `OpTxOutputSpk=0xc3`, `OpCat=0x7e`, `OpCheckSigFromStack=0xd7`, plus
  `OpCheckLockTimeVerify=0xb0`/`OpCheckSequenceVerify=0xb1`. Source: fetched
  `crypto/txscript/src/wasm/opcodes.rs`.
- **VERIFIED from the INSTALLED package** (2026-08-03; source:
  `vendor/kaspa-wasm32-sdk/nodejs/kaspa/kaspa.d.ts`, package `kaspa-wasm@2.0.1`
  from `kaspa-wasm32-sdk-v2.0.1.zip`, SHA256
  `7EAFFAC9CD920EF2FDF540C6E10F2A2B7761170EBC62EC57DFA0F71C64567A71`, pinned in
  package.json as `"kaspa-wasm": "file:vendor/kaspa-wasm32-sdk/nodejs/kaspa"`):
  - `enum Opcodes` includes the full KIP-17 set: `OpCat=126`,
    `OpCheckLockTimeVerify=176`, `OpTxLockTime=181`, `OpTxPayloadSubstr=184`,
    `OpTxInputDaaScore=192`, `OpTxOutputSpk=195`, `OpTxOutputSpkLen=199`,
    `OpTxOutputSpkSubstr=200`, `OpCheckSigFromStack=215`,
    `OpCheckSigFromStackECDSA=216` (kaspa.d.ts:581-686).
  - `class ScriptBuilder`: `addOp`, `addOps`, `addData`, `addI64`,
    `addLockTime(bigint)`, `addSequence(bigint)`, `createPayToScriptHashScript()`,
    `encodePayToScriptHashSignatureScript(signature)`, `fromScript`, `drain`
    (kaspa.d.ts:7031+). P2SH covenant flow matches rusty-kaspa's covenants.rs
    example (script pushed in signature script).
  - **Covenant-native types exist**: `covenantId(genesis_outpoint, auth_outputs)`
    (kaspa.d.ts:58), `class CovenantBinding(authorizing_input, covenant_id)`
    (:5439), `class GenesisCovenantGroup` (:5676), `ICovenantBinding`,
    `IGenesisCovenantGroup`, `ICovenantAuthorizedOutput`;
    `PaymentOutput.withCovenant(address, amount, covenant)` (:6009);
    `TransactionOutput` constructor takes optional `covenant` (:7295).
  - Payload support: `createTransaction(utxo_entries, outputs, priority_fee,
    payload?, sig_op_count?)` (:173); `ITransaction.payload: HexString`.
  - RPC: `subscribeBlockAdded()` (:6729), **`getUtxoReturnAddress()` (:6771 — now
    in the OFFICIAL SDK; Kasia's fork requirement is obsolete as of 2.0.1)**,
    `getDaaScoreTimestampEstimate()` (:6860), `Resolver` class for the public
    node network.
  - Plan-B-relevant: `PSKT`/`PSKB` classes (partially-signed Kaspa
    transactions), `createInputSignature`, `signScriptHash`.
  - The SDK zip also ships `docs/` (TypeDoc) and `examples/` (kept locally,
    not committed; re-extract the zip to restore).

### Kasia conventions (D6, D7)

_Source basis: shallow clone of K-Kluster/Kasia branch `staging` (HEAD `acd3cf6`,
2026-02-01); the five load-bearing protocol/crypto files were diffed against
`master` (HEAD `3795bc7`, 2026-06-27) and are **identical**, except `master`'s
`src/config/constants.ts` adds `BASE_FEE_RATE = 100` ("Toccata minimum fee rate, in
sompi per gram"). Repo: https://github.com/K-Kluster/Kasia (license ISC, actively
maintained, homepage kasia.fyi)._

- **VERIFIED — payload namespace** (`src/config/protocol.ts`): on-chain tx payload
  (hex-encoded UTF-8) is `ciph_msg:` + `1:` + `<kind>:` + body. Kinds: `handshake`,
  `comm`, `payment`, `self_stash`, `bcast`. So the convention is
  **namespace-first, then version**: `ciph_msg:1:<kind>:...`. Detection is a pure
  prefix check: `tx.payload.startsWith(toHex("ciph_msg:"))`
  (`src/utils/message-payload.ts`). Body encodings vary by kind: `comm` bodies are
  **base64** of ciphertext (`ciph_msg:1:comm:<alias>:<base64>`), handshake/payment
  append **raw ciphertext hex**. Conversation alias = 6 bytes / 12 hex chars
  (`ALIAS_LENGTH = 6`, `src/config/constants.ts`).
- **VERIFIED — encryption** (`cipher/src/lib.rs`, `cipher/Cargo.toml`): the D7
  claim is confirmed — ephemeral **ECDH on secp256k1** (`k256` 0.13.4) →
  **HKDF-SHA256** (no salt, empty info, 32-byte okm) → **ChaCha20-Poly1305**
  (`chacha20poly1305` 0.10.1), random 96-bit nonce, no AAD. Wire format:
  `nonce(12) || ephemeral pubkey (33, SEC1 compressed) || ciphertext`, hex.
  **Key insight: no handshake needed to encrypt** — the recipient's schnorr
  address payload IS the x-only pubkey, lifted with assumed even parity
  (`XOnlyPublicKey::from_slice(address.payload)`). Directly reusable for
  encrypting an Ask to any Kaspa address.
- **VERIFIED — discovery** (`src/service/block-processor-service.ts`): clients
  subscribe to **all new blocks** via wRPC (`subscribeBlockAdded`) and filter
  client-side by payload prefix, then by conversation alias / own-address outputs.
  It is a block firehose + payload filter, NOT address subscription. Sender
  resolution uses `rpcClient.getUtxoReturnAddress({txid, acceptingBlockDaaScore})`
  (`sender-and-acceptance-resolution-service.ts`) — **an RPC missing from the
  official WASM SDK**; Kasia's README requires IzioDev's fork build
  (rusty-kaspa `v1.0.1-beta1`) for it. Optional REST indexer for history
  (github.com/K-Kluster/kasia-indexer; indexer.kasia.fyi / dev-indexer.kasia.fyi;
  user-disableable). Kasia public nodes: `wss://wrpc.kasia.fyi`,
  `wss://dev-wrpc.kasia.fyi` (`.env.production`).
- **VERIFIED — tx mechanics** (`src/service/account-service.ts`,
  `transaction-generator.ts`): default **0.2 KAS** sent with messages/handshakes;
  tx = one `PaymentOutput(dest, amount)` + change to sender + payload set at tx
  level via WASM `Generator` (`IGeneratorSettingsObject`). **Handshake protocol
  exists**: sender sends `ciph_msg:1:handshake:<hex>` tx TO the recipient
  (encrypted `HandshakePayload` JSON with random alias); recipient responds
  confirming aliases. Subtlety: ongoing `comm` messages are sent **to the
  sender's own address**; the recipient finds them by alias via the firehose.
- **VERIFIED — size limits** (`src/config/constants.ts`):
  `MAX_PAYLOAD_SIZE = 17.7 * 1024` (≈18,125 bytes, self-described heuristic
  "basic kb limit"), `MAX_CHAT_INPUT_CHAR = 18000`,
  `STANDARD_TRANSACTION_MASS = 2036` grams, `MAX_PRIORITY_FEE` capped at 2 KAS.
  **UNVERIFIED**: the actual Kaspa consensus payload limit (confirm from
  rusty-kaspa source before fixing ASK size limits in ASKSPEC.md).
- **VERIFIED — no written protocol spec exists** in the Kasia repo (protocol
  lives in code only). ASKSPEC.md would be the first written spec in this
  ecosystem — payload-format claims must cite Kasia code paths, not docs.
- **VERIFIED — KNS**: supported via off-chain REST
  (`api.knsdomains.org/{mainnet|tn10|tn12}/api/v1/{name}/owner`,
  `src/service/integrations/kns-integration-service.ts`); `.kas` names resolved
  with debounce in the new-chat form; the `tn12` endpoint is marked broken in a
  code comment. Note: a trusted third-party service.
- **Kasia's rusty-kaspa pin**: git tag `v1.0.0` (cipher/Cargo.toml) — pre-Toccata;
  master's `BASE_FEE_RATE = 100` is their only Toccata adaptation found.
- Local clone kept for reference at the session scratchpad
  (`scratchpad/kasia-repo`); re-clone from the URLs above if needed.

### Q3 implication (for the human, from the data)

Kasia's convention is namespace-first (`ciph_msg:1:<kind>:`). ASK as a Kasia
extension could be either `ciph_msg:1:ask:...` (inside Kasia's namespace — every
existing Kasia client would see the prefix) or a parallel `ask:1:...` namespace
(clean separation; invisible to current Kasia clients). This shapes Q3 and should
be raised with the KaChat/Kasia teams.

## Q1 context from the human (recorded 2026-08-03)

Conversation with the KaChat dev — **Kaspa Silver (@KaspaSilver on X)**, who is
also one of the four named Kasia maintainers (see Kasia ground truth below):

> "The idea sounds great! I think this might utilize covenants to make it
> possible. There will be a dedicated covenants update for KaChat and this can
> seriously be looked into more. Right now all focus is getting the foundation
> built with the most expected features that should be present for anyone using
> KaChat."

Implications for this project:
- Independent validation of the covenant-first design (D5) from the adoption
  target itself.
- KaChat has a **dedicated covenants update planned** — ASK should be positioned
  as ready-made material for that update (spec + proven testnet reference
  implementation), which is exactly the DEL-1/DEL-2/DEL-3 shape.
- Their near-term focus is core KaChat features, not covenants — so nothing is
  blocked on them, and the pitch (Phase 4) should minimize their integration
  lift: self-contained spec, working reference code, recorded lifecycle txids.

## Open questions for the human (Section 10)

- Q1: ~~KaChat dev input~~ — answered; recorded above.
- Q3: Final protocol namespace + name (placeholder `ask:1:`) — needed before ASKSPEC.md v0.1 freezes in Phase 2.
- Q4: D7 reply privacy decision — deferred to Phase 2 gate.
- Q5: Open-source license + attribution — needed before Phase 4.

## Blockers

- Node.js installation (user is handling; scaffold + SDK type enumeration wait on this).
