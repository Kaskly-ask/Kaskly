# TRACE — Spec ID → implementation → tests → status

_The redundancy backbone (brief §8 R1). No feature is done until its row
shows implementation files, covering tests, and `verified`. Code that maps
to no spec ID gets flagged in PROGRESS.md._

Status values: `unstarted` | `built` | `tested` | `verified`
(`verified` = automated test PLUS independent recomputation from raw chain
state, per R2, where money is involved.)

Abbreviations: LIB = `src/lib/ask/*`; UNIT = `tests/unit/*`;
INT = `tests/integration/lifecycle.test.ts`; SPIKE = `spike/*` (throwaway,
evidence recorded in PROGRESS.md).

## Locked design decisions (D)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| D1 | One primitive: lock → claim-by-reply → timeout-refund | LIB, SPIKE | INT (both lifecycles); human gate e2e + prod beta incl. witnessed prod refund (2026-08-04) | verified |
| D2 | No fees anywhere (no fee outputs, logic, or config) | LIB (no fee code paths), .env.example (no fee vars) | INT R2 checks: single-output decode both paths | verified |
| D3 | No platform token, no hooks | nothing to build — absence maintained | absence re-audited at phase-4 close (no token/hook code anywhere; repo public) | verified |
| D4 | Non-custodial; keys client-side only | LIB (keys are caller-supplied, never stored/sent) | INT; phase-4 server-surface audit: sole API route accepts the public cache DTO only — no key, signing, or tx-construction path server-side | verified |
| D5 | Covenant-first; Plan B only via documented gate | LIB covenant.ts (V2 covenant); Plan B never needed | Phase 1 gate GREEN (human-approved) | verified |
| D6 | Kasia-compatible addressing + payload conventions | protocol.ts (ciph_msg namespace, hex payloads), node.ts (firehose discovery, x-only-from-address) | UNIT codec; INT scanner; independent third party: tn10.kaspa.stream parses ASK claims natively in its Kasia panel (msg_type: ask). Namespace finalization = documented exception (Q3, Kasia team) | verified |
| D7 | Reply privacy: ENCRYPTED ONLY (Q4 decided 2026-08-03) | crypto.ts (kasia1 reimplementation, source-cited); protocol.ts rejects any other msgEnc | UNIT crypto.test.ts (round-trip vs SDK keys, parity immunity, legacy form, tamper rejection, pinned KAT); INT decrypts from raw on-chain data (independent). Kasia-vector interop = documented exception (needs their ciphertext) | verified |
| D8 | Asks private between sender and receiver | no feeds/directory; content always kasia1-encrypted (D7); metadata public — stated in ASKSPEC §10/TRUST.md | INT (plaintext absent from on-chain payloads — independent chain recompute) | verified |
| D9 | Amount/message/deadline; 100% refunds; late-reply framing (amended) | covenant.ts (minRefund pinning), ASKSPEC §8 client rules | INT (refund exact-amount R2-recomputed + post-refund claim rejection); race documented (F1); refund witnessed live on prod (2026-08-04) | verified |
| D10 | Testnet only; covenant testnet verified | .env.example (testnet-10, never mainnet); config.ts boot guard refuses non-testnet | all INT tests run on TN10; cold-start log boots testnet-10 defaults; guard throws at build on any other value | verified |
| D11 | Out-of-scope list enforced | IDEAS.md | phase-4 scope audit: no D11 feature present in code | verified |

## Lifecycle (A)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| A1 | CREATE: compose + lock + payload delivery in one tx | node.ts createAsk | INT (lock + envelope round-trip); live prod beta usage (2026-08-04) | verified |
| A2 | NOTIFY: discovery by scanning ask-namespace payloads | node.ts startAskScanner | INT (live firehose catches the lock tx); prod inbox delivery observed in beta | verified |
| A3 | CLAIM-BY-REPLY: one atomic tx = spend + reply payload | transactions.ts buildClaimTransaction | INT + R2 REST decode (output/amount/payload) | verified |
| A4 | REFUND: post-deadline 100% return, anyone-triggerable | transactions.ts buildRefundTransaction (sig-less) | INT + R2 UTXO-set recomputation | verified |
| A5 | LATE REPLY: rejected at rule level + clean client state | chain side: covenant+consensus; client rule: asks-client.ts claimAsk guard + inbox deadline-passed state | INT (post-refund claim chain-rejected — independent double-spend rejection); UI refusal state human-verified at gate + beta | verified |

## Reference client screens (S) — Phase 3

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| S1 | COMPOSE screen (address/KNS, message, amount, deadline picker 7d default, TESTNET badge, honesty line, no fee line) | src/app/page.tsx; kns.ts (KNS shape verified from Kasia source); asks-client.ts sendAsk | build+lint green; human end-to-end PASSED (gate 2026-08-04) | verified |
| S2 | INBOX screen (list, countdown, reply-to-claim; §4 escrow verification REQUIRED before display + visible badge; late-claim refusal + clean deadline-passed state) | src/app/inbox/page.tsx; use-asks.ts/activity.tsx (firehose + deriveStatusFromChain §4 gate); asks-client.ts claimAsk (DeadlinePassedError) | INT rebuild (§4 predicate); human end-to-end PASSED incl. late-reply refusal (gate 2026-08-04) | verified |
| S3 | SENT screen (status states, countdown, explorer links, decrypted replies, rebuild-from-chain action) | src/app/sent/page.tsx; use-asks.ts; rebuild.ts | INT rebuild.test.ts; human end-to-end PASSED incl. observed refund (gate 2026-08-04) | verified |

### Phase 3 client infrastructure (maps to §3.2/§3.3/§8 client rules)

| Item | Spec basis | Implementation | Tests | Status |
|------|-----------|----------------|-------|--------|
| Wallet: browser-only keys + signature ownership proof | §3.2, D4 | src/lib/wallet.tsx (signMessage/verifyMessage) | human connect flow PASSED (gate 2026-08-04) | verified |
| DB as cache + rebuild-from-chain | §3.3 | src/lib/repo.ts, api/asks route, src/lib/rebuild.ts | UNIT rebuild.test.ts (classifier, malformed skipped); INT rebuild.test.ts GREEN on TN10 (answered + refunded lifecycles reconstructed, exact txids, both roles); human gate PASSED | verified |
| Auto-refund at deadline (normative rule 1) | §8, D9 | activity.tsx effect → asks-client.ts maybeAutoRefund (both roles, app-wide) | covenant path proven Phase 2; refund OBSERVED live by human (gate 2026-08-04) | verified |
| Refuse late claim construction (normative rule 2) | §8, A5, D9 | asks-client.ts claimAsk guard; inbox deadline-passed state | guard precedes any tx construction; refusal observed by human (gate 2026-08-04) | verified |
| XSS-inert rendering + size limits | Phase 3 accept, §9 | React text nodes only (no dangerouslySetInnerHTML, grep-verified); MAX_MESSAGE_BYTES (byte-accurate, F6) at textarea+lib+codec | UNIT codec size tests; human script-injection check PASSED (gate) | verified |
| Mass-scaled claim fees (F7) | §5.2 | transactions.ts quoteClaimFee (SDK calculateTransactionFee, iterated, floored); asks-client estimateReplyClaim (UI quote) | UNIT fees.test.ts; INT fees.test.ts GREEN on TN10 (near-limit reply accepted, exact net recomputed from consensus UTXO set — R2 dual); human gate PASSED | verified |
| Activity awareness (F8) | §3.2 UX, §8 rule 1 app-wide | activity.tsx provider (badges, title count, seen-state); header UnreadBadge | human check PASSED (gate 2026-08-04) | verified |
| Hide/unhide settled cards (F9) | §3.2 UX | use-hidden.ts; HiddenSection; settled-only rule in pages | human check PASSED (gate 2026-08-04) | verified |
| Earned widget (chain-derived net claims) | §3.3 consistency, post-tag queue #1 | activity.tsx earnedSompi (claimNetSompi from REST spender outputs); header.tsx EarnedWidget | derives from same REST lookup as verified status derivation; human visual confirmation during beta (2026-08-04) | verified |
| Status/timer precedence + resolution time (F10) | §3.2 UX | ask-card.tsx (settled → ResolvedAgo from block_time, never Countdown) | block_time field verified on real TN10 claim tx; human visual confirmation during beta (2026-08-04) | verified |
| Share cards + QR (launch prep) | §3.2 UX | src/components/share-ask.tsx; src/lib/share-card.ts | human QR scan end-to-end PASSED during beta (2026-08-04) | verified |
| PWA shell (manifest, SW, install prompt) | §3.2 UX | public/sw.js; public/manifest.webmanifest; src/components/pwa-setup.tsx | SW never caches /api/* or money state (code rule, sw.js); human install + Add-to-Home-Screen pass on Android + iOS during beta (2026-08-04) | verified |
| Local contact names | §3.2 UX; TRUST.md ("contact names are yours alone") | src/lib/contacts.ts; src/components/contact-name.tsx | browser-local only (never sent — grep: no network path); human beta usage | verified |

## Chain layer (C)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| C1 | Pinned official WASM SDK; wRPC detection; installed types read | package.json (kaspa-wasm 2.0.1 file: pin), node.ts | INT (all chain ops via pinned SDK); pin re-confirmed on fresh clone (cold-start log: vendored SDK, no external download) | verified |
| C2 | Escrow properties (lock/claim-with-reply/timeout/no third party/no fees) | covenant.ts | INT: 9 chain-rejected attacks + lifecycle; UNIT golden vector | verified |
| C3 | Implementation honesty gate (real capabilities, cited) | PROGRESS.md ground truth + findings F1-F5, all source-cited | — | verified |
| C4 | Explorer link for every tx | ask-card.tsx ExplorerLink (lock/claim/refund on every card); config.ts explorerTxUrl | human click-through PASSED (gate 2026-08-04) | verified |
| C5 | README cold start | README.md (clone → install → env → generate → migrate → dev; faucet steps; integration-test key setup; testnet-only) | logged verbatim fresh-clone run (delegated by human, 2026-08-04): first run FAILED (missing `npx prisma generate` — /api/asks crashed), README fixed, pristine re-clone RUN 3 PASSED end-to-end (boot proven: server Ready + listening socket + DB-touching API 200, 26/26 unit); RUN 4 re-proved it on a clone of the pushed tag reading the README from the clone itself (clean `git status`); logs at audit/coldstart-log.txt (+ per-run server outputs) | verified |

## Protocol spec (P)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| P1 | ASKSPEC self-contained / stranger-implementable | ASKSPEC.md v0.1 | DOCUMENTED EXCEPTION at phase-4: the true stranger check is delegated to the audit-v1 external review package (owner: human; return path: first external reviewer's report) | built |
| P2 | Payload format, encodings, limits, covenant, semantics, errors | ASKSPEC §§1-9 | UNIT/INT enforce the documented behavior; phase-4 divergence check: no protocol-surface code change since the phase-3 consistency check | verified |
| P3 | Explicit trust model, mirrors TRUST.md | ASKSPEC §10, TRUST.md | side-by-side mirror check at phase-4 close: chain-enforced list, F1 caveat, content-encrypted/metadata-public, no third-party spend path all consistent | verified |
| P4 | Attribution + open license (Q5: ISC, © The Kaskly project — human decision 2026-08-04) | LICENSE; ASKSPEC §12; README; PITCH.md | — | verified |
| P5 | Versioned namespace from day one | ASKSPEC §11 (+ envelope v field) | UNIT (v!=1 rejected); INT envelopes on-chain carry v=1 (independent) | verified |
| P6 | Spec updated alongside code | this phase: spec written from proven code | divergence checks passed at phase-2, phase-3, and phase-4 gates (phase-4 delta was docs-only) | verified |

## Redundancy rules (R)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| R1 | Traceability maintained | TRACE.md | phase-4 closure pass: unmapped-code sweep added rows for share cards/PWA/contacts; zero unmapped code remains | verified |
| R2 | Dual verification for money | INT: REST decode (claim) + fresh-connection UTXO-set recompute (refund) | runs in-suite | verified |
| R3 | Adversarial attack suite | INT (9 chain attacks) + UNIT (malformed/oversized) + F1 race documentation | see attack table; chain-rejected attacks re-proven every INT run with R2 final-state recompute; two client-layer rows carry documented notes | verified |
| R4 | Self-review pass per unit | PROGRESS.md R4 entries (Phases 0-4) | phase-4 entry present | verified |
| R5 | Full suite before every commit | npm test + lint + build at each checkpoint; full gate incl. INT at phase tags | phase-4 gate outputs recorded in PROGRESS | verified |
| R6 | Hallucination guards; chain claims cited | PROGRESS.md ground truth; ASKSPEC inline citations | citation audit at phase-4: UNVERIFIED items tracked explicitly (payload ceiling, interop) — none silently asserted | verified |
| R7 | Session-start ritual | PROGRESS.md session log | ritual performed every session incl. phase-4 close (26/26 green before work) | verified |
| R8 | Stop conditions honored | Phase gates 0-4 stopped for human; F1 escalated not decided; mainnet decisions gated on human answers (2026-08-04) | — | verified |

## Covenant V3 (F12/F22/F13/F21/F20) — IN PROGRESS, NOT PROVEN

| Item | Spec basis | Implementation | Tests | Status |
|------|-----------|----------------|-------|--------|
| V3 redeem script | COVENANT-V3-DESIGN.md | src/lib/ask/covenant-v3.ts (V2 covenant.ts untouched — in-flight Asks stay readable) | authored only; NOT proven | built |
| F12 refund input pinning | design §1 | covenant-v3.ts refund branch (OpTxInputCount==1) | probe 07 must flip CONFIRMED→REFUTED against V3 | unstarted |
| F12/F13/F21 floor from input amount | design §1,§3,§4 | covenant-v3.ts floor sequence | opcode sequence byte-identical to spike 11b Q4, which was chain-proven (below-floor rejected / above-floor accepted, 27f38aeb…); V3-level proof pending campaign | built |
| F22 askId binding (M1) | design §2 | covenant-v3.ts claim branch | new probe 08 (cross-Ask claim) | unstarted |
| **GATE: OpTxPayloadLen behaviour** | design §0, §2 | covenant-v3.ts length guard | spike 11c GATE PASS 2026-08-04 (control passed; guard alone: 49 rejected / 51 accepted; real offsets: 17 and 49 rejected, wrong askId rejected, correct 50-byte accepted 0c5da1bd…) | verified |
| F20 measured DAA rate | design §5 | client-side, not authored yet | probe 10 | unstarted |
| F14 client status classification | design §2, F14 | not authored yet — REQUIRED alongside V3 | unit + probe | unstarted |

**Enforcement:** the authoring GATE above is now `verified` (spike 11c).
No tag may include `src/lib/ask/covenant-v3.ts` until the remaining
`unstarted` rows are `verified` via the re-proof campaign (design §9):
probe 07 flipping CONFIRMED→REFUTED against this exact script, cross-Ask
probe 08, floor probe 09 (incl. the 0.1 KAS refusal), DAA probe 10, the
full R3 suite green against V3, and a regenerated golden vector. The
F14 client fix ships with it or neither is complete.

## R3 adversarial attack set

| Attack | Tests | Status |
|--------|-------|--------|
| Claim without a reply payload | INT "no-payload claim" (chain-rejected; re-proven every run) | verified |
| Claim with malformed payload | UNIT parse rejections (client layer — chain checks only the 15-byte prefix by design, ASKSPEC §10; sender-side status display for prefix-valid/garbage-body claims is a phase-4 hardening item) | tested |
| Claim with oversized payload | UNIT size-limit rejections (client layer; consensus payload ceiling still UNVERIFIED — tracked) | tested |
| Claim with wrong-namespace payload | INT "wrong-namespace claim" (chain-rejected; re-proven every run) | verified |
| Claim by a key other than the recipient's | INT "wrong-key claim" (chain-rejected; re-proven every run) | verified |
| Claim after the deadline | INT post-refund claim (chain-rejected as double-spend); pre-refund window documented as F1 + normative client rules (ASKSPEC §8) | verified |
| Double-claim (replay) | INT "double-claim" (chain-rejected; re-proven every run) | verified |
| Refund before the deadline | INT "early refund" (chain-rejected; re-proven every run) | verified |
| Refund to an address other than the sender's | INT "wrong-destination refund" (chain-rejected; re-proven every run) | verified |
| Double-refund | INT "double-refund" (chain-rejected; re-proven every run) | verified |
| Late-reply vs. refund race at boundary | F1: demonstrated + documented; mitigation = anyone-can-trigger refund (open-refund txids recorded) + client rules; refund observed live on prod (2026-08-04) | verified |
| Partial-amount claim | impossible by UTXO semantics (input consumed whole); ASKSPEC §9 | verified |
| Unexpected extra output (refund side) | INT "two-output refund" (chain-rejected; re-proven every run) | verified |
| Refund skimming (pay S less, rest to fees) | INT "skimmed refund" (chain-rejected; re-proven every run) | verified |
