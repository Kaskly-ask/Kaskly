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
| D1 | One primitive: lock → claim-by-reply → timeout-refund | LIB, SPIKE | INT (both lifecycles) | tested |
| D2 | No fees anywhere (no fee outputs, logic, or config) | LIB (no fee code paths), .env.example (no fee vars) | INT R2 checks: single-output decode both paths | verified |
| D3 | No platform token, no hooks | nothing to build — absence maintained | — | built |
| D4 | Non-custodial; keys client-side only | LIB (keys are caller-supplied, never stored/sent) | INT (keys live only in gitignored spike/.keys.json) | built |
| D5 | Covenant-first; Plan B only via documented gate | LIB covenant.ts (V2 covenant); Plan B never needed | Phase 1 gate GREEN (human-approved) | verified |
| D6 | Kasia-compatible addressing + payload conventions | protocol.ts (ciph_msg namespace, hex payloads), node.ts (firehose discovery, x-only-from-address) | UNIT codec; INT scanner | tested |
| D7 | Reply privacy: ENCRYPTED ONLY (Q4 decided 2026-08-03) | crypto.ts (kasia1 reimplementation, source-cited); protocol.ts rejects any other msgEnc | UNIT crypto.test.ts (round-trip vs SDK keys, parity immunity, legacy form, tamper rejection, pinned KAT); INT (on-chain ask+reply decrypt round-trips) | tested |
| D8 | Asks private between sender and receiver | no feeds/directory; content always kasia1-encrypted (D7); metadata public — stated in ASKSPEC §10/TRUST.md | INT (plaintext absent from on-chain payloads) | tested |
| D9 | Amount/message/deadline; 100% refunds; late-reply framing (amended) | covenant.ts (minRefund pinning), ASKSPEC §8 client rules | INT (refund exact-amount + post-refund claim rejection); race documented (F1) | tested |
| D10 | Testnet only; covenant testnet verified | .env.example (testnet-10, never mainnet) | all INT tests run on TN10 | tested |
| D11 | Out-of-scope list enforced | IDEAS.md | — | built |

## Lifecycle (A)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| A1 | CREATE: compose + lock + payload delivery in one tx | node.ts createAsk | INT (lock + envelope round-trip) | tested |
| A2 | NOTIFY: discovery by scanning ask-namespace payloads | node.ts startAskScanner | INT (live firehose catches the lock tx) | tested |
| A3 | CLAIM-BY-REPLY: one atomic tx = spend + reply payload | transactions.ts buildClaimTransaction | INT + R2 REST decode (output/amount/payload) | verified |
| A4 | REFUND: post-deadline 100% return, anyone-triggerable | transactions.ts buildRefundTransaction (sig-less) | INT + R2 UTXO-set recomputation | verified |
| A5 | LATE REPLY: rejected at rule level + clean client state | chain side: covenant+consensus; client rule: asks-client.ts claimAsk guard + inbox deadline-passed state | INT (post-refund claim chain-rejected); UI state human-verified at gate | tested |

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
| Earned widget (chain-derived net claims) | §3.3 consistency, post-tag queue #1 | activity.tsx earnedSompi (claimNetSompi from REST spender outputs); header.tsx EarnedWidget | derives from same REST lookup as verified status derivation; visual check pending human | built |
| Status/timer precedence + resolution time (F10) | §3.2 UX | ask-card.tsx (settled → ResolvedAgo from block_time, never Countdown) | block_time field verified on real TN10 claim tx; visual check pending human | built |

## Chain layer (C)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| C1 | Pinned official WASM SDK; wRPC detection; installed types read | package.json (kaspa-wasm 2.0.1 file: pin), node.ts | INT (all chain ops via pinned SDK) | tested |
| C2 | Escrow properties (lock/claim-with-reply/timeout/no third party/no fees) | covenant.ts | INT: 9 chain-rejected attacks + lifecycle; UNIT golden vector | verified |
| C3 | Implementation honesty gate (real capabilities, cited) | PROGRESS.md ground truth + findings F1-F5, all source-cited | — | verified |
| C4 | Explorer link for every tx | ask-card.tsx ExplorerLink (lock/claim/refund on every card); config.ts explorerTxUrl | human click-through PASSED (gate 2026-08-04) | verified |
| C5 | README cold start | — | — | unstarted |

## Protocol spec (P)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| P1 | ASKSPEC self-contained / stranger-implementable | ASKSPEC.md v0.1 | stranger check at Phase 4 | built |
| P2 | Payload format, encodings, limits, covenant, semantics, errors | ASKSPEC §§1-9 | UNIT/INT enforce the documented behavior | tested |
| P3 | Explicit trust model, mirrors TRUST.md | ASKSPEC §10, TRUST.md | — | built |
| P4 | Attribution + open license (Q5) | ASKSPEC §12 placeholder | — | unstarted |
| P5 | Versioned namespace from day one | ASKSPEC §11 (+ envelope v field) | UNIT (v!=1 rejected) | tested |
| P6 | Spec updated alongside code | this phase: spec written from proven code | divergence check at each gate | built |

## Redundancy rules (R)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| R1 | Traceability maintained | TRACE.md | — | built |
| R2 | Dual verification for money | INT: REST decode (claim) + fresh-connection UTXO-set recompute (refund) | runs in-suite | verified |
| R3 | Adversarial attack suite | INT (9 chain attacks) + UNIT (malformed/oversized) + F1 race documentation | see attack table | tested |
| R4 | Self-review pass per unit | PROGRESS.md R4 entries (Phase 0, 1, 2) | — | built |
| R5 | Full suite before every commit | npm test + lint + build at each checkpoint | — | built |
| R6 | Hallucination guards; chain claims cited | PROGRESS.md ground truth; ASKSPEC inline citations | — | built |
| R7 | Session-start ritual | PROGRESS.md session log | — | built |
| R8 | Stop conditions honored | Phase gates 0/1 stopped for human; F1 escalated not decided | — | built |

## R3 adversarial attack set

| Attack | Tests | Status |
|--------|-------|--------|
| Claim without a reply payload | INT "no-payload claim" (chain-rejected) | tested |
| Claim with malformed payload | UNIT parse rejections (client layer) | tested |
| Claim with oversized payload | UNIT size-limit rejections | tested |
| Claim with wrong-namespace payload | INT "wrong-namespace claim" (chain-rejected) | tested |
| Claim by a key other than the recipient's | INT "wrong-key claim" (chain-rejected) | tested |
| Claim after the deadline | INT post-refund claim (chain-rejected); pre-refund window documented as F1 + normative client rules (ASKSPEC §8) | tested |
| Double-claim (replay) | INT "double-claim" (chain-rejected) | tested |
| Refund before the deadline | INT "early refund" (chain-rejected) | tested |
| Refund to an address other than the sender's | INT "wrong-destination refund" (chain-rejected) | tested |
| Double-refund | INT "double-refund" (chain-rejected) | tested |
| Late-reply vs. refund race at boundary | F1: demonstrated + documented; mitigation = anyone-can-trigger refund (proven) + client rules | tested |
| Partial-amount claim | impossible by UTXO semantics (input consumed whole); ASKSPEC §9 | verified |
| Unexpected extra output (refund side) | INT "two-output refund" (chain-rejected) | tested |
| Refund skimming (pay S less, rest to fees) | INT "skimmed refund" (chain-rejected) | tested |
