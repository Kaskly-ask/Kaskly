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
| D7 | Reply privacy decision (encrypted vs plaintext+warning) | msgEnc field reserved ("plain"/"kasia1") | — | unstarted (Q4 pending) |
| D8 | Asks private between sender and receiver | no feeds/directory built; payload privacy depends on Q4 | — | built (note: on-chain payloads are public unless kasia1) |
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
| A5 | LATE REPLY: rejected at rule level + clean client state | chain side: covenant+consensus; client rule: ASKSPEC §8 (UI in Phase 3) | INT (post-refund claim chain-rejected) | tested |

## Reference client screens (S) — Phase 3

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| S1 | COMPOSE screen | — | — | unstarted |
| S2 | INBOX screen | — | — | unstarted |
| S3 | SENT screen | — | — | unstarted |

## Chain layer (C)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| C1 | Pinned official WASM SDK; wRPC detection; installed types read | package.json (kaspa-wasm 2.0.1 file: pin), node.ts | INT (all chain ops via pinned SDK) | tested |
| C2 | Escrow properties (lock/claim-with-reply/timeout/no third party/no fees) | covenant.ts | INT: 9 chain-rejected attacks + lifecycle; UNIT golden vector | verified |
| C3 | Implementation honesty gate (real capabilities, cited) | PROGRESS.md ground truth + findings F1-F5, all source-cited | — | verified |
| C4 | Explorer link for every tx | .env.example (tn10.kaspa.stream, human-confirmed) | UI links in Phase 3 | built |
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
