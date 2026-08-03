# PROGRESS — ASK Protocol

## Current phase

**Phase 0 — Scaffold + Ground Truth** (in progress)

## Phase 0 checklist

- [x] Git repository initialized (`main` branch)
- [x] Five tracking files created (PROGRESS, TRUST, TRACE, IDEAS, ASKSPEC skeleton)
- [ ] Ground truth: Toccata covenant capabilities researched, sources cited (research in progress)
- [ ] Ground truth: correct covenant testnet identified + node/faucet endpoints recorded (research in progress)
- [ ] Ground truth: Kasia payload namespace / encryption / discovery documented from their repo (research in progress)
- [ ] Next.js + TypeScript + Tailwind scaffold (**blocked: waiting for user to install Node.js**)
- [ ] Prisma + SQLite with schema per brief §3.3
- [ ] rusty-kaspa WASM SDK installed, version pinned, exposed script/covenant types enumerated from the installed package
- [ ] App boots; DB migrates
- [ ] Committed + tagged `phase-0`

## Session log

### 2026-08-03 — Session 1

- Read CLAUDE.md brief in full; began Phase 0.
- `git init` (branch `main`).
- Discovered Node.js is not installed on this machine. Per user instruction, the user is installing Node themselves from nodejs.org; scaffold resumes when they confirm.
- Launched two ground-truth research tasks (results to be recorded below with sources when complete):
  1. Kaspa: Toccata status, real covenant capabilities, current covenant testnet + endpoints/faucet, official WASM SDK package + version, timelock semantics, explorer.
  2. Kasia (github.com/K-Kluster/Kasia): payload namespace format, encryption scheme, discovery mechanism, tx mechanics, size limits, license, KNS support.
- Created PROGRESS.md, TRUST.md, TRACE.md (all spec IDs pre-populated, `unstarted`), IDEAS.md (seeded with DROPS v1.0 parking-lot items + D11 list), ASKSPEC.md skeleton.

## Ground truth (to be filled from research — every claim must carry a source, per R6)

### Kaspa / Toccata / covenants

_Pending research results._

### Testnet selection (D10)

_Pending research results._

### WASM SDK

_Pending research results. Version pin + type enumeration additionally requires local install (blocked on Node)._

### Kasia conventions (D6, D7)

_Pending research results._

## Open questions for the human (Section 10)

- Q1: Anything the KaChat dev already shared about covenant specifics / Kasia payload plans / preferred integration shape? Paste here before Phase 1.
- Q3: Final protocol namespace + name (placeholder `ask:1:`) — needed before ASKSPEC.md v0.1 freezes in Phase 2.
- Q4: D7 reply privacy decision — deferred to Phase 2 gate.
- Q5: Open-source license + attribution — needed before Phase 4.

## Blockers

- Node.js installation (user is handling; scaffold + SDK type enumeration wait on this).
