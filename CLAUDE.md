================================================================================
CLAUDE CODE PROJECT BRIEF + BUILD LOOP (WITH REDUNDANCY)
Project: ASK — a reply-to-claim payment primitive for Kaspa,
         specified as an open Kasia protocol extension
Version: 2.0 — supersedes the DROPS 1.0 brief. Covenant-first. No fees.
================================================================================

SECTION 0 — HOW TO USE THIS DOCUMENT (note to the human)
--------------------------------------------------------------------------------
1. Save this file as CLAUDE.md in an empty project folder.
2. Open Claude Code there and say:
   "Read CLAUDE.md in full. Then execute Section 7 (Build Loop) starting
    with Phase 0. Follow the redundancy rules in Section 8 at all times."
3. Claude Code stops at every phase gate and reports. You test, then say
   "proceed" — or paste errors back.
4. Mainnet stays OFF until you deliberately flip it. The deliverable of
   this brief is a TESTNET demo + a protocol spec, pitched to the
   KaChat/Kasia teams. Mainnet is a later decision, made after that
   conversation.

SECTION 1 — WHAT WE ARE BUILDING
--------------------------------------------------------------------------------
ASK is one primitive:

    ASK = KAS locked to a message, where the recipient's REPLY is the
          claim, and silence past a deadline auto-refunds the sender.

The pitch: "Ever sent a message to someone you respect — a creator, a
founder, anyone with a flooded inbox — and watched it die unopened?
Attach KAS to it. They reply, they get the money. They don't, you get
every cent back. The only two endings are a reply or a refund."

The strategy: ASK is built as an OPEN PROTOCOL EXTENSION to Kasia
(the encrypted P2P messaging protocol on Kaspa that KaChat runs on),
plus a minimal reference client that proves it works end-to-end on
testnet. The endgame is adoption by KaChat, Kasia's own clients, and
any future client — not a standalone social app. We become
infrastructure, not a feature request.

Context that shapes everything: Kaspa's Toccata hard fork (mainnet
June 30, 2026) introduced native L1 covenants — programmable spend
rules on UTXOs. This is EXACTLY the shape ASK needs: funds spendable
by the recipient only in a transaction carrying a reply, OR refundable
to the sender after timeout. Covenant tooling is WEEKS old. That is
both the opportunity (ASK can be one of the first real covenant
applications on Kaspa) and the risk (docs are thin, SDK support may be
partial, nothing can be assumed). Section 8's honesty rules exist for
precisely this situation.

THREE DELIVERABLES, in priority order:
  DEL-1. ASKSPEC.md — the protocol extension specification. Payload
         format, covenant structure, claim/refund flows, written so ANY
         Kasia-compatible client could implement ASK from this document
         alone. This is the most important artifact.
  DEL-2. The reference client — a minimal web app proving the full
         lifecycle on testnet: send an Ask, receive it, reply-to-claim,
         timeout refund. Small on purpose. No profiles, no feeds, no
         social features.
  DEL-3. PITCH.md — a one-page summary for the KaChat/Kasia teams:
         what ASK is, link to the spec, link to the working demo,
         testnet txids of complete lifecycles, and what adopting it
         would take. Written last, from proven material only.

DROPS v1.0 material (Envelope, Boost, overlay, profiles, explore) is
NOT in this brief. It is future work, parked in IDEAS.md on day one.

SECTION 2 — LOCKED DESIGN DECISIONS (do not redesign)
--------------------------------------------------------------------------------
D1.  One primitive: lock -> claim-by-reply -> timeout-refund. No other
     modes in this brief.
D2.  NO FEES. Zero, at the protocol level, forever. No fee outputs in
     any transaction, no fee logic in any code path, no "fee address"
     in config. The model is CREDIT: the spec carries authorship, the
     reference client carries branding. Monetization ideas go to
     IDEAS.md, never into the protocol.
D3.  NO platform token. Ever. No hooks, no reservations.
D4.  Non-custodial. No user keys ever held server-side. Key handling
     happens client-side only.
D5.  COVENANT-FIRST. The escrow design targets native Toccata
     covenants. The fallback (Plan B), used ONLY if Phase 1 proves
     current tooling cannot express the covenant: pre-signed timeout-
     refund transactions created at lock time + app-cosigned claims,
     with the exact trust model documented in TRUST.md and surfaced in
     the UI. Never claim "trustless" beyond what code enforces.
D6.  KASIA-COMPATIBLE BY DESIGN. Addressing uses Kaspa addresses (and
     KNS names where trivially supported). The reply payload format
     follows Kasia's transaction-payload conventions (versioned
     namespace header, e.g. an "ask:1:" payload type — final name per
     Q3). Read Kasia's actual conventions from their repository
     (github.com/K-Kluster/Kasia); never invent them.
D7.  REPLY PRIVACY IS A GATED DECISION (Q4). Target state: replies
     encrypted with Kasia's scheme (ECDH secp256k1 + HKDF-SHA256 +
     ChaCha20-Poly1305 — verify current details from their code) so
     replies are private between sender and receiver. Acceptable v1
     fallback if the encryption integration threatens the timeline:
     plaintext reply in the claiming tx payload, with a mandatory,
     unmissable "your reply is permanent and PUBLIC on-chain" warning
     before send. Claude Code presents the tradeoff at the Phase 2
     gate; the human decides. Whichever ships, TRUST.md states it
     plainly.
D8.  Asks are PRIVATE between sender and receiver. No public feeds, no
     public inbox, no directory. (Public modes were DROPS; not here.)
D9.  Sender sets amount, message, and deadline (default 7 days).
     Refunds are always 100%. Post-deadline replies must be cleanly
     rejected — no race where a late reply takes already-refundable
     funds. Exact deadline semantics (DAA score vs. timestamp) are
     defined in ASKSPEC.md from real chain capabilities.
D10. Testnet ONLY for this entire brief. Which testnet (TN10/TN12/
     other) is verified in Phase 0 from current Kaspa docs — whichever
     currently carries the post-Toccata covenant feature set. Mainnet
     is out of scope until a future, explicit human decision.
D11. Out of scope (log to IDEAS.md, do not build): fees/monetization,
     Envelope/Boost/overlay modes, profiles and social features,
     recurring payments, multi-token support, mobile native apps,
     custodial anything, fiat on-ramps, minimum-ask filters,
     "claimable inbox for people not yet on the app".

SECTION 3 — SPECIFICATION
--------------------------------------------------------------------------------
3.1 THE ASK LIFECYCLE (normative; ASKSPEC.md formalizes this)
  A1. CREATE: sender composes message + amount + deadline. Funds lock
      under the ASK spend rules. The Ask message is delivered to the
      recipient's address as a Kasia-convention payload (encrypted per
      Kasia's scheme — the ask itself should be private in transit,
      same as any Kasia message; verify feasibility in Phase 1).
  A2. NOTIFY: recipient's client discovers the Ask by scanning for the
      ask-namespace payload addressed to them (same discovery pattern
      Kasia clients already use — read their code for the mechanism).
  A3. CLAIM-BY-REPLY: recipient types a reply and hits send. The
      client constructs ONE transaction that (a) spends the locked
      funds to the recipient and (b) carries the reply payload. Send-
      ing the reply IS claiming the money. Atomic: no state where the
      funds move without a reply, or a reply is delivered while funds
      stay locked.
  A4. REFUND: deadline passes with no valid claim -> 100% of funds
      return to the sender. Under covenants this should be sender-
      triggerable (or anyone-triggerable to sender's address) with no
      third party able to block or take it. Under Plan B, the pre-
      signed refund tx is broadcastable by the sender.
  A5. LATE REPLY: any claim attempt after the deadline fails at the
      rule level (covenant rejects it / refund path has priority).
      The client must also refuse to construct it, with a clear
      "deadline passed — funds have been returned" state.

3.2 REFERENCE CLIENT (deliberately minimal — 3 screens)
  S1. COMPOSE: recipient address (or KNS name), message, amount KAS,
      deadline picker (default 7 days), a loud TESTNET badge, and an
      honesty line stating exactly what is enforced on-chain (sourced
      from TRUST.md). No fee line — there are no fees.
  S2. INBOX (receiver view): list of Asks addressed to the connected
      wallet, each showing message, amount, countdown. Opening one
      shows the reply box and the send-to-claim button. If D7 lands on
      plaintext: the permanence warning appears HERE, unmissable,
      before send.
  S3. SENT (sender view): list of sent Asks with live status
      [awaiting reply | answered (+ the reply) | refunded], countdown,
      and an explorer link for every referenced transaction.
  Wallet: connect via signature-based ownership proof; local key
  generation for testing is fine (testnet only). Per D4, keys never
  touch a server.

3.3 DATA MODEL (thin by design — chain is the source of truth)
  The app database is an INDEX/CACHE, never an authority. Every
  status shown in the UI must be derivable from chain state, and the
  test suite must include a "rebuild from chain" check proving the DB
  can be dropped and reconstructed.
  asks (id, ask_ref, sender_address, recipient_address,
        amount_kas, message_ciphertext_or_text, deadline,
        lock_txid, claim_txid NULLABLE, refund_txid NULLABLE,
        status ENUM[open, answered, refunded, expired_pending_refund],
        created_at)
  No users table, no balances table. Nothing stored that the chain
  contradicts wins over the chain.

3.4 CHAIN LAYER
  C1. Official rusty-kaspa WASM SDK, version pinned. Detection of
      Asks, claims, and refunds via wRPC subscription. If an API is
      uncertain, READ THE INSTALLED PACKAGE TYPES. Never guess names.
  C2. Required escrow properties (covenant or Plan B):
        - funds lock at creation with sender refund path recorded;
        - claim requires a transaction signed by the RECIPIENT that
          carries the reply payload;
        - timeout path returns ALL funds to sender;
        - no third party (including this app's operator) has a
          unilateral spend path;
        - no fee outputs anywhere (D2).
  C3. IMPLEMENTATION HONESTY GATE: the covenant design is derived from
      the REAL, current, installed SDK and the REAL post-Toccata
      script/covenant capabilities — read shipped types, official
      docs, rusty-kaspa source, and Kasia source. Training-data memory
      of Kaspa capabilities is presumed stale (Toccata is newer than
      most of it). If the covenant cannot be expressed with current
      tooling, invoke Plan B (D5) — with the trust model written into
      TRUST.md and shown in the UI — and record in PROGRESS.md exactly
      which capability was missing, so the covenant path can be
      revisited when tooling matures.
  C4. Every lock/claim/refund transaction links to a public explorer
      from the UI.
  C5. README covers cold start: node/endpoint setup, current testnet
      selection, faucet steps, env config.

SECTION 4 — TECH STACK
--------------------------------------------------------------------------------
  T1. Next.js (App Router) + TypeScript + Tailwind.
  T2. SQLite via Prisma (dev), repository layer, Postgres-swappable.
      (Remember 3.3: the DB is a cache, not an authority.)
  T3. Official rusty-kaspa WASM SDK, version pinned in package.json.
  T4. .env config: node endpoint, network (DEFAULT: current covenant
      testnet, per D10), toggles. No fee address (D2). Never default
      mainnet.
  T5. Kasia repository vendored or referenced read-only for payload
      conventions and (if D7 goes encrypted) the encryption scheme.
      Their license is respected and attributed.

SECTION 5 — DESIGN DIRECTION
--------------------------------------------------------------------------------
  Dark near-black UI, Kaspa teal (#49EACB family) as the single
  accent. The Ask card is the hero: message-first, amount as a bold
  tabular figure, countdown always visible. The reply box should feel
  like replying to a message, not filling a crypto form — the money
  mechanics stay quiet until they matter. Honesty labels (TESTNET
  badge, trust-model line, permanence warning if applicable) always
  visible, always calm. No purple-gradient AI-template look. This is
  a small, sharp demo — every screen should be screenshot-ready for
  the pitch.

SECTION 6 — THE PROTOCOL SPEC (ASKSPEC.md requirements)
--------------------------------------------------------------------------------
  P1. Self-contained: a competent developer with no access to this
      repo implements an interoperable ASK client from ASKSPEC.md
      alone.
  P2. Defines: payload namespace + versioning (per D6), field
      encodings, size limits, the covenant/script template (or Plan B
      transaction set), deadline semantics, claim construction,
      refund construction, discovery/scanning procedure, error and
      edge-case behavior (late reply, double-claim attempt, malformed
      payload).
  P3. States the trust model explicitly — what the chain enforces vs.
      what clients enforce vs. what requires trusting nothing/someone.
      Mirrors TRUST.md.
  P4. Carries authorship attribution and an open license (human picks
      the license — Q5).
  P5. Versioned from day one (ask:1:). Breaking changes bump the
      version; the spec says so.
  P6. Written and updated ALONGSIDE the implementation, not after it.
      Any divergence between spec and code found at a phase gate is a
      defect.

SECTION 7 — THE BUILD LOOP
--------------------------------------------------------------------------------
  L1. FILES FIRST. Create/update at every session start:
        PROGRESS.md — phase, checklists [ ]/[x], last session's
                      changes, next steps, open questions.
        TRUST.md    — plain-language map of what the chain enforces
                      vs. what requires trusting the app. Updated with
                      any escrow change. Readable by a non-developer.
        TRACE.md    — the redundancy backbone. A table mapping EVERY
                      spec ID (D1..D11, A1..A5, S1..S3, C1..C5,
                      P1..P6, R1..R8) to implementing files, covering
                      tests, and status [unstarted|built|tested|
                      verified].
        IDEAS.md    — parking lot. Seed it on day one with the DROPS
                      v1.0 material (Envelope, Boost, overlay) and the
                      D11 list.
        ASKSPEC.md  — per Section 6, grown from Phase 1 onward.
  L2. SMALL UNITS. Smallest testable increment; run it; verify; only
      then continue. Never stack untested features.
  L3. PHASE GATES. A phase is complete only when every acceptance
      criterion in Section 9 demonstrably passes (show command output
      or describe the manual check). Then STOP and report. Never start
      the next phase without explicit human approval.
  L4. ERROR PROTOCOL. Read the full error, hypothesize, fix, re-run.
      After 3 failed attempts on the same error: STOP, write it up in
      PROGRESS.md (error, attempts, hypotheses, options), ask the
      human.
  L5. COMMITS. Git commit at every green checkpoint; tag at every
      phase gate (phase-0, phase-1, ...). Never commit secrets or
      funded private keys.
  L6. SCOPE GUARD. Anything drifting toward D11 goes to IDEAS.md, not
      into code.

SECTION 8 — REDUNDANCY RULES (mistake-prevention machinery)
--------------------------------------------------------------------------------
  R1. TRACEABILITY. No feature is "done" until TRACE.md shows spec ID
      -> implementation files -> tests -> verified. If a spec ID has
      no test, it is not done. If code exists that maps to no spec ID,
      flag it in PROGRESS.md (scope creep or missing spec — the human
      decides).
  R2. DUAL VERIFICATION FOR MONEY. Every money-touching behavior is
      verified TWO independent ways before its checkbox turns green:
      (a) an automated test, and (b) an independent recomputation from
      raw chain state (explorer or direct RPC: decode the actual
      testnet transactions and confirm amounts, outputs, and absence
      of any fee output). One source of truth never grades itself.
  R3. ADVERSARIAL TESTS REQUIRED. For every money path, tests that
      actively try to break it before it is called done. Minimum
      attack set:
        - claim without a reply payload;
        - claim with a malformed/oversized/wrong-namespace payload;
        - claim by a key other than the recipient's;
        - claim after the deadline;
        - double-claim (replay the claim tx / second reply);
        - refund before the deadline;
        - refund to an address other than the sender's;
        - double-refund;
        - late-reply vs. refund race around the deadline boundary;
        - partial-amount claim (must be all-or-nothing);
        - any transaction containing an unexpected extra output.
      Every attack must FAIL in the suite, and each gets a TRACE.md
      row.
  R4. SELF-REVIEW PASS. After each unit, re-read the diff against the
      exact spec IDs it implements and state in PROGRESS.md: "Diff
      reviewed against [IDs]; deviations: none / listed." A deviation
      without a note is a defect.
  R5. REGRESSION GATE. The FULL suite runs before every commit. Any
      red test blocks the commit and blocks phase progression. No
      skipped tests without a PROGRESS.md entry explaining why and
      when they return.
  R6. HALLUCINATION GUARDS — ELEVATED. Toccata covenants are newer
      than the training data; Kasia conventions are niche. Therefore:
      NEVER fabricate an SDK API, covenant opcode, script capability,
      Kasia field name, or passing result. Unknown = read the
      installed package types, the rusty-kaspa source, the Kasia
      source, or official docs — or stub behind an interface marked
      // UNVERIFIED-STUB and flag in PROGRESS.md. A stub is
      acceptable; an invention is not. Every chain-capability claim
      in ASKSPEC.md or TRUST.md must cite where it was verified
      (file/type/doc).
  R7. SESSION-START RITUAL. Every session begins: (1) read PROGRESS.md
      and TRACE.md, (2) run the full suite, (3) confirm green or fix
      before any new work. Never build on an unverified base.
  R8. STOP CONDITIONS. Stop and ask the human whenever: spec is
      ambiguous; a locked decision seems wrong; the SDK/covenant
      layer cannot express a required behavior (this triggers the
      Plan B decision — human approves the switch); any test around
      money fails for unclear reasons; anything requires weakening
      TRUST.md; or the Kasia repo's conventions conflict with an
      assumption in this brief. Guessing at any of these is
      prohibited.

SECTION 9 — PHASED BUILD PLAN (each ends at a human gate)
--------------------------------------------------------------------------------
PHASE 0 — SCAFFOLD + GROUND TRUTH
  Build: Next.js + TS + Tailwind + Prisma scaffold; schema 3.3; the
  five .md files initialized (TRACE.md pre-populated with every spec
  ID, all [unstarted]; IDEAS.md seeded per L1). Then GROUND TRUTH
  gathering, written into PROGRESS.md with sources:
    - install + pin the current rusty-kaspa WASM SDK; enumerate what
      its types actually expose for script/covenant construction;
    - identify the correct current testnet for covenant features
      (D10) and record node/faucet endpoints;
    - clone/read Kasia; document their payload namespace format,
      encryption scheme, and discovery mechanism AS IMPLEMENTED.
  Accept: app boots; DB migrates; all .md files exist and are
  complete; ground-truth notes written with sources cited; committed
  + tagged phase-0.

PHASE 1 — COVENANT FEASIBILITY SPIKE (the load-bearing question)
  No app features. One question: CAN the ASK spend rules be expressed
  and executed with current tooling?
  Build: throwaway-quality scripts (kept in /spike, excluded from the
  app) that attempt, on the covenant testnet:
    (a) lock KAS under a rule approximating "spendable by key R with
        an attached payload, OR by key S after deadline";
    (b) execute the claim path;
    (c) execute the timeout path;
    (d) attempt at least two R3 attacks (claim after deadline; claim
        by wrong key) and confirm the CHAIN rejects them.
  Every capability finding — positive or negative — is recorded in
  PROGRESS.md with the exact type/doc/source that proves it.
  Accept (one of two outcomes, both acceptable):
    GREEN: all four demonstrated with testnet txids recorded ->
      covenant path confirmed; draft the covenant section of
      ASKSPEC.md; STOP for human review of the architecture.
    AMBER: a specific, documented capability gap -> present the gap,
      the evidence, and the Plan B design (pre-signed refunds +
      cosigned claims) with its exact trust model; STOP; the human
      approves Plan B or pauses the project. (Per R8, this decision
      is never made unilaterally.)

PHASE 2 — PROTOCOL SPEC + CORE LIFECYCLE
  GATE FIRST: human has approved the Phase 1 architecture.
  Build: ASKSPEC.md v0.1 (payload format per D6, lifecycle A1-A5,
  chosen escrow design); the real implementation of lock, claim-by-
  reply, and refund as a clean library (no UI yet); the D7 decision
  point — present encrypted-vs-plaintext replies with effort
  estimates; human decides; implement the chosen one.
  Accept: full lifecycle A1-A5 runs from automated tests against
  testnet; all three terminal states (answered / refunded / late-
  reply-rejected) demonstrated with txids recorded in PROGRESS.md;
  R2 dual verification on every amount (no fee outputs — verified
  from raw tx data); R3 full attack set green; ASKSPEC.md matches
  the code (P6); TRUST.md current.

PHASE 3 — REFERENCE CLIENT
  Build: screens S1-S3 wired to the Phase 2 library; wallet connect
  per 3.2; explorer links per C4; countdown + status states; the
  "rebuild from chain" check per 3.3; input hardening (message size
  limits per spec, XSS-inert rendering of replies).
  Accept: a human completes the full loop on testnet between two
  real wallets/devices: send an Ask -> see it in the inbox -> reply
  -> funds arrive + reply delivered; separately, an ignored Ask
  refunds at deadline; a post-deadline reply attempt shows the clean
  rejection state; script-injection text in a message/reply renders
  inert; TRACE.md rows for S1-S3 verified.

PHASE 4 — PITCH PACKAGE
  Build: PITCH.md (one page: problem, mechanic, spec link, demo
  link, lifecycle txids, "what adopting this takes" for a Kasia
  client, attribution/license per Q5); README polished to stranger-
  clonable (C5); empty/loading/error states; a 2-3 minute demo
  script (literally the steps to perform live) written into
  PITCH.md; repository cleaned for public eyes.
  Accept: human dry-runs the demo script start-to-finish with no
  dead ends; a fresh clone by the human following only the README
  reaches a working state; full suite green; TRACE.md 100% verified;
  zero unmapped code. This is the artifact set you take back to the
  KaChat dev.

SECTION 10 — QUESTIONS FOR THE HUMAN (never assume)
--------------------------------------------------------------------------------
  Q1. Anything the KaChat dev already told you about covenant
      specifics, Kasia payload plans, or preferred integration shape
      — paste it into PROGRESS.md before Phase 1; it may save days.
  Q2. Phase 1 outcome approval: covenant architecture (GREEN) or
      Plan B switch (AMBER). Mandatory gate.
  Q3. Final protocol namespace + name ("ask:1:" is the placeholder)
      — before ASKSPEC.md v0.1 freezes in Phase 2.
  Q4. D7 decision: encrypted replies vs. plaintext-with-warning for
      v1 — at the Phase 2 decision point.
  Q5. Open-source license + attribution text for ASKSPEC.md and the
      repo — before Phase 4.
  Q6. Anything ambiguous anywhere: ask, do not guess.

SECTION 11 — DEFINITION OF DONE (this brief)
--------------------------------------------------------------------------------
  [ ] Every phase gate passed and human-approved.
  [ ] TRACE.md: 100% of spec IDs at [verified]; zero unmapped code.
  [ ] Full adversarial suite (R3) green, including the deadline-race
      and wrong-key attacks, all rejected BY THE CHAIN where the
      architecture allows.
  [ ] All three lifecycle txid sets recorded (answered / refunded /
      late-reply-rejected).
  [ ] Zero fee outputs, provably: asserted in tests AND verified from
      raw transaction data (R2).
  [ ] TRUST.md accurate, current, readable by a non-developer, and
      mirrored in ASKSPEC.md's trust-model section.
  [ ] ASKSPEC.md implementable by a stranger (P1) and consistent with
      the shipped code (P6).
  [ ] README cold-start verified by a fresh clone.
  [ ] PITCH.md complete with live demo script. Mainnet untouched.
================================================================================
END OF BRIEF — read fully, then begin Phase 0 per Section 7.
================================================================================
