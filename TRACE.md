# TRACE — Spec ID → implementation → tests → status

_The redundancy backbone (brief §8 R1). No feature is done until its row
shows implementation files, covering tests, and `verified`. Code that maps
to no spec ID gets flagged in PROGRESS.md._

Status values: `unstarted` | `built` | `tested` | `verified`

## Locked design decisions (D)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| D1 | One primitive: lock → claim-by-reply → timeout-refund | — | — | unstarted |
| D2 | No fees anywhere (no fee outputs, logic, or config) | — | — | unstarted |
| D3 | No platform token, no hooks | — | — | unstarted |
| D4 | Non-custodial; keys client-side only | — | — | unstarted |
| D5 | Covenant-first; Plan B only via documented gate | — | — | unstarted |
| D6 | Kasia-compatible addressing + payload conventions | — | — | unstarted |
| D7 | Reply privacy decision (encrypted vs plaintext+warning) | — | — | unstarted |
| D8 | Asks private between sender and receiver | — | — | unstarted |
| D9 | Sender sets amount/message/deadline; 100% refunds; late replies rejected | — | — | unstarted |
| D10 | Testnet only; correct covenant testnet verified | — | — | unstarted |
| D11 | Out-of-scope list enforced (parked in IDEAS.md) | IDEAS.md | — | built |

## Lifecycle (A)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| A1 | CREATE: compose + lock + Kasia-convention delivery | — | — | unstarted |
| A2 | NOTIFY: discovery by scanning ask-namespace payloads | — | — | unstarted |
| A3 | CLAIM-BY-REPLY: one atomic tx = spend + reply payload | — | — | unstarted |
| A4 | REFUND: post-deadline 100% return, sender-triggerable | — | — | unstarted |
| A5 | LATE REPLY: rejected at rule level + clean client state | — | — | unstarted |

## Reference client screens (S)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| S1 | COMPOSE screen (address/KNS, message, amount, deadline, TESTNET badge, honesty line) | — | — | unstarted |
| S2 | INBOX screen (list, countdown, reply-to-claim, permanence warning if plaintext) | — | — | unstarted |
| S3 | SENT screen (status states, countdown, explorer links) | — | — | unstarted |

## Chain layer (C)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| C1 | Pinned official WASM SDK; wRPC detection; read installed types, never guess | — | — | unstarted |
| C2 | Escrow properties (lock/claim-with-reply/timeout/no third party/no fees) | — | — | unstarted |
| C3 | Implementation honesty gate (real capabilities, cited; Plan B trigger documented) | — | — | unstarted |
| C4 | Explorer link for every lock/claim/refund tx | — | — | unstarted |
| C5 | README cold start (node, testnet, faucet, env) | — | — | unstarted |

## Protocol spec (P)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| P1 | ASKSPEC.md self-contained / stranger-implementable | — | — | unstarted |
| P2 | Payload format, encodings, limits, covenant template, semantics, errors | — | — | unstarted |
| P3 | Explicit trust model, mirrors TRUST.md | — | — | unstarted |
| P4 | Attribution + open license (Q5) | — | — | unstarted |
| P5 | Versioned namespace from day one (ask:1:) | — | — | unstarted |
| P6 | Spec updated alongside code; divergence = defect | — | — | unstarted |

## Redundancy rules (R)

| ID | Summary | Implementation | Tests | Status |
|----|---------|----------------|-------|--------|
| R1 | Traceability maintained in this file | TRACE.md | — | built |
| R2 | Dual verification for money (test + raw chain recomputation) | — | — | unstarted |
| R3 | Full adversarial attack suite (11 attacks minimum) | — | — | unstarted |
| R4 | Self-review pass per unit, recorded in PROGRESS.md | — | — | unstarted |
| R5 | Full suite before every commit; red blocks progress | — | — | unstarted |
| R6 | Hallucination guards; every chain claim cited | — | — | unstarted |
| R7 | Session-start ritual (read files, run suite, confirm green) | — | — | unstarted |
| R8 | Stop conditions honored (ask, never guess) | — | — | unstarted |

## R3 adversarial attack set (each gets its own row when built)

| Attack | Tests | Status |
|--------|-------|--------|
| Claim without a reply payload | — | unstarted |
| Claim with malformed/oversized/wrong-namespace payload | — | unstarted |
| Claim by a key other than the recipient's | — | unstarted |
| Claim after the deadline | — | unstarted |
| Double-claim (replay / second reply) | — | unstarted |
| Refund before the deadline | — | unstarted |
| Refund to a non-sender address | — | unstarted |
| Double-refund | — | unstarted |
| Late-reply vs refund race at deadline boundary | — | unstarted |
| Partial-amount claim (must be all-or-nothing) | — | unstarted |
| Unexpected extra output in any tx | — | unstarted |
