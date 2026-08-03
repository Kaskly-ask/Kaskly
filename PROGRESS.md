# PROGRESS — ASK Protocol

## Current phase

**Phase 2 — Protocol spec + core lifecycle** (in progress)

### Phase 1 gate decision (human, 2026-08-03)

- **Q2: Phase 1 GREEN APPROVED** — covenant architecture confirmed.
- **F1/D9: honest framing adopted** — "a reply or your money back; late
  replies lose to the refund." CLAUDE.md D9 amended accordingly (same date).
- **Anyone-can-trigger refund** (covenant-pinned destination/amount) is a
  Phase 2 design goal: attempt it; report if introspection opcodes can't
  express it.
- **Normative client rules for ASKSPEC**: sender clients auto-broadcast the
  refund at deadline; recipient clients refuse to construct late claims.
- **Q3 decided (human, 2026-08-03): `ciph_msg:1:ask:` provisionally, flagged
  PENDING in ASKSPEC** — final namespace to be confirmed with the Kasia team
  when the pitch lands. Rationale: inside their namespace means existing
  Kasia clients already see Ask transactions as Kasia-family traffic
  (integration-friendly default); if they prefer separation, the version
  bump path handles it.

### Pitch material noted by the human (2026-08-03, for PITCH.md)

The tn10.kaspa.stream explorer **natively parses ASK payloads** — it shows a
"Kasia payload" panel with msg_type "ask" for the claim tx. Screenshot-worthy
evidence that the inside-namespace Q3 choice makes ASK ecosystem-native on
day one. tn10.kaspa.stream confirmed as the working explorer for C4 links
(.env.example updated).

## Phase 2 checklist

- [x] Hardened refund covenant spike — **SUCCESS (2026-08-03, TN10)**. The
      anyone-can-trigger refund IS expressible. V2 refund branch:
      `CLTV(deadline) + OpTxOutputCount==1 + OpTxOutputSpk(0)==senderSPK +
      OpTxOutputAmount(0)>=minRefund` — NO signature required. Results
      (spike/06-open-refund.cjs):
      - V2 lock: `c851addddfec04b86cefe37182bd482d23b3e3d207e4c33197446139614cb3cc`
      - Attack, refund to wrong destination → CHAIN REJECTED ("script ran,
        but verification failed")
      - Attack, skimmed amount (sender paid less, rest to fees) → CHAIN
        REJECTED ("false stack entry")
      - **Sig-less open refund ACCEPTED**:
        `878b8fc0a004f21e126ef97cc7b9d7e37fac6c3db52a174a1182637cf4103366`
        (R2-verified via REST: 99,500,000 → sender, single output, no fee
        output, 117-byte sigscript = selector+redeem only)
      - SPK stack encoding VERIFIED from rusty-kaspa v2.0.1
        `crypto/txscript/src/lib.rs` (SpkEncoding::to_bytes = 2-byte
        big-endian version || script)
      Consequence: any watcher (recipient's client, a watchtower, anyone)
      can close the F1 race window in the first post-deadline block, and
      funds can only ever go to the sender. **V2 becomes the primary escrow
      design for ASKSPEC v0.1.**
- [x] Core library (`src/lib/ask/`): protocol codec (ask/reply envelopes,
      malformed-payload validation), covenant builder (V2), claim/refund tx
      construction, connect-with-retry, firehose discovery scanner
- [x] Automated test suite: 9 unit tests (codec, covenant golden vector
      byte-for-byte vs the on-chain-proven script) + 3 integration tests
      against TN10 — **all green 2026-08-03 17:03 local**
- [x] Terminal states from automated tests (txids):
      - ANSWERED: lock `a8bee9987d9fe4d8dbcebedf10e88ff230c996a5015a980b009127112b2901a4`,
        claim `f498a6a1111834988be21d2da13a17550e11936a0f3e11d818a37a1cb7563ed6`
      - REFUNDED: lock `5c6c6cc08139c551fe246da09ea9d014d561b772bd396a538ac37c318af978a3`,
        sig-less refund `9d6d00b3fb6791be2ec3db177f98e32a7e0e9f1c4f26ec6e6362487a138f8bdd`
      - LATE-REPLY-REJECTED: post-refund claim chain-rejected in the same
        test (orphan/double-spend); pre-refund race documented as F1.
      R3 attacks all chain-rejected in-suite: wrong-key claim, no-payload
      claim, wrong-namespace claim, early refund, double-claim,
      wrong-destination refund, two-output refund, skimmed refund,
      double-refund. Partial-amount claim is impossible by UTXO semantics
      (input fully consumed) — spec documents this.
- [x] R2 dual verification in-suite: claim decoded via independent REST
      (single output to recipient, exact amount, reply payload, no fee
      outputs); refund recomputed from the consensus UTXO set via a fresh
      RPC connection (exact minRefund at sender, covenant address drained).
      Note: sender-side REST path is intermittently ECONNRESET-flaky from
      this machine; refund verification deliberately uses the UTXO set.
- [x] ASKSPEC.md v0.1 draft written from proven code (payload format,
      covenant with encoding notes + citations, lock/claim/refund
      construction, discovery, deadline semantics + normative client rules,
      error table, trust model, versioning; Q3 PENDING and Q5 placeholders
      marked). TRUST.md and TRACE.md brought current.

### R4 self-review (Phase 2 library + spec unit)

Diff reviewed against [A1-A5, C1-C3, P1-P3, P5, P6, D1, D2, D6, D9, R2, R3];
deviations:
- The claim branch does not pin outputs (recipient chooses) — deliberate,
  documented in ASKSPEC §5; partial-amount concerns are void by UTXO
  semantics (§9).
- R3 "claim after deadline" is chain-rejected only post-refund (F1) — per
  the amended D9, with normative client rules in §8. Not a hidden deviation;
  human-approved framing.
- Discovery scanner filters by namespace prefix but does not yet verify
  announcement-vs-escrow match (§4 requirement) — that check lands with the
  Phase 3 inbox (flagged so it is not forgotten).
- [x] Q3 namespace decision: `ciph_msg:1:ask:` provisional, PENDING flag in
      ASKSPEC (human decision recorded above)
- [x] **Q4 decided (human, 2026-08-03): ENCRYPTED ONLY.** kasia1 is the sole
      valid msgEnc; "plain" is malformed per ASKSPEC §2.3. Rationale: no
      footgun — privacy by construction, consistent with the encrypted
      messenger ecosystem ASK extends.
      Implementation: `src/lib/ask/crypto.ts` — byte-level reimplementation
      of Kasia's cipher (ephemeral ECDH x-coordinate → HKDF-SHA256 no-salt
      empty-info → ChaCha20-Poly1305; wire nonce‖SEC1(33)‖ct; legacy 32-byte
      ephemeral accepted). Facts verified: k256 SharedSecret = raw
      x-coordinate (docs.rs elliptic-curve SharedSecret); even-parity lift +
      wire layout from Kasia cipher/src/lib.rs. Libraries: @noble/curves,
      @noble/hashes, @noble/ciphers v2.2.0.
      **Vector honesty (per gate instruction): Kasia's repo has NO fixed
      cipher test vectors — only a randomized round-trip test
      (cipher/src/lib.rs:346-363). Our compatibility claim is structural
      (line-by-line, source-cited) + our own pinned KAT (recipient priv=1,
      ephemeral=2, zero nonce — ECDH intermediates are the standard G.x and
      2·G constants). Cross-implementation interop against Kasia-produced
      ciphertext remains UNVERIFIED and is flagged for the Kasia-team
      conversation (with Q3).**
      Tests: crypto.test.ts (round-trip via real SDK keys/addresses, parity
      immunity, legacy form, tamper/wrong-key rejection, pinned KAT);
      integration re-run fully green with encryption — on-chain ask
      decrypted with recipient key, on-chain reply decrypted with sender
      key, plaintext verified absent from payloads. New lifecycle txids:
      ANSWERED lock `1a8bb02ee6d481c024ca462ad047e32f7935e5b9dd59ecc09dec082b722c03a3`
      / claim `3f02de726903e2709368254d144c82b0d2b6d867bd9597d4455dcdb1f08b9d60`;
      REFUNDED lock `4bf4980c769516db2db1342d263c831b4b220fa38142b5d077dfa91f0949d4e7`
      / refund `0d45a744714c7123213850807ef2b85e7b8e0a0e9ce6c4fb19dd717c6a3daeb3`.

### R4 self-review (Q4 encryption unit)

Diff reviewed against [D7, D8, Q4 gate instruction, §2 payload rules];
deviations: none. `encryptKasia1Internal` (deterministic) exists solely for
the pinned KAT and is documented as test-only. protocol.ts, node.ts,
transactions.ts contain no plaintext path.
- [ ] TRUST.md current; committed + tagged phase-2

## Phase 1 results (2026-08-03, testnet-10, node rusty-kaspa 2.0.1 via public wRPC)

## Phase 1 results (2026-08-03, testnet-10, node rusty-kaspa 2.0.1 via public wRPC)

The question: can "spendable by key R with an attached reply payload, OR by
key S after deadline" be expressed and executed with current tooling?
**Answer: YES — all required behaviors demonstrated on-chain.**

The covenant (P2SH redeem script, built with `ScriptBuilder` from the
installed SDK; see `spike/lib.cjs`):

```
OpIf                                          // claim branch (selector 0x01)
  0 15 OpTxPayloadSubstr                      // payload[0..15]
  "ciph_msg:1:ask:" OpEqualVerify             // must equal ask prefix
  <R x-only pubkey> OpCheckSig                // recipient signature
OpElse                                        // refund branch (selector empty)
  <deadline DAA score> OpCheckLockTimeVerify  // Kaspa CLTV POPS its arg
  <S x-only pubkey> OpCheckSig                // sender signature
OpEndIf
```

### Lifecycle txids (all verified accepted on TN10)

| Event | txid |
|---|---|
| Lock (claimtest, 1 KAS) | `a9ad888565d4aa713a2dd7a3ca368b09f8a46e5ecb0156ebc4ac35f6227ff01c` |
| **Claim-by-reply** (atomic: spend to R + reply payload) | `7b99b73063a1cb329dfd4d32c67a458f31dfcbc7a61284ed38d4f5b1d93b959f` |
| Lock (refundtest, 1 KAS) | `200084484b331662c2a8da7139db8b006927ebce5c8cbfd058196dfb38226290` |
| **Timeout refund** (to S after deadline) | `a2ec1e9354cd7eb3242c25cc2e61c2d389ea94e842222317e114457f55672e66` |
| Lock (racetest, 1 KAS; sacrificed to document the race) | `856b4d412ec9678fe6533c51a73cd5da268c7086cc06b3b301e74cd64337d35a` |
| Late claim in race window (accepted — see finding F1) | `5d65b5a08bf28852679ed490c963d18590bb97f422aca5a9560f4d428c3f6cb2` |

### R3 attack results (chain-level, all error messages verbatim from the node)

| Attack | Result |
|---|---|
| Claim signed by wrong key (S instead of R) | **CHAIN REJECTED** — "false stack entry at end of script execution" |
| Refund before deadline | **CHAIN REJECTED** — "transaction input #0 is not finalized" |
| Claim without reply payload | **CHAIN REJECTED** — "substring [0:15] is out of bounds for string of length 0" |
| Claim after refund executed | **CHAIN REJECTED** — "is an orphan where orphan is disallowed" (UTXO consumed) |
| Claim after deadline, BEFORE refund broadcast | **ACCEPTED** — finding F1 below |

### R2 dual verification (independent recomputation from raw chain data)

Fetched via `https://api-tn10.kaspa.org/transactions/<txid>` (REST — a
different path than the wRPC used for submission):
- Claim tx: input = lock outpoint `a9ad...f01c:0` (100,000,000 sompi);
  **exactly one output**: 99,500,000 sompi → recipient address
  `kaspatest:qredz8z5x6emeypx7y08ujuylp5f8q36k66vap4ffanl847f3wmsqskc374cr`;
  payload decodes to `ciph_msg:1:ask:Yes - love the idea, let's talk next
  week!`; difference (500,000 sompi) is miner fee only. **No fee output
  exists (D2 ✓). All-or-nothing (✓).** `is_accepted: true`.
- Refund tx: input = lock outpoint `2000...6290:0` (100,000,000 sompi);
  exactly one output: 99,500,000 sompi → sender address
  `kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6`;
  no payload; no fee output. `is_accepted: true`.

### Findings

- **F1 — deadline race window (capability boundary, documented per C3/R6):**
  No Kaspa script primitive can observe the current DAA score
  (`OpTxInputDaaScore` pushes the spent UTXO's CREATION score — verified
  from rusty-kaspa v2.0.1 `crypto/txscript/src/opcodes/mod.rs:1282-1296`;
  CLTV expresses only "not before X"). Therefore the covenant cannot make
  claims EXPIRE at the deadline. What the chain enforces: after the refund
  tx consumes the UTXO, late claims are rejected as double-spends
  (demonstrated). Between deadline and refund broadcast there is a window
  where a late claim is still chain-valid (demonstrated on racetest,
  deliberately). Mitigations for Phase 2 discussion: (1) sender client
  auto-broadcasts refund at deadline; (2) make the refund branch
  ANYONE-triggerable with covenant-pinned destination+amount
  (OpTxOutputSpk/OpTxOutputAmount introspection), so any watcher can close
  the window in the first post-deadline block; (3) recipient clients refuse
  to construct late claims (A5 client-side rule). **D9's "no race" wording
  cannot be 100% chain-enforced — needs human decision on framing (R8).**
- **F2 — `createInputSignature` returns a push-encoded signature-script
  fragment** (leading length byte), not a raw signature. Discovered
  empirically ("malformed signature" rejections); handled in
  `spike/lib.cjs buildSpendSignatureScript`. Also invalidated-then-revalidated
  the wrong-key attack (its first "rejection" was for malformedness, not key
  mismatch; re-run produced the genuine "false stack entry" rejection).
- **F3 — Kaspa CLTV POPS its argument** (unlike Bitcoin's peek+OpDrop
  convention) — verified in v2.0.1 `opcodes/mod.rs:1014-1064` and confirmed
  on-chain. Kaspa CLTV also enforces threshold-class matching (DAA vs
  timestamp) between stack value and tx lockTime, and input sequence != MAX.
- **F4 — public TN10 wRPC nodes are flaky** (multiple resolver picks were
  dead); `spike/lib.cjs connect()` retries across resolver picks and
  validates synced+utxoindex. The reference client needs the same
  robustness (and false "chain rejection" classification is guarded by
  `isChainRejection` — connection failures never count as rejections).
- **F5 — TN10 DAA cadence ≈ 10 scores/second** (measured while polling:
  ~156 DAA per 15s), consistent with 10 bps. Deadline conversion for the
  client: seconds × 10, refined at Phase 2.

### R4 self-review (Phase 1 spike)

Diff reviewed against [Phase 1 a-d, C3, R3 subset, R6]; deviations: none.
Spike code is throwaway-by-design (brief), lives in `/spike`, excluded from
app build. The lock currently uses `createTransactions` (Generator) which
adds its own fee handling — fine for spike; the Phase 2 library will build
the lock explicitly.

## Phase 0 (COMPLETE — gate passed 2026-08-03)

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
