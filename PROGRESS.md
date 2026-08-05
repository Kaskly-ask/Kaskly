# PROGRESS — ASK Protocol

## Current phase

**Phase 4 — PITCH PACKAGE + TESTNET BETA (scope amended by the human,
2026-08-04). Beta prep BUILD COMPLETE; awaiting human-led deployment
(DEPLOY.md steps) + the Phase 4 gate (demo dry-run + fresh clone). The
public-launch material (PITCH.md — already written) is SEQUENCED AFTER
beta feedback.**

### V3 WIRING MIGRATION — Phase 2 complete (2026-08-05)

Phase 2 connected the three remaining spend/quote sites, plus rebuild, to
the version resolved in Phase 1. Commits: `69d928a`/`028a9f7` (RED),
`8b7ccce` (GREEN), `9cdd131` (RED), `1dc10e6` (GREEN).

**The mechanism.** `CovenantView` now carries `protocolVersion` — the
version TRIAL RECONSTRUCTION resolved against the funded address. Every
call site branches on that, never on `record.protocolVersion`, which is a
cache-writable hint (F18). `claimAsk` and `maybeAutoRefund` each build the
funding oracle from their own RPC handle, memoised, so resolution costs
nothing beyond the UTXO lookup they already performed.

**How routing was proven — and why the obvious test would not have.** A
test that supplies the oracle itself and calls `buildClaimTransactionV3`
proves the BUILDER. It says nothing about whether `claimAsk` reaches it —
exactly the gap Phase 1 shipped with (a resolver no production caller
invoked, unit-green throughout). `tests/unit/v3-routing-real-path.test.ts`
therefore calls the REAL exported `claimAsk`/`maybeAutoRefund` against a
fake node that funds exactly ONE P2SH, and asserts on the transaction that
arrives at `submitTransaction`. Nothing about the covenant choice is
supplied by the test.

**Committed failing first, and re-verified after a fixture defect.** The
first RED run was partly red for the WRONG reason: `covenantFor` memoises
by `askRef` and every record in the file shared one, so the V2 control was
deciding the V3 cases — indistinguishable from a routing failure. Fixed
with distinct lock txids (`028a9f7`) and the RED state re-taken. Attributed
failures against the pre-wiring source:

| assertion | pre-wiring failure | mechanism |
|---|---|---|
| V3 claim header | `expected false to be true` | V2 builder, wrong payload header |
| V3 claim (lied version) | `no longer claimable` | resolution followed the field, queried an unfunded address |
| V3 refund pricing | `expected 99678400 to be greater than 99678400` | V2 builder paid EXACTLY the covenant floor |
| V3 refund (lied version) | `expected null not to be null` | no-op against the wrong address |

**The refund discriminator (worth recording).** "Above the floor" does not
distinguish the builders — both produce script-valid refunds. What
separates them is where in the band they land. Measured for a 1 KAS Ask at
a live-magnitude deadline: the V2 builder pays `input - allowance` =
99,678,400 exactly, surrendering the whole allowance to the miner (F21);
the V3 builder solves the fee against the sig script it actually emits (A1)
and pays 99,920,300. A STRICT inequality against the floor can only be
satisfied by the V3 builder. 241,900 sompi of the sender's money is the
observable difference.

**rebuild-from-chain was the quiet one.** `scanHistory` only ever called
the V2 parser. The V3 announce header `ciph_msg:1:ask:a2:` extends the V2
namespace prefix, so a V3 payload passed the prefix filter, reached a
parser that did not understand it, and was skipped by the malformed-payload
`catch` — silently. After the wiring that meant every Ask the client
creates was invisible to rebuild: drop the cache and the sender's own open
Asks, still holding money, do not come back. Brief §3.3 promises the DB can
be dropped. Fixed with `parseEither` (V3 first, V2 fallback) and
`candidateFromEnvelopeV3`.

**Deliberate exception.** `estimateReplyClaim` (asks-client.ts:532) is the
one site that still calls `covenantFor` WITHOUT an oracle. It is offline by
contract (no RPC parameter) and produces a fee preview only. A lied version
can mis-price the preview; it cannot move money, because `claimAsk`
re-resolves against the chain before it builds. Documented in place.

**Gate:** lint clean, build clean, 109/109 unit across 17 files.

**NOT closed by this work.** OPEN-POST-WIRING (OPW-1..4) remain open — the
server/cache-layer pass is separate. And Phase 2 is NOT the live proof: no
chain transaction has been broadcast under V3 through the shipping client.
That is Phase 3, and `hardened-v1` stays unhanded until it passes.

### OPW-1 CLOSED — the displayed message is now chain-anchored (2026-08-05)

Every other record field is anchored by construction: sender, recipient,
deadline, amount, askId and refundAllowance are covenant inputs, so
changing one changes the P2SH and trial reconstruction fails closed.
`messageCiphertext` is not a covenant input — the single unanchored field,
and the one the human reads. With `/api/asks` unauthenticated (F18) anyone
knowing a real askRef could swap it and keep the "✓ escrowed" badge lit;
because `encryptKasia1` is a public-key operation over an address-derived
key, the substitute decrypts cleanly to attacker-chosen text.

Fix: check it against the lock transaction's announcement payload.
Mismatch ⇒ `verified: false`. A read failure THROWS rather than
unverifying — "could not check" is not "checked and bad", the same rule as
OPW-4; otherwise one flaky request would hide legitimate Asks and their
money. Memoised per lockTxid (mined payloads are immutable) so it is one
read per Ask per session, not a per-cycle round trip. Prefers the address
history already fetched, which is usually free.

RED at `9a01ce2`: 3 failed / 2 passed. The forged-message cases failed with
"expected true to be false"; the could-not-check case failed with "promise
resolved { verified: true } instead of rejecting" — diagnostic in itself,
since today no read happens at all on that path.

**Residual, recorded not buried:** the anchor reads from the REST indexer,
as wRPC has no historical transaction lookup. Message integrity therefore
moves from "anyone who can POST" to "the indexer operator". Strictly
smaller attacker set, not zero — that remainder is OPW-2.

Gate: lint clean, build clean, 121/121 unit, live suite 11/11 (`c3b9190f`
V3 lock / `a625c14b` V3 refund / `4b12b63d` V2 lock / `0e7e94f2` V2 refund).

### OPW-4 CLOSED — transient node error no longer strands a refund (2026-08-05)

Taken FIRST of the four, ahead of OPW-1, on the human's call: OPW-4 is the
regression the migration ACTIVATED. Before the wiring the client created V2
Asks whose refunds it rarely executed; now V3 is live and auto-refunds
actually fire, so the path this silenced is precisely the stranded-refund
recovery it exists to perform. Money-recovery regression before deception.

**The bug.** `maybeAutoRefund` returns `string | null`, and `null` carried
two incompatible meanings — "already closed, stop" and "broadcast failed,
retry". `isChainRejection` collapsed them by matching the bare substring
`"RPC Server (remote error)"`, which every remote failure carries.
`activity.tsx` marks the ask attempted BEFORE awaiting and un-marks only in
`catch`; `null` does not throw. One dropped socket therefore suppressed
auto-refund for the whole session, leaving the sender's money locked.

**Why the fix is not "narrow the substring".** Exactly ONE real rejection
string is in evidence — the racing-watcher conflict observed in the Phase 3
run ("output (…) already spent by transaction … in the mempool"). Writing
the others from memory would be inventing consensus behaviour (R6). So the
message is not consulted at all: after a failed submit the CHAIN is
re-read. Escrow gone → terminal, return null. Still funded → the
transaction did not land, throw. A node too broken to answer the re-read
also throws, which is the right reading when nothing is known.

**Bounded, deliberately.** A competing refund sitting in the mempool still
shows the UTXO as unspent, so this retries for the seconds until that
transaction is accepted, then stops. A completed refund cannot retry
forever — asserted as a control, not assumed.

**Both directions proven** (`tests/unit/opw4-refund-retry.test.ts`, RED at
`aec0464`, 2 failed / 5 passed, failing with "promise resolved null instead
of rejecting"):
- FIX: a transient error throws while the escrow is still funded; repeated
  failures do not latch, and the refund completes once the node recovers.
- CONTROL: healthy refund returns its txid; an escrow already gone returns
  null with zero broadcasts; the REAL Phase 3 conflict string returns null;
  a completed refund stays completed on a second pass (one submit total).
- A source-shape check pins the caller's half of the contract — the effect
  marks before awaiting and un-marks only in `catch`.

**Gate:** lint clean, build clean, 116/116 unit, and the live suite re-run
as a regression gate — 11/11 again, new txids `4ffa5a30…` (V3 lock) /
`49aeea19…` (V3 refund) / `7814e481…` (V2 lock) / `1603f48c…` (V2 refund).
The change touches only the catch path, which the green Phase 3 run never
entered, so the live re-run is what proves no regression on the success
path rather than the unit suite.

### V3 WIRING MIGRATION — Phase 3 GREEN, live on chain (2026-08-05)

`tests/integration/shipped-path-v3.test.ts` — 11/11 green on testnet-10.
The first chain broadcasts of this session, and the first proof that the
hardened covenant is reachable by a user.

**What makes it a proof of the WIRING and not of the builders.** The file
calls only `sendAsk` / `claimAsk` / `maybeAutoRefund` /
`deriveStatusFromChain`. It derives no covenant, imports no `*V3` builder,
and never chooses a version. `lifecycle-v3.test.ts` already proved the
builders on chain; this proves the browser can reach them.

**Anti-fixture compliance.** Node DAA at run time: **535,375,350** — nine
digits, asserted in `beforeAll` rather than assumed. Deadlines are live
offsets (+50,000 DAA claimable, +700 refundable). Amounts are 1 TKAS really
locked and really returned. The golden vector's `deadlineDaa = 1_000_000`
appears nowhere in the file.

| stage | txid |
|---|---|
| V3 lock via `sendAsk` | `84f4adcf94961f92cd1e0f8473f96c6a17c2d606a46c85805597972dadd973c8` |
| V3 claim via `claimAsk` | `9b2c3cc965078a83802cd674c7744ee19fee572f9e27c778d59d9da795568c0a` |
| V3 lock, ignored | `dfdf6ab63be292814918712c327da0b7affe0a7c46ccf7f7cf92ce0e00b51ad3` |
| V3 refund via `maybeAutoRefund` | `fc1fa643cdc0e8da46e3195df8f09a73568f1e90df6d5b6a2c973534912f57bb` |
| V2 lock, pre-migration shape | `d183fdc5dd4f3efb3638b5068dbd576871685f72c083f375290410b864bf9ec8` |
| V2 claim through migrated client | `9d9bf0b85bfa6dbfb15f52399947ba0c739b0fa18c36548e69c67a852070ef89` |
| V2 lock, ignored | `3fe3478c07c064fb5919a532150e19958a32d13cbbd14231dd3634ca9f4c0037` |
| V2 refund through migrated client | `bef822edc3f512060a55932b9afd3bf5b1f2ff51e190859d89786851413547f1` |

**F21, closed on live money.** Both Asks locked exactly 100,000,000 sompi;
both refunds are a single output to the sender, R2-verified from the REST
indexer (independent of the wRPC node the client used):
V3 → **99,920,300** (solved fee 79,700). V2 → **99,500,000** (exactly
`input − 500,000`, the fixed floor, whole allowance to the miner). A 6.3×
fee difference, from the shipped path, on chain.

**The V2 half is the point of the migration.** It locks an Ask in the
pre-migration shape — a record with NO `protocolVersion` field, which is
what cache rows written before today actually look like — and carries it
through claim and refund on the migrated client. Both settled. Funds locked
under V2 on the public deploy are not orphaned.

#### First run FAILED, and the attribution mattered

Run 1: Half 1 green (8/8), Half 2 red (3). Not a routing failure:

- The V2 claim fired 471ms after its lock broadcast and hit "no covenant
  version reproduces a funded address" — trial reconstruction correctly
  refusing to guess against an unconfirmed escrow. Looks identical to a
  routing failure; is not one.
- The second V2 lock was rejected as a double spend: `(4ca8a2ff…, 1)`
  "already spent by `dc09a471` **in the mempool**" — while a lock sits in
  the mempool the node still lists the outputs it spends, so the next lock
  from the same wallet picks one.
- The third failure reported `verified: true` with status `open` — which
  is V2 resolution WORKING and correctly reporting that no claim happened.

Fix was to the HARNESS only (`waitVerified`, confirmation before each
dependent action). No product behaviour was adjusted to make a test pass.
Recorded here because a red run that gets re-run until green, without
attribution, is how a real defect gets laundered into a flake.

**Process note.** Vitest swallows stdout on a PASSING run, so the green
run's txids were only recoverable by re-querying the indexer for both
addresses and matching on `block_time`. The suite now writes
`phase3-txids.json` (gitignored) in `afterAll`, which survives either
outcome.

**Ledger updated.** `audit/KNOWN-AND-CLOSED.md`: F12, F13, F21, F22 and the
cross-version claim move FIXED-BUT-UNREACHABLE → **FIXED**. The 🔴
CORRECTION block is left standing with a RESOLVED subsection appended —
deleting it would remove the record of the error.

**Still open:** OPW-1..4 (server/cache/REST-verdict layers). No tag cut.

### R4 self-review (V3 wiring Phase 2)

Diff reviewed against D6, A3, A4, C2, §3.3, F13, F18, F21, F22. Deviations:
one, declared above (`estimateReplyClaim` offline hint path). The
`?? ""` / `?? "0"` defaults I first wrote for `askIdHex` and
`refundAllowance` were replaced with explicit throws: unreachable by
construction (`deriveV3` refuses such records), but a silent default there
would have built a claim whose askId does not match the covenant and left
the recipient watching it be rejected.

### Deploy findings (kaskly.onrender.com, 2026-08-05) — both fixed

- **B1 — BLOCKER: production minification broke SDK class checks.**
  Deployed site showed the connection banner with "object constructor
  `ed` does not match expected class `Resolver`". Root cause: the WASM
  side casts JS objects by reading `constructor.name` and comparing
  STRINGS (the JS glue's `_assertClass` uses instanceof — this check
  lives in the wasm binary and is not configurable); production
  minification renames classes (dev doesn't, hence the split). Fix:
  after wasm init, `ensureKaspaReady` restores every exported class's
  runtime `.name` from its export key (`Object.defineProperty` — export
  names survive minification). Verified on a LOCAL production build
  (`npm run build && npm start`, per the human's debugging instruction)
  with the real wallet: no banner, statuses settle, balance loads.
- **B2 — key-import UX.** Raw pastes from JSON files (quotes, commas,
  whitespace, 0x) reached `new PrivateKey()` and surfaced "Secp256k1 ->
  malformed or out-of-range secret key" — env-agnostic input problem,
  not a deploy problem (wallet generation + signature proof confirmed
  working in prod by the human). Fix: `sanitizeKeyInput` strips
  decoration (never key material), live format check disables Import
  until 64-hex, calm inline hint shows the cleaned length and notes
  quotes/spaces are auto-removed, and the library error is replaced by
  a friendly message. Verified in the prod build end-to-end: garbage
  shows the hint with Import disabled; the funded key pasted as
  `  "<key>",  ` imports successfully.

- **B3 — wasm "magic word" report (2026-08-05): NOT a missing asset;
  transient rollout window.** Human saw "expected magic word 00 61 73 6d,
  found 3c 21 44 4f" (= "<!DO", an HTML 404) on the deployed site and
  suspected the gitignored vendor path was absent on Render. Facts
  gathered before fixing: the wasm IS in the remote tree
  (vendor/web/kaspa/kaspa_bg.wasm, 11,511,494 bytes — only the public/
  COPY is gitignored, and copy-wasm.mjs throws loudly if its committed
  source were missing); the deployed URL was serving correct
  `application/wasm` with proper magic bytes by the time of checking;
  and a full in-browser check of kaskly.onrender.com passed (throwaway
  wallet created, signature proof shown, balance resolved via live wRPC
  → B1 fix CONFIRMED HOLDING in the deployed minified build; dev
  deadline chip confirmed absent in production). Conclusion: the human
  hit the deploy's mid-rollout window (or a cached 404 from it).
  Hardening shipped anyway: the wasm is fetched with a fixed version
  query (`?v=2.0.1`) so any browser-cached HTML-404 for the bare path
  can never wedge a client after recovery.

- **B4 — prod-soak deadline floor override (human requirement,
  2026-08-05).** `NEXT_PUBLIC_BETA_MIN_DEADLINE_SECONDS` (1..3599)
  lowers the client deadline floor ON PRODUCTION BUILDS — env-gated,
  deliberately NOT NODE_ENV-gated — adding one warn-styled "(soak
  test)" chip at exactly the floor value; absent → 1-hour floor, zero
  UI trace. Point-4 analysis recorded honestly: the chain accepts any
  deadline, so the floor is CLIENT policy and the browser (where the
  covenant is constructed) is the only enforcement point — the flag is
  baked at build time (Render rebuilds on env change) and the picker
  options + new pre-send floor validation read the same constant, so
  they cannot diverge. Dev builds keep their 2-min chip via a matching
  dev default floor. DEPLOY.md gained the removal requirement and a
  full PRE-BETA CHECKLIST (removal of this var is item 1, with a
  verify step). Verified on a local production build with the flag set
  (chip present, send validated) and without (no trace).

### Marketing homepage (human-directed build, 2026-08-05)

Root route is now a landing page selling Kaskly to a stranger; the
composer moved to **/ask** (nav + all internal links updated; every app
route unchanged otherwise). Structure per the human's spec: pain-hook
hero (with the REAL AskCard component as hero art — mock data, ticking
countdown, ✓ escrowed badge), three-card How-it-works with the
covenant honesty line, two-audience Why-it-matters, "Good for you. Good
for Kaspa." win-win section, trust strip (non-custodial / encrypted /
auto-refunds / open spec ISC / TESTNET badge with the "real money mode
comes after it survives testing" line), identity footer with repo link
marked "public soon". CTA to /ask from every section. Same design
language and voice throughout; mobile-responsive by construction
(single column, sm: grid collapse, no fixed widths).

**One deliberate copy deviation, FLAGGED for the human:** the directed
section-4 line "recipients don't need a wallet — one is created
in-browser the moment they reply" describes the parked question-board
flow, not the shipped product (an Ask is addressed TO an address, so
the recipient creates their two-click wallet BEFORE they can be asked).
Written truthfully instead as: "doesn't need to be in crypto — a wallet
is two clicks in a browser, no exchange, no purchase… KAS they earned,
not bought." Human may veto/adjust.

### B5 — mobile horizontal overflow, launch-blocking (human, real-device
report + evidence, 2026-08-05; FIXED and measured)

Symptom: page-wide horizontal scroll on phones — connect-wallet off-
screen right; scrolling right slid the centered hero off the LEFT edge
(document wider than viewport). Root cause: fixed-position background
layers CANNOT widen a document and all content containers are max-w
constrained — the one culprit was the HEADER'S NON-WRAPPING FLEX ROW,
whose overflow extends the document scroll width. Fixes:
1. Header row is now `flex-wrap` with compressed mobile spacing — a
   wrapping row is STRUCTURALLY unable to widen the document; on narrow
   screens the TESTNET badge + wallet chip wrap to a second right-
   aligned line, immediately visible without any scrolling (TESTNET
   stays visible at every width — honesty rule).
2. Backstop on html/body: `overflow-x: clip` (hidden fallback) — the
   page is literally unable to scroll sideways even if a future wide
   element regresses. Deliberately does NOT mask detection: scrollWidth
   still reports offenders, which the audit uses.
3. Wallet panel mobile pass: address/balance/action rows wrap; long
   values break; share block already fluid.
Verification (iframe-constrained real layout viewports, prod build):
/, /ask, /inbox, /sent at BOTH 390px and 360px → scrollWidth ==
clientWidth on every route (zero overflow), including with the wallet
panel OPEN and the share preview rendered at 390px. Deployed for the
human's real-phone confirmation.

### PWA (human-directed, 2026-08-05)

kaskly.app is installable: web app manifest (standalone, near-black
theme, 192/512/maskable icons), hand-written service worker with the
honest cache strategy — app shell + hashed assets + the 11.5 MB wasm
cache-first (verified: second wasm fetch 18ms), navigations
network-first with cache fallback, and **money state never cached by
construction** (/api/* untouched — verified absent from cache after a
live fetch; cross-origin chain/REST/KNS traffic passes through). SW
registers in production builds only. Install prompt handled gracefully:
beforeinstallprompt → quiet footer "Install Kaskly as an app" link
(Chromium); iOS documented honestly in BETA.md (manual Add to Home
Screen, NO push on any platform, and the iOS-specific trap: installed-
app storage is SEPARATE from Safari — create the wallet in the surface
you'll use). Icons are brand-direction PLACEHOLDERS (teal ĸ bubble on
near-black, generated by scripts/gen-icons.mjs via sharp) until the
external brand assets land. Verified on the prod build: manifest linked
+ valid, apple meta tags present, SW registered/active, cache contents
exactly as designed. Real-device A2HS test (Android + iOS, full-screen
branded launch) = the human's device pass on the deployed origin.

### Pre-flip public-eyes pass (2026-08-05, before the repo goes public)

1. Secrets audit #3 (full history, paths AND values, both funded keys):
   CLEAN — no key values in any commit, no sensitive paths ever tracked.
2. IDEAS split: strategic/unbuilt roadmap (DROPS material, crowd
   question board, KaChat-integration framings) moved to gitignored
   PRIVATE-IDEAS.md; public IDEAS.md keeps shipped/generic entries with
   a discreet "some roadmap is maintained privately" note.
3. Stranger pass over every .md. Redactions at HEAD: the Q1 private
   conversation is now a neutral paraphrase (no verbatim quote, no
   attribution, no strategic framing); the LAN IP scrubbed.
   **History-residue RULING (human, 2026-08-05, after reviewing the
   exact verbatim contents and the commits containing them): ACCEPT the
   residual — NO history rewrite.** Rationale, recorded: the quote is
   benign (favorable, professional, no personal content), and the
   immutable audit trail — unbroken tags, verifiable txid evidence,
   honest process history — is worth more than scrubbing it. What
   history retains, eyes-open: the Q1 quote + attribution (all commits
   `2708b1a`..`0392135`, incl. all phase tags), the DROPS one-liner
   list (same span), and the crowd-question-board idea (~a dozen
   commits, `48a9a81`..`0392135`, no tags). HEAD carries none of it.
4. README brought current post-deploy: kaskly.app is the live app, not
   a "target"; cold-start commands re-checked against the Render build
   (same steps).
5. Trust links in-product: app footer gains "open source — verify every
   claim" → the repo; landing footer label drops "public soon". Links
   404 until the flip — flip promptly after deploy.

### B6 regression — scrim swallowed inside-panel clicks (human, launch-
blocking, 2026-08-05; FIXED + full matrix verified before push)

Cause: scrim (z-30) and panel (z-auto) are siblings inside the sticky
header's stacking context — the scrim stacked OVER the panel content
and intercepted every inside click (copy, download, share, the X).
Fix: panel lifted to z-40 within the shared context (one class). Full
matrix verified on the prod build, per instruction, BEFORE pushing:
(1) copy inside → stays open, and "copied!" flips on a REAL click (the
scripted run's only miss was synthetic clicks lacking user activation
for the clipboard — a test artifact, documented); (2) download → stays
open (PNG saved); (3) inline contact edit inside panel → input appears,
stays open; (4) outside/scrim click → closes; (5) Escape → closes;
(6) X → closes; (7) navigate → closes, inbox visible. Other overlays:
none exist (B6 audit) — the scrim pattern lives only here.

### Local contacts / wallet naming (pre-beta QoL, human-promoted from
real usage, 2026-08-05)

Full scope shipped (nothing ballooned): (1) browser-private address→name
map (`kaskly.contacts.v1`, useSyncExternalStore-backed so every surface
updates live; same privacy model as keys — never transmitted, no
protocol change); (2) inline naming everywhere addresses render — quiet
✎ on inbox/sent cards and under the composer recipient; feels like
naming a chat (inline input, Enter saves, empty deletes); (3) display:
name leads, truncated address stays visible beside it in muted mono —
NEVER hidden (payments app, identity stays verifiable); landing mock
card exempted from the affordance; (4) contacts list in the wallet
panel with inline edit, delete, and an "ask →" prefilled-composer
shortcut; (5) composer bonus via native datalist — typing matches saved
names, picking fills the address; (6) BETA.md + TRUST.md notes
(browser-only, like keys). Verified end-to-end on the prod build
(scripted): card ✎ → name saved → renders with address → appears in
composer datalist + panel list with shortcut — 7/7 assertions green.

### B6 — stale wallet panel across navigation, all viewports (human,
real-device + desktop, 2026-08-05; FIXED + verified both)

The panel persisted across route changes (full-screen on mobile → app
reads frozen). Fixes: (1) the panel is now SUBORDINATE TO THE ROUTE —
a pathname-keyed effect closes it on any navigation (tabs, links,
back/forward); (2) standard overlay conventions: scrim (tap outside
closes), Escape closes, and a visible ✕ at the panel's top corner (the
bottom "Close" falls below the fold once the share block renders);
(3) overlay AUDIT — WalletPanel was the only floating overlay in the
app (HiddenSection is an in-page details element that unmounts with
its route; the connection banner is in-flow status by design) — the
class dies with the instance. Verified with scripted flows: 390px
iframe (panel open → Inbox tap → closed + inbox visible) and desktop
(open → Escape ✓ → scrim ✓ → route change ✓), all assertions green on
the production build.

### B5 follow-up — deliberate mobile header (human-approved from
screenshots, 2026-08-05)

The wrapped second row read as a desktop leftover; replaced with a
COMPOSED two-row mobile header: row 1 = wordmark + compact right cluster
(TESTNET chip + solid teal "Connect" when disconnected / address chip
alone when connected); row 2 = Ask/Inbox/Sent as a full-width segmented
tab row with a teal active underline and unread badges. Desktop (sm+)
unchanged from the approved single-row layout. TESTNET visible at every
width; overflow-x clip backstop retained. Verified: zero overflow on all
routes at 390px AND 360px (iframe-constrained viewports, prod build);
three states screenshot-reviewed and approved by the human before push.

### Share copy revision — final workshopped versions (human, 2026-08-05)

Card CTA replaced with: "Ask me anything — an answer, or your money
back. Guaranteed by on-chain math." (hook line rendered in teal;
sub-lines kept). All three paste-ready posts replaced with the
workshopped set, in the human's order. **Tone rationale (recorded per
instruction): the posts are excited-share energy, not solicitation —
the refund guarantee is the emotional center, and "guaranteed by
on-chain math" is the recurring hook line.** Noted, no action this
pass: "Guaranteed by on-chain math" is a candidate reusable tagline
element (e.g. landing page).

### DNS milestone (human report, 2026-08-05)

**kaskly.app is LIVE with valid TLS** — the DNS switch happened before
the share card shipped. Follow-up (human suggestion, adopted): share
artifacts now hard-code the CANONICAL origin (`https://kaskly.app`,
overridable via `NEXT_PUBLIC_CANONICAL_ORIGIN`) instead of reading the
current origin — a card, copied link, or post text can never bake a
localhost/staging URL no matter where it was generated. The earlier
"regenerate after DNS switch" caveat is now void.

### Share card + QR (pre-beta feature, promoted from IDEAS 2026-08-05)

Wallet-only scope (profiles remain future). Shipped: canvas-rendered
1200×675 PNG share card (client-side only, no server render) in the
app's exact visual system — near-black, teal glows, covenant-hex
texture, clear-glass panel, wordmark + "Just Ask Me", CTA line,
truncated address as visual confirmation only, SOLID TESTNET tag
(honesty never translucent), QR on a white tile for scanner contrast.
The QR encodes an ASK LINK (`<origin>/ask?to=<address>`), never a raw
address; the composer learned `?to=` prefill (never clobbers typed
input). Wallet panel gained the "Share your Ask link" block: live card
preview, Download, copy-my-Ask-link, and three paste-ready post texts
with copy buttons. One new dependency: `qrcode` (node-qrcode,
maintained). Note: the link uses the CURRENT origin — cards downloaded
during beta carry the beta URL; regenerate after the kaskly.app DNS
switch.

### Phase 4 scope amendment — Discord testnet beta (human, 2026-08-04)

Beta with the Kaspa Discord community BEFORE public launch; the app
must be deployed and reachable first. This SUPERSEDES the earlier
"deployment/DNS is a later step, do not build deploy config now"
instruction (recorded under identity assets). Delivered:

1. **DEPLOY.md** — recommendation: a persistent Node host (Render or
   Railway) running `next start` with a disk, NOT Vercel/CF Pages yet
   (SQLite cache needs a writable disk; the Postgres swap is designed-
   for but deferred to public launch). Build/start commands, full env
   table (with the NEXT_PUBLIC-baked-at-build warning), and the exact
   human Cloudflare DNS steps for kaskly.app (CNAME apex via
   flattening, grey-cloud until TLS issues, DNSSEC independent).
2. **Feedback path** — recommendation: the Discord beta thread (testers
   are already there; no dependency on flipping the repo public).
   Footer "report a bug" link driven by `NEXT_PUBLIC_FEEDBACK_URL`
   (hidden when unset).
3. **BETA.md** — copy-paste Discord blurb + full onboarding: wallet
   creation (browser-only keys warning), faucet, what to try, what to
   try to break, honest known-limitations list from TRUST.md, reporting
   guidance.
4. **Abuse-proofing sanity check** — four findings fixed, all of the
   "twenty strangers, one hour, shared server" class:
   - `DELETE /api/asks` wiped EVERYONE's cache (any tester's rebuild
     would grief all others) → now address-scoped
     (`clearAsksForAddress`), UI passes the wallet address;
   - cache-write fields were unbounded (100 MB ciphertext / 500-digit
     amount = DB bloat + BigInt-overflow 500s) → hard caps in
     `validateAskRecord` (ciphertext 61-16,384 bytes hex, amount ≤ 20
     digits, deadline ≤ 12 digits, address shape regex), unit-tested;
   - Sent rendered rows the chain doesn't back (Inbox filtered, Sent
     didn't — junk records targeted at a tester's address would linger)
     → Sent now filters failed verification too;
   - reviewed and left alone: open GET by address (public chain data
     only, by design), per-browser wallets, dev deadline chip (build-
     time eliminated in production), fee-exceeds-amount guard (F7).

### Phase 4 build (started on human go after glass acceptance, 2026-08-04)

- **Q5 DECIDED (human): ISC license** (matches Kasia — ecosystem
  signal), attribution **"The Kaskly project"** (kaskly.app /
  kaskly.kas). Landed in LICENSE, ASKSPEC §12, README, PITCH.md.
- **PITCH.md** written from proven material only: mechanic, six
  clickable TN10 evidence txids (answered pair, refunded pair, V2
  covenant-hardening pair), the adversarial-suite summary, the
  what-adopting-takes list for a Kasia client (incl. the two asks for
  their team: Q3 namespace blessing + cipher interop vector exchange),
  and the 2-3 minute demo script.
- **README** rewritten stranger-clonable (C5): cold start (clone →
  install → env → prisma migrate → dev), faucet steps with the honest
  bot-protection note, integration-test key setup, repo layout table,
  architecture paragraph, testnet-only warning, kaskly.app/kaskly.kas
  identity, ISC.
- **Error-state polish**: connection-error banner (calm, with Retry)
  now surfaces wRPC failures instead of leaving screens silently stale
  (F4 honesty).
- **Repo cleanup for public eyes**: unused create-next-app template
  SVGs removed; audit-trail docs (CLAUDE/PROGRESS/TRACE/TRUST/IDEAS,
  spike/) deliberately KEPT — they are the evidence and the process.
- TRACE: P4 verified; C5 built (flips at the fresh-clone gate check).

### Old current-phase block (Phase 3, retained for history)

**Phase 3 COMPLETE — gate PASSED (human, 2026-08-04), tagged `phase-3`.
Post-tag polish queue in progress (glass pass + Earned in flight; then
dev deadline chip, countdown smoothing). Phase 4 awaits explicit human
go (L3).**

### Phase 3 gate decision (human, 2026-08-04)

**Gate PASSED on all items**: full loop verified end-to-end between two
real wallets (send → live inbox discovery with §4 badge → reply-to-claim
→ funds + reply delivered), refund observed landing at deadline,
late-reply structurally refused, script-injection text rendered inert,
explorer links and rebuild-from-chain exercised. Nine findings raised
during gate testing (F6-F9 + queued polish) — all blocking ones fixed
and re-verified before the tag. TRACE S1-S3 + Phase 3 infrastructure
rows flipped to verified.

### Project identity assets (from the human, 2026-08-04)

- **kaskly.app is registered** (Cloudflare; WHOIS privacy on; DNSSEC
  pending). It is the PRODUCTION DEPLOY TARGET FOR PHASE 4. Deployment
  and DNS are a later, human-led step — no deploy config gets built now.
- **kaskly.kas is registered** — KNS inscription **#96310**, held in the
  project wallet. It is the project's on-chain identity.
- Where these get incorporated (only where phases already touch them):
  - Phase 4 README rewrite: kaskly.app as the live URL; kaskly.kas as
    the on-chain identity.
  - ASKSPEC / PITCH contact lines (Phase 4, alongside Q5): cite
    kaskly.kas.
  - Reference client kns.ts: kaskly.kas as a display/verification
    example (done 2026-08-04 — source comment + compose placeholder).
- Envelope-spec implications (verified-sender identity via KNS) are
  parked in IDEAS.md — not current scope.

### Phase 3 context (from the human, 2026-08-03)

- **Branding:** the reference client is branded **"Kaskly"**, tagline
  **"Kaskly — Just Ask Me"**. (Branding lives in the client only; the
  protocol and spec remain "ASK" — D2's credit model: spec carries
  authorship, reference client carries branding.)
- **Logo:** originally requested as an in-repo SVG build; **revised by the
  human mid-session: skip the SVG** — final assets will be produced
  externally with an image generator and delivered later. Until then the
  UI header uses a plain text wordmark "Kaskly" (teal #49EACB on dark),
  and `public/brand/` holds only a README marking the pending assets.
- Carried-forward Phase 2 items (already in the checklist): inbox verifies
  announcement→funded-P2SH (ASKSPEC §4); the two normative client rules
  (auto-broadcast refund at deadline; refuse late-claim construction) are
  UI behaviors this phase. `spike/.keys.json` must not be deleted.

### Phase 3 architecture decision (recorded before building, per R6)

**All keys, signing, and chain operations run in the BROWSER; the Next.js
server only serves the app and the cache API.** Rationale: D4 ("key
handling happens client-side only") makes browser-side signing mandatory,
and signing requires the SDK — so the client uses the **web variant** of
the pinned SDK (`vendor/kaspa-wasm32-sdk/web/kaspa`, same v2.0.1 zip,
SHA256 recorded above), newly committed alongside the nodejs variant and
pinned as a second `file:` dependency (`kaspa-wasm-web`). This is also
Kasia's own architecture (browser wallet + wRPC over WebSocket). Bundler
detail: `kaspa-wasm` resolves to the web package for browser bundles via
a Turbopack alias; the web target's `init()` is called once at app start
with `/kaspa_bg.wasm` (copied to `public/` at build, gitignored — 11.5 MB
stays single-sourced in vendor/). Node-side code (tests, rebuild check)
keeps importing the nodejs variant unchanged.

### Phase 2 gate decision (human, 2026-08-03)

**Phase 2 APPROVED.** All acceptance criteria met (see Phase 2 checklist
below): lifecycle from automated tests, three terminal states with txids,
R2 dual verification, R3 attack set green, ASKSPEC v0.1 consistent with
code, TRUST.md current, tagged `phase-2` (commit `86d5cc3`).

### Phase 4 gate — closure + formal go/no-go (2026-08-04)

**VERDICT: GO — phase 4 closed and tagged.** Beta ran with no new issues;
the human confirmed the three remaining launch-checklist items complete
(prod refund witnessed, PWA + QR pass, thread + feedback URL live) and
confirmed the Earned-widget and F10 resolved-timer visuals displayed
correctly during beta. Session R7 ritual: 26/26 unit green before work.

**C5 cold-start check (delegated to Claude by the human, with rules:
README verbatim, every command logged, any knowledge gap = failing
check).** Full transcript committed at `audit/coldstart-log.txt`
(+ per-run dev-server outputs, runs 1-3). Outcome:
- RUN 1 (verbatim README): **FAILED.** `/api/asks` crashed on the fresh
  clone — `Cannot find module '.prisma/client/default'`. Root cause:
  README lacked `npx prisma generate` (`migrate deploy` does not
  generate; the working tree only worked because earlier builds had).
  Found in the dev server's own output; the landing-page 200 was a
  false positive (it doesn't touch the DB).
- Fix: one line added to README cold start; root cause confirmed by
  adding the step in-place and watching /api/asks go 200.
- RUN 3 (pristine re-clone per the human's ruling that a patched clone
  doesn't count; run 2 retained as evidence but not counted): **PASSED
  end-to-end** — boot proven by the server's own Ready output, a
  listening-socket check, and the DB-touching API route returning valid
  JSON; 26/26 unit suite; spike key script OK; zero knowledge gaps.
- RUN 4 (post-tag, closes run 3's asterisk): at run 3 the fix existed
  only in the working copy, so the corrected *sequence* was followed
  against a clone whose README file was still pre-fix. After the
  phase-4 push, a fresh clone of tag `phase-4` (62a52e1) was made, the
  cold-start block read FROM THAT CLONE'S OWN README, and executed line
  by line: **PASSED** (Ready in 460ms, listening socket proven, / 200,
  /api/asks 200 valid JSON, 0 server errors, 26/26 unit).
  `git status` in the clone was empty — proof of no hand-patching.
- Both failed and clean logs kept deliberately (human instruction): a
  caught-and-fixed gap is better audit material than a perfect first run.

**F11 — integration suite file-parallelism race on the shared funded
key (found by the phase-4 gate run, fixed).** The gate's first
`test:integration` run failed 2/8: both lifecycle locks were rejected as
mempool double-spends of UTXO `c7ac89e5…:1`. Root cause, evidenced not
assumed: vitest runs test FILES in parallel; `lifecycle`, `fees`, and
`rebuild` all fund from the same spike sender key, and REST showed the
wallet held exactly ONE UTXO — so all three coin-selected the same
output and the first submission (fees' lock `2026a609…`, accepted
seconds after suite start) won. Earlier greens were luck: a fragmented
wallet made collisions unlikely. Fix: `--no-file-parallelism` on
`test:integration` and `test:all` (money tests sharing a key must never
run concurrently). Re-run: **8/8 green in 148s.** No money-path code
involved — harness defect only.

**TRACE closure pass.** Rows flipped to `verified` with per-row cited
evidence (INT + R2 recomputes re-proven every run; human gate + beta
evidence; cold-start log; unmapped-code sweep added rows for share
cards/QR, PWA shell, and local contacts — zero unmapped code remains).
Three rows stay below `verified` as **documented exceptions**, each with
owner + return path:
1. **P1 (stranger-implementable spec)** — the real stranger check is
   the external audit-v1 review package (owner: human recruits the
   reviewer; returns with the first reviewer report).
2. **Attack row: malformed payload** — client-layer by design (chain
   checks only the 15-byte prefix, ASKSPEC §10). Sender-side status
   display for a prefix-valid/garbage-body claim is a hardening item in
   the approved post-tag plan (owner: Claude, next session block).
3. **Attack row: oversized payload** — client-layer; the consensus
   payload ceiling remains UNVERIFIED (tracked since Phase 2).

**Phase 4 checklist (brief §9):**
- [x] PITCH.md complete: problem, mechanic, spec link, live demo link
      (kaskly.app — freshness-fixed this session), lifecycle txids,
      adoption path, ISC attribution, 2-3 min demo script
- [x] README stranger-clonable — proven by the logged cold-start runs
      (and improved by them: the prisma generate fix)
- [x] Empty/loading/error states — shipped with Phase 3, exercised in beta
- [x] Repository cleaned for public eyes — repo public since pre-beta
      (commit d104779: IDEAS split, redactions, LAN IP scrub)
- [x] Full suite green: unit 26/26 + lint + build + integration 8/8
- [x] TRACE at closure state; zero unmapped code; 3 documented
      exceptions above
- [~] Demo dry-run: every step of the PITCH.md script was human-verified
      across the phase-3 gate and beta (full loop, refund, late-reply,
      QR, rebuild); a literal start-to-finish dry-run is RECOMMENDED
      before the KaChat pitch meeting (owner: human; non-blocking per
      the human's explicit tag instruction)

**R4 self-review:** phase-4 delta reviewed against C5, P4/P6, R1-R8 and
the D-row evidence claims. Deviations: none beyond the three documented
exceptions above. Code changes in this closure: README (+1 line),
package.json (test serialization), PITCH.md (freshness), TRACE.md,
this file, audit/ evidence logs — no protocol-surface code touched.

**Approved next blocks (human, 2026-08-04, via plan approval):**
adversarial review with mainnet eyes → network-neutral hardening on
main (incl. F11-adjacent fixes, caps plumbing, MAINNET.md) → audit-v1
review package (zip on a GitHub Release) → private mainnet validation
(hybrid branch `mainnet-validation`, local-only deploy, 5 KAS per-Ask
cap / 15 total-at-risk, human wallets only, canary-first ladder).
kaskly.app remains testnet-only; the config.ts boot guard is untouched.

### Adversarial review with mainnet eyes — 2026-08-04 (F12-F23)

Method: three independent reviews (chain layer; key handling + crypto;
app/orchestration layer), each with an explicit "how do I steal funds"
framing, then **independent re-verification by the session author** —
subagent output was not accepted as evidence for anything load-bearing
(R6). Verification status is stated per finding. Nothing below is fixed
yet; fixes land in the hardening block.

**Headline: the covenant escrow is the strongest part of the system and
no reviewer found a way to steal a locked Ask from its intended
recipient. The defects are (a) two real fund-loss paths that are NOT
theft-from-recipient, and (b) a cluster of "the UI lies about money"
failures in the layer that interprets chain data.**

#### F12 — CRITICAL — refund branch pins outputs but NOT inputs: batched refunds leak the surplus to a miner
VERIFIED (structure) by direct read of `covenant.ts:89-103`: the OpElse
branch constrains CLTV, `OpTxOutputCount == 1`, `output[0].spk ==
senderSPK`, `output[0].amount >= minRefund` — and says **nothing about
the input set**. Multiple expired covenant UTXOs sharing one sender can
therefore be spent in a SINGLE signature-less transaction with ONE
output of `max(minRefund_i)`; every script passes, and the difference
(sum of inputs − that one output) is captured as miner fee. Since the
refund needs no key and all covenant parameters are public in the
announcement, any chain observer — a mining pool most naturally — can
construct it. Reviewer measured a 2-input example at mass 976, fee
97,600 sompi, storage mass 0 — i.e. cheap and standard, not exotic.
Scale: 20 expired 100-KAS Asks from one sender → sender receives ~100
KAS, miner takes ~1,900 KAS.
EXPLOIT VIABILITY: **PROVEN ON CHAIN, 2026-08-04** (TN10). Probe:
`spike/07-batch-refund-drain.cjs`. Two distinct covenants from one
sender (1 KAS and 3 KAS, distinct P2SH addresses, same deadline) were
funded by lock tx
`ceb03d9b577c00445cc0f6a5f50b9540a7040f3844e491af8d9bc62429c52edd`,
then spent AFTER the deadline by ONE signature-less transaction with
BOTH covenant UTXOs as inputs and ONE output:
`ab5575a6efb645b8ef57d0ec251a481efb80f8b00e9f052b71f5d277bfd73566`
— **accepted by consensus**.
R2 dual verification (independent recomputation over a FRESH RPC
connection, node UTXO index only — not the submitting node's word):
  - covenant UTXOs remaining: **0** (both consumed)
  - outputs to the sender from the drain tx: **1**
  - sender actually received: **2.995 KAS**
  - locked in total: **4 KAS**
  - two honest separate refunds would have paid: **3.99 KAS**
  - **measured shortfall: 0.995 KAS**, captured as miner fee
The verdict is written only when the node-measured shortfall is
positive AND exactly one output reached the sender; the pre-broadcast
intent figures are printed but never feed the verdict. Covenant
addresses: A `kaspatest:prxkf3tl2fh3qjt2tvv0q4pmj4r72gekd6hv3gqv2clm3scukxz523xtqstsu`,
B `kaspatest:pz3hcg3v2ufq8kr90vuds2q0km7x8hqwf6zkhjgz4cm63p5kfuxrj8uuk52d7`.
This escalates F12 from "reasoned" to **demonstrated value loss**: the
sender lost an entire Ask's principal, and nothing about the attack
required a key, privileged data, or mining capability beyond including
one's own transaction.
FIX IS EXPRESSIBLE TODAY: I confirmed against the pinned SDK that
`OpTxInputCount` (179), `OpTxInputIndex` (185) and `OpTxInputAmount`
(190) all exist. Minimum: pin `OpTxInputCount == 1`. Better:
`output[0].amount >= OpTxInputAmount(OpTxInputIndex) − allowance`.
NOTE: this is a COVENANT CHANGE — it changes the redeem script, so it
breaks the golden vector, changes every P2SH address, and is a spec
version event. It cannot be shipped as a client patch.
Mainnet-specific: no (same on testnet); only mainnet makes it theft.

#### F13 — CRITICAL — Asks between 0.005 and ~0.105 KAS are lockable but PERMANENTLY unspendable (funds burned)
VERIFIED INDEPENDENTLY: I re-ran the mass/fee math myself against the
pinned SDK (`calculateTransactionMass` / `calculateTransactionFee`,
transaction built exactly as `transactions.ts:196-213` builds it) and
reproduced the reviewer's numbers to the sompi, on BOTH `testnet-10`
and `mainnet` (byte-identical):

| amount (sompi) | refund mass | min fee | verdict |
|---|---|---|---|
| 600,000 | 8,333,334 | none exists | unspendable |
| 1,000,000 | 1,000,000 | none exists | unspendable |
| 2,500,000 | 100,000 | 10,000,000 | fee > allowance |
| 5,000,000 | 22,222 | 2,222,200 | fee > allowance |
| 10,000,000 | 5,263 | 526,300 | fee > allowance |
| 10,500,000 | 4,762 | 476,200 | ok |
| 100,000,000 | 741 | 74,100 | ok |

Root cause: refund mass is dominated by **KIP-9 storage mass**, which
scales inversely with output value — it is NOT a function of payload
size. The fixed `REFUND_FEE_ALLOWANCE` (500,000 sompi, `protocol.ts:46`)
is therefore sufficient only above ~0.105 KAS. The covenant pins
`output >= minRefund`, so the refund cannot pay the larger fee; the
claim path fails on the same amounts. Both parties are locked out
forever. The only guard today rejects `amount <= 500,000` sompi
(`node.ts:110`) — **20x too low** — and the compose screen has no
minimum at all (`ask/page.tsx:89` → `parseKas` accepts "0.006").
**This directly falsifies ASKSPEC.md:221-223**, which states the refund
"mass is small and constant" and the fixed allowance is "always
sufficient". That sentence is wrong and must be corrected (P6 defect).
Mainnet-specific: no — but mainnet is where a "cheap test send" burns
real money, and a 5 KAS cap does not protect against it (the danger is
the FLOOR, not the ceiling).

#### F14 — HIGH — a claim can make the sender's UI say "refunded — every sompi is back in your wallet"
VERIFIED by direct read of `asks-client.ts:191-222` (this was the lead
seeded from the phase-4 TRACE exception; it is real). The covenant's
claim branch validates only the 15-byte prefix, so a claim carrying
`ciph_msg:1:ask:` + garbage is chain-valid and pays the recipient.
`parseAskPayload` then THROWS, the `catch` at `:211-213` swallows it,
and control falls to `:214-222`, which returns unconditionally
`verified: true, status: "refunded", refundTxid: <the claim txid>`.
There is no check that the spending transaction looks anything like a
refund. Three distinct inputs reach that line: garbage body; a
well-formed reply whose `ref` names a different Ask; an `a`-subkind
payload.
User-visible: Sent shows the "refunded" chip and the sentence "No reply
came. Every sompi is back in your wallet." (`sent/page.tsx:75-79`) with
an explorer link **labelled "refund"** pointing at a transaction that
paid the recipient. It is written to the cache (`activity.tsx:118-135`)
and "rebuild from chain" reproduces it (`rebuild.ts:145-152`) — the
designated recovery action confirms the lie.
Also a spec divergence: `ASKSPEC.md:249-250` says "spent otherwise
**after deadline** → refunded"; the code omits the deadline condition.
FIX (client-only, no covenant change): classify as refunded only on a
positive test — exactly one output, paying `senderAddress`, >= minRefund,
deadline passed — and add an explicit third state otherwise.
Mainnet-specific: yes in severity (testnet: cosmetic; mainnet: it is the
difference between "I was cheated" and "the system worked").

#### F15 — HIGH — reply forgery: any dust transaction can flip a sender's Ask to "answered"
VERIFIED by direct read of `activity.tsx:227-243`. The firehose handler
fires for every chain transaction whose payload carries the ASK prefix,
and if `envelope.ref` matches one of your lock txids it sets
`status: "answered"`, `claimTxid: <that txid>`, `replyCiphertext: <that
blob>` — with **no check that the transaction spent the covenant at
all**, no `verified` check, no status check. Lock txids and the sender's
encryption key (their address) are public, so anyone can broadcast a
cheap transaction carrying a payload that renders as the recipient's
reply. Transient (the 45s re-derive corrects it) but trivially
repeatable, and while status != open the auto-refund effect skips the
Ask (`activity.tsx:257-260`) — so it also delays refunds.
Related, PERSISTENT variant (reviewer-reported, structure confirmed):
the covenant's REFUND branch imposes no payload constraint, so a
sig-less refund can carry a forged reply payload; `deriveStatusFromChain`
classifies by payload rather than by which branch was taken, so that
state is cached and survives reload.
Mainnet-specific: yes.

#### F16 — HIGH — one dust payment to a covenant address jams claim, refund, and display for that Ask
VERIFIED by direct read of `node.ts:164-172`: `getCovenantUtxo` returns
`entries[0]` with **no filtering by outpoint or amount**. The P2SH is
publicly derivable from the announcement, so anyone can add a second
UTXO to it for the cost of one transaction. Then: the §4 verification
compares `entries[0].outpoint.transactionId` to the lock txid and fails
→ the Ask is filtered out of BOTH screens for both parties; `claimAsk`
builds against the dust UTXO and throws; `maybeAutoRefund` builds a
refund from a dust input that can never satisfy `minRefund`. Funds are
not stolen (a correct client picking the right outpoint could still
spend) but this client is permanently stuck, and the recipient is denied
the money. FIX (one line, client-only): select by
`outpoint.transactionId === lockTxid && amount === amountSompi`.
Mainnet-specific: yes.

#### F17 — HIGH — hostile KNS response silently redirects the whole payment
Reviewer-reported, code cited: `kns.ts:19-31` performs no validation on
the returned owner address — no shape check, no network-prefix check;
the only sanity check (`asset === name`) is echoed by the same server.
`ask/page.tsx:91-95` assigns it straight to the recipient and the
address chip renders off the TYPED `.kas` name, so **the user never sees
the resolved address before funds lock**. A compromised
`api.knsdomains.org` funds covenants claimable only by the attacker.
FIX: validate shape + network prefix, and show the resolved address for
confirmation before locking. Mainnet-specific: yes.

#### F18 — HIGH — unauthenticated cache API can hide a real Ask and suppress its refund
`api/asks/route.ts:21-45` + `repo.ts:39-85`: POST upserts by `askRef`,
DELETE wipes by `address`, no auth, no origin check, no rate limit, all
inputs publicly enumerable. Poisoning a row with altered sender/amount
makes derivation reproduce a different P2SH → `verified:false` → the
Ask is filtered from both screens WHILE the auto-refund effect operates
on the poisoned record and queries the wrong covenant — so a real open
Ask becomes invisible and its refund is never broadcast by that client.
A variant whose derivation throws leaves a row `pending` forever, and
pending rows render — a permanent phishing card for one HTTP request.
Mainnet-specific: yes.

#### F19 — MEDIUM — no CSP or security headers; XSS would mean immediate total key loss
`next.config.ts` sets no headers; no CSP/frame-ancestors/Trusted-Types
anywhere. The reviewer independently re-verified the "React text nodes
only" claim and it HOLDS (zero dangerouslySetInnerHTML/innerHTML/eval/
new Function/srcdoc/document.write/insertAdjacentHTML in `src/`, no
third-party runtime scripts, fonts self-hosted). So there is no known
sink today — but the only defense is "we didn't write one", and
`localStorage["kaskly.wallet.v1"]` is one injected line away. Mainnet
needs a strict CSP as table stakes.

#### F20 — MIS-FILED AS MEDIUM; SUPERSEDED BY F24 (CRITICAL)
> **Corrected 2026-08-05.** This was filed as a calibration issue — a
> constant measured on the wrong network. The third audit showed the real
> defect is one layer down: the DAA **score** is taken verbatim from an
> untrusted node and written irreversibly into the covenant's CLTV, so a
> hostile node destroys the sender's funds outright. Severity was wrong,
> and the mis-filing is recorded rather than quietly edited. See F24.

#### F20 (original text) — MEDIUM — `DAA_PER_SECOND = 10n` is baked into every deadline and was measured on TN10 only
`config.ts:33` → `ask/page.tsx:111`. Once written into the redeem script
the deadline is immutable. Against a network with a different block
rate, "7 days" silently becomes a different real duration in both
directions, and the countdown lies for the whole period. Miner
manipulation of DAA is bounded and not attacker-steerable (reviewer's
assessment, which matches my own reading) — the hardcoded constant is
the real risk. Must be re-measured on mainnet before any real KAS; the
call site already has `currentDaaScore`, so a self-correcting
measurement is cheap. Mainnet-specific: yes.

#### F21 — MEDIUM — every refund overpays the miner by ~425,900 sompi
`transactions.ts:199` pays exactly `minRefund`, so the fee is always the
full 500,000-sompi allowance even when the network minimum is 74,100.
The covenant permits `>= minRefund`, so paying the sender more is
already legal — the client just doesn't. Fixing this also lowers the
F13 unspendable floor. Mainnet-specific: in severity, yes.

#### F22 — MEDIUM — one reply payload can claim N Asks; the chain never binds a reply to the Ask it pays for
The claim branch checks the 15-byte prefix and R's signature only — not
the subkind, not `ref`. A recipient holding Asks from several senders
can spend them all in one transaction with one reply payload. Combined
with F14, the shorted senders see "refunded". `ASKSPEC.md:188-189`
concedes the 15-byte limit, but `TRUST.md:15-18` ("only with a
transaction that carries a reply") reads as much stronger than what the
opcodes do.

#### F23 — MEDIUM — documentation claims exceed what the opcodes enforce (P3/P6 defect)
Concrete, quotable divergences to correct:
- `ASKSPEC.md:221-223` "the fixed allowance is always sufficient" —
  **false** (F13).
- `ASKSPEC.md:233-235` refund is "exactly one output … the covenant
  rejects anything else" — the covenant accepts any amount >= minRefund
  and ANY NUMBER OF INPUTS (F12).
- `TRUST.md:20-23` "only lets it pay the full amount (minus network fee)
  to the sender" — it enforces a floor, per input (F12, F21).
- `TRUST.md:15-18` "only with a transaction that carries a reply" — only
  a 15-byte prefix (F22).
- `ASKSPEC.md:310-318` "not chain-enforced" list omits reply AUTHORSHIP
  and ask-sender AUTHENTICITY.
TRUST.md is public and linked from the live site, so these corrections
are the highest-priority documentation work regardless of code fixes.

#### Lower-severity (recorded, not detailed here)
Ask-sender impersonation (`envelope.sender` is self-asserted and never
bound to the funding key — cheap phishing that can render under a
trusted contact name); the ownership "proof" is self-referential and
cannot fail, yet the UI labels it a verification; private-key field is
`type=password` so password managers may offer to sync it;
`limit=50`/`limit=500` history windows are floodable/truncating; a
hostile RPC node can deny a claim or delay a refund via DAA score; the
auto-refund gets one attempt per session because `maybeAutoRefund`
swallows rejections and returns null; kasia1 is not key-committing
(inherited from Kasia); caret ranges on the three @noble packages that
handle key material; Earned can display a persisted number with no live
chain backing; `Transaction.id` is stale after post-construction
mutation (latent trap, currently harmless because the RPC-returned txid
is what gets recorded).

#### What the reviews CLEARED (independently useful)
No path was found to steal a locked Ask from its intended recipient.
`xOnlyFromAddress` rejects ECDSA and P2SH addresses (no "locked to a key
nobody holds" grief). Claim signatures are SIGHASH_ALL and commit to the
payload, so a reply cannot be swapped post-broadcast. No signature-script
malleability of txids. The §4 announcement→funded-P2SH verification is
genuinely sound and unverified rows are never cached or surfaced. CLTV
construction is correct. The adversarial suite really does submit every
attack to TN10 and require consensus rejection — its blind spot is that
every attack is single-input/single-covenant, which is exactly why F12
and F22 survived it. No fee outputs, no operator spend path (D2/D4
hold). Keys never reach the server. The service worker never caches
`/api/*` or money state. x-only ECDH parity handling is correct
(verified empirically for odd-Y recipients). Fresh ephemeral key and
nonce per message; AEAD tag enforced; key import validation is sound and
un-hangable; RNG is the browser CSPRNG. Amount parsing is integer-only
BigInt with no float path.

#### Consequences for the mainnet plan (revised)
1. **F12 and F13 are mainnet blockers.** F12 requires a covenant change
   (new redeem script, new addresses, spec version bump) — it is not a
   patch. Private mainnet validation must not proceed on the current
   covenant.
2. The 5 KAS per-Ask cap does not address F13 — the danger is a
   too-SMALL Ask. A minimum (~0.2 KAS with margin) is required, enforced
   in both `createAsk` and compose.
3. Local-only deployment is not isolated by port-sharing: run-4 evidence
   showed a stray browser tab hitting `localhost:3000` and polling the
   throwaway server. The mainnet validation build must use a distinct
   port so localStorage and the SW cache do not share an origin with any
   local testnet build.
4. The audit package should ship WITH these findings (KNOWN-LIMITATIONS
   + fixes), not before them — a reviewer who rediscovers F14 learns
   nothing new, and one who sees them documented can go hunting deeper.

### Covenant V3 — authoring gate CLEARED (spike 11c, 2026-08-04)

`src/lib/ask/covenant-v3.ts` is authored (V2 `covenant.ts` untouched, so
in-flight Asks stay readable). Version marker decided:
`ciph_msg:1:ask:r2:` — same Kasia namespace, changed subkind, envelope
`v: 2`; rationale and rejected alternatives in COVENANT-V3-DESIGN.md §10.

**Spike 11c — GATE PASS.** The claim branch's `OpTxPayloadLen` guard
protects a Critical branch, so its BEHAVIOUR (not just its presence in the
enum) had to be proven — the Q1 lesson. Against a passing positive
control (`3a221c91…`):
- guard in isolation: len 49 **rejected**, len 51 **accepted** (`8a949659…`)
- real V3 claim shape at real offsets: len 17 **rejected**, len 49
  **rejected**, len 50 with a WRONG askId **rejected**, len 50 with the
  correct askId **ACCEPTED** (`0c5da1bd…`)

The wrong-askId rejection at the correct length is the F22 property
demonstrated directly: a payload of exactly the right shape but a
different askId cannot claim.

**Floor-direction check (human-requested).** The V3 refund floor sequence
was diffed against the spike 11b Q4 probe that passed on chain, by
extracting the call lines from both real source files — **identical, no
differences**; compiled bytes `00c2b9be03e0930494a2` at allowance 300000.
Stack order is `[output] [input] [allowance] OpSub OpGreaterThanOrEqual`
→ `output >= input − allowance`, i.e. the correct direction. An inverted
compare would have accepted 11b's below-floor spend, which the chain
rejected.

**Golden vector — one source of truth (2026-08-04).** The spike lib cannot
import TypeScript, so a hand-copied V3 builder would risk proving a mirror
secure while the shipped covenant differed. Instead:
`tests/unit/covenant-v3.test.ts` generates `spike/v3-golden-vector.json`
FROM `src/lib/ask/covenant-v3.ts` and asserts against it (catching TS
drift), and `spike/lib.cjs assertV3VectorMatch()` byte-compares its own
builder against the same vector before ANY V3 probe runs (catching spike
drift). Verified in both directions — a single corrupted byte in the
vector was caught and the probe refused to run. Canonical script hex
`63c40132a269…0494a268`, P2SH
`kaspatest:pzwmxfcjea2l0s8cv532yrcffyr5z3spnfqvlxxuhnmnllgv94dacvugta7l2`.

**Probe 07 vs V3 — FLIPPED CONFIRMED → REFUTED (2026-08-04).** Same attack
code, only the covenant changed (`ASK_COVENANT_VERSION=v3`). Vector match
printed before the attack. Two covenants (1 + 3 KAS) funded by
`e6456584…`; the batched refund was **chain-rejected**, `6f13dfff…`:
"script ran, but verification failed" — the script executed and a check
failed, not an SDK build error.

**Control 07c — PASS, and it was necessary.** A REFUTED verdict alone
proves nothing: if V3 rejected *every* refund, the probe would look
identical while the covenant stranded funds forever (the exact F13-class
failure this campaign exists to prevent). 07c rebuilt the same two
covenants — verifying the rebuilt P2SH matched the recorded addresses —
and refunded each INDIVIDUALLY: both **ACCEPTED** (`b269d3f2…`,
`bf6d0162…`), R2-verified over a fresh connection with the node's UTXO
amounts matching the built amounts exactly. So the batched rejection is
attributable to `OpTxInputCount == 1`, not a blanket failure.

**F21 demonstrated live in the same run:** the refunds paid 0.999 and
2.999 KAS against floors of 0.995 and 2.995 — the sender keeps ~0.004 KAS
per refund that V2 handed to a miner.

**Probe 08 — F22 CLOSED ON V3 (2026-08-04).** Vector match printed before
attacking, same discipline as 07c. F22 is specifically about one recipient
claiming MULTIPLE SENDERS' Asks, so the probe funds a genuinely separate
second wallet rather than weakening the test to same-sender.
- (a) ATTACK one payload claiming Asks from sender1 AND sender2 →
  **chain-rejected**
- (b) ATTACK same-lock-tx variant — two Asks funded by ONE transaction, so
  they share an outpoint txid (the case that would have broken mechanism
  M2) → **chain-rejected**
- (c) CONTROL all four Asks claimed individually with their own askId →
  **all ACCEPTED** (`3633855d…`, `26be191e…`, `ea5935ac…`, `500c07b5…`),
  R2-verified over a fresh connection: 1 output each, 0.997932 KAS to the
  recipient. Without (c), the attack rejections would be
  indistinguishable from "V3 rejects every claim".

Two harness bugs were found and fixed while building it, both worth
remembering: sequential funding transactions from one wallet race on UTXO
selection (same class as F11 — fixed by funding sender1's three covenants
in ONE transaction), and a top-up guard that checked for an EMPTY wallet
rather than a sufficient BALANCE left sender2 stuck at 0.998 KAS.

Aborted runs left ~4 TKAS in orphaned covenants; the deadline offset was
shortened to ~30 minutes so those become refundable shortly rather than
after hours. Testnet only.

**Still owed before any tag (design §9):** floor probe 09 incl. the
0.1 KAS non-convergence refusal; DAA probe 10; full R3 suite green against
V3; and the F14 client classification fix, which ships with V3 or neither
is complete.

### 🚧 MAINNET HARD-GATE LIST (nothing ships to real value until every item is closed)

1. **F24 guard 1 does NOT protect mainnet.** `DAA_ANCHORS` has a real,
   measured anchor for testnet-10 only; mainnet is an explicit
   `UNVERIFIED-STUB` with no anchor. `assertPlausibleDaaScore` REFUSES
   unknown networks rather than trusting them, so mainnet Asks cannot be
   created at all today — which is the correct failure direction, but it
   means **the mainnet DAA rate must be measured and the anchor set before
   mainnet is usable**. Guessing an anchor would either reject every
   legitimate Ask or wave a hostile score through.
1b. **A3 RESIDUAL — in-band DAA inflation still lengthens a lock.** The
   fourth-audit fix made guard 2 measure the deadline against an
   independent anchor projection, so a node lie that pushes the real lock
   past the 90-day ceiling is now caught. **A lie that stays inside the
   band and under the ceiling still inflates the lock** — the user asks
   for 7 days and gets more, invisibly, because the countdown reads the
   same node. The unbounded case is closed; this one is not. It is a
   griefing vector that survives to mainnet, so it is a GATE and not a
   test comment: closing it needs a tighter ceiling or a second,
   independent time source. Asserted as a passing test documenting the
   residual in `tests/unit/daa-guard.test.ts`
   ("A3 RESIDUAL, asserted honestly").

2. **F29 / Kasia conversation.** Replies carry no authorship (no AAD) and
   ciphertexts are malleable. The fix breaks Kasia wire compatibility, so
   it travels with the `r2:`/`a2:` namespace question (Q3/Q4) — not a
   unilateral patch.
3. **Fee-rate behaviour re-proof.** Reasoned, not chain-demonstrated;
   TN10 cannot simulate elevated fees (COVENANT-V3-DESIGN.md §10b).
4. Plus the pre-existing mainnet gates already recorded: independent
   security review, key-storage upgrade (localStorage is testnet-grade),
   and LLC/legal.

### F26 + F25 FIXED (2026-08-05)

**F26 — key export/backup.** There was no reveal or export path anywhere,
so a created wallet had no user-held copy and any browser reset was
irreversible fund loss with no attacker involved. Added to the wallet
panel: reveal (hidden behind an explicit click), copy, and download-as-file.
`kaskly.backup.v1` records **addresses and timestamps only, never key
material**, so destructive actions can tell the user what they are about
to lose. Disconnect now warns differently depending on whether a backup
was ever exported — "⚠ You have NEVER exported this key" versus a
softer confirm — and the button reads "Disconnect anyway — I accept
losing it" when no backup exists.

**F25 — clickjack.** `next.config.ts` now serves
`Content-Security-Policy: frame-ancestors 'none'` and
`X-Frame-Options: DENY` (plus Referrer-Policy and nosniff), and Disconnect
requires a confirmation step so one click cannot destroy the wallet.

**PoC-verified against a running production build:**
- Headers actually served (curl on `/` and `/ask`):
  `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`.
- The clickjack PoC was re-run from a genuinely different origin
  (attacker page on :8099 framing the app on :3000) in a real browser:
  ```
  iframe load event fired : true
  frame renders content   : false
  detail                  : frame document empty
  CLICKJACK BLOCKED — nothing to click; frame refused to display
  ```
  PoC kept at `scratchpad/clickjack-poc.html`.

**NOT claimed:** this is not a full CSP. A `script-src` policy — the real
defence-in-depth against key exfiltration — needs a nonce strategy
compatible with Next's inline bootstrap and was deliberately NOT attempted
rather than shipped half-configured and reported as done. F19 stays open.

### F28 FIXED (2026-08-05) — ceremony removed, real check added

**Deciding question (human): are keys imported, or only generated?** Both —
`wallet-panel.tsx` offers "Create testnet wallet" AND an import field. So
per the rule, implement rather than merely delete.

**But the described check would still have been circular.** Signing a
challenge and verifying against "the address pubkey" is meaningless when
the address is DERIVED from the key under test — which is exactly what the
old code did. A mistyped hex key is usually still a VALID key; it silently
opens a different wallet, and nothing derived from the key alone can
notice. A real check needs an EXTERNAL reference.

**Shipped:** `importKey(hex, expectedAddress?)` — optional; when given, an
import that opens a different address is REFUSED with both addresses shown.
The self-verifying ceremony (`signMessage`/`verifyMessage`/`proofOk`) is
deleted, along with the "✓ key ownership verified by signature" string and
the dead `if (!proofOk) throw`.

`tests/unit/wallet-import.test.ts` (5) asserts the NEGATIVE case FIRST — a
valid key opening a different address is rejected — plus paste tolerance
(whitespace, case, trailing newline) and truncation rejection. A guard test
asserts the ceremony cannot return: no `signMessage(`/`verifyMessage(`/
`proofOk` in wallet.tsx, checked against COMMENT-STRIPPED source so the
explanation of the removal survives while the mechanism cannot.

TRACE row replaced (not silently re-greened): the old row is struck through
as WITHDRAWN and a new row records what is now actually verified.

**Residual, stated:** a user importing a key they hold ONLY as a key has no
address to compare against, so the check is optional and does nothing for
them. That is inherent — there is no external reference in that case.

### F27 FIXED (2026-08-05) — both halves, each with a NEGATIVE proof

The artifact was already confirmed clean, so this adds the mechanism. Both
halves were proven to FIRE, not merely to exist — a mechanism that cannot
fail is F28's tautological proof all over again.

**Half 1 — build-time integrity.** `scripts/verify-sdk-integrity.mjs` pins
per-file SHA256s for the four vendored SDK artifacts AND the served copy at
`public/kaspa_bg.wasm` (verifying only the vendor source would leave the
actually-shipped file unchecked). Wired into `prebuild`, running BEFORE and
AFTER the copy step. The hashes were independently recomputed this session
and match the third audit's byte-comparison against the official upstream
release.

NEGATIVE PROOF — one byte corrupted at offset 1,000,000 of the web wasm:
```
MISMATCH vendor/kaspa-wasm32-sdk/web/kaspa/kaspa_bg.wasm
  expected 5f90736c80721027ecea1a51509005ebb37a434857fb4882ff03b20b24b923a9
  actual   73330d0a53c7fb52640ceeb4ce81ac4f4d4b9ad0d31406b5ec9676224f3bb8a6
*** BUILD ABORTED ***            verify exit=1     npm run build exit=1
```
The BUILD aborts, not just the script. File restored; `git status vendor/`
clean afterwards.

**Half 2 — SW revalidation.** `/kaspa_bg.wasm` moves from cache-first to
network-first with cache fallback. `/_next/static/**` stays cache-first
because build-ID URLs already make it self-healing.

NEGATIVE PROOF — `audit/sw-poison-poc.mjs` drives the REAL `public/sw.js`
fetch handler in a mock SW environment, and reconstructs the OLD handler
from the same source so the comparison is like-for-like:
```
OLD (cache-first)      served POISONED  -> POISON PERSISTS, redeploy did NOT evict
NEW (network-first)    served CORRECTED, cached CORRECTED -> POISON EVICTED
NEW, offline           served from cache -> offline use preserved (accepted trade)
```

**Accepted trade, stated:** network-first means the wasm is re-fetched on
each load rather than served from the SW cache. HTTP caching still applies,
and offline use falls back to the cached copy — including, unavoidably, a
poisoned one while offline. For a binary that generates private keys, a
one-load-later correction beats a permanent one.

**NOT claimed:** this does not verify the wasm at RUNTIME in the browser.
`WebAssembly.instantiateStreaming` has no SRI equivalent, so a compromised
SERVER can still serve a bad binary to a fresh visitor — the build check
protects the repo→build path, not the build→browser path. Closing that
needs a runtime hash check before `init()`, which is not implemented.

### THIRD AUDIT — below the covenant (F24-F32), 2026-08-05, vs tag `covenant-v3.1` (8b1485e)

Three exploit-framed audits of the layers the first two passes ASSUMED
correct: the kasia1 crypto, key storage/handling, and supply-chain /
browser trust. Standard raised: **a working proof-of-concept or it is not
a finding**. Covenant, claim/refund logic and F12-F23 were out of bounds.
PoCs were executed against the repo's own compiled code (the crypto pass
transpiled `src/lib/ask/*.ts` with the project's tsc and ran against
that, not a paraphrase). Findings re-verified by the session author before
recording (R6).

---

#### F24 — CRITICAL — an untrusted node's DAA score bakes a centuries-long deadline into the covenant: permanent fund destruction. LIVE IN THE DEPLOY CONFIG.

**This is the same root cause as F20, which we filed as MEDIUM. That was
wrong.** F20 treated `DAA_PER_SECOND = 10n` as a calibration issue. The
real defect is that the DAA *score* itself is taken from an untrusted
party and written irreversibly into a CLTV.

Verified by the session author, not just reported:
- `src/lib/ask/node.ts:178` — `currentDaaScore` returns
  `BigInt(dag.virtualDaaScore)` **verbatim**: no bound, no sanity check,
  no second source.
- `DEPLOY.md:40` leaves `NEXT_PUBLIC_KASPA_WRPC_URL` **empty**, so
  `node.ts:47-50` uses `new Resolver()` — an arbitrary community-run
  public node picks the number.
- `src/app/ask/page.tsx:111` — `deadlineDaa = daa + chosenSeconds * DAA_PER_SECOND`.
- `src/lib/ask/covenant.ts:72` — the ONLY bound is
  `>= LOCK_TIME_THRESHOLD`, and that constant is `500_000_000_000n`
  (~1,585 years at 10 DAA/s). It exists to keep the value in the DAA
  threshold class, not to sanity-check a deadline.

PoC output:
```
honest  daa=400000000        deadlineDaa=406048000        guardPasses=true  lock=0.0 years
hostile daa=499000000000     deadlineDaa=499006048000     guardPasses=true  lock=1581.1 years
```

**Self-concealing:** the countdown (`ask-card.tsx:63-64`) computes
`deadline - daaScore` from the SAME node, so the UI reads "7 days". The
victim sees nothing until they connect to an honest node. `connectRpc`
(`node.ts:57-62`) validates only the node's *self-reported* `isSynced` /
`hasUtxoIndex` — a hostile node simply answers yes.

Impact: the sender's entire locked amount, unspendable for centuries,
because the refund branch is CLTV-gated on that deadline. Destruction
rather than theft, but total and irreversible. **Blocks all real-value
use.**

**FIX (human-directed, both ends required):**
1. Pin a trusted node for the score that sets deadlines — do not let
   `Resolver()` choose it.
2. Bound the deadline client-side: reject any Ask deadline beyond a
   sane maximum (30/90 days under discussion) and cap the acceptable
   range, BEFORE the covenant is built.
3. **Chain proof required with control:** an absurd node-reported score
   must be rejected before covenant construction; a normal score must
   still produce a working Ask.

---

#### F25 — HIGH — the app is framable and "Disconnect" destroys the key in one unconfirmed click

`next.config.ts` sets no headers, so there is no `frame-ancestors` and
the app can be framed. `src/components/wallet-panel.tsx:103-111` —
"Disconnect (forgets the key in this browser)" — is a single click with
no confirmation, reaching `wallet.tsx:135`
`localStorage.removeItem(STORAGE_KEY)`. Two clickjacked clicks (header
wallet button, then Disconnect) irreversibly destroy the wallet.

Cross-origin framing cannot READ the key, but it can DELETE it. This is
the concrete thing F19's missing headers enable — recorded as its own
finding rather than as a restatement of "no CSP".

**FIX:** frame-busting / CSP `frame-ancestors`, plus a confirmation step
on Disconnect.

---

#### F26 — HIGH — there is no key export or backup path anywhere, so losing the key loses the funds regardless of clickjacking

Verified: `wallet.privateKey` is referenced only at `ask/page.tsx:114`
and `inbox/page.tsx:81`, both for signing. **No reveal, export, or
backup UI exists.** A wallet created with "Create testnet wallet" has no
user-held copy of its key. Clearing site data, an accidental Disconnect,
or a browser reset destroys the funds permanently.

Split from F25 deliberately (human): the clickjack is one trigger, but
the data-loss hazard stands on its own — a user who never meets an
attacker can still lose everything to a routine browser action, while
the UI presents Disconnect as a tidy, reversible-sounding step.

**FIX:** a key export/backup path, and honest wording on Disconnect.

---

#### F27 — HIGH — the one dependency with no integrity verification is the one that generates keys and signs; and the service worker makes a single poisoning permanent

**Integrity gap.** `package-lock.json`: every registry dependency carries
a sha512; the two `file:` deps (`kaspa-wasm`, `kaspa-wasm-web`) carry
**none**, so `npm ci` cannot verify them. The SHA256 recorded at
`PROGRESS.md` ground truth is of `kaspa-wasm32-sdk-v2.0.1.zip`, which is
**gitignored and absent from the repo** — a cloner has nothing to check
the committed files against. No hashing anywhere in the pipeline:
`scripts/copy-wasm.mjs` copies without verification (and its
size+mtime staleness heuristic can skip the copy entirely), and
`src/lib/kaspa-ready.ts:22` loads `/kaspa_bg.wasm` with no SRI
equivalent available to `instantiateStreaming`.

A swapped WASM backdoors `Keypair.random()` (`wallet.tsx:114`) — every
generated wallet becomes attacker-derivable, and the ownership proof
STILL passes because the key is real, merely predictable. Signing,
address derivation and script building all live in that binary.

**GOOD NEWS, PROPERLY VERIFIED:** the auditor downloaded the official
rusty-kaspa v2.0.1 zip (53,492,146 B), confirmed its SHA256 is
`7eaffac9cd920ef2fdf540c6e10f2a2b7761170ebc62ec57dfa0f71c64567a71` —
**exactly the recorded value** — and byte-compared all 14 committed files
plus `public/kaspa_bg.wasm`: **every one matches upstream.** The artifact
is clean today; what is missing is any mechanism to keep it so.
Per-file hashes for pinning:
```
web/kaspa/kaspa_bg.wasm     5f90736c80721027ecea1a51509005ebb37a434857fb4882ff03b20b24b923a9
nodejs/kaspa/kaspa_bg.wasm  9427733cb0cb1c78cc3f2cc9f77f4153426636925ced0256c5c30e4edc199eaa
web/kaspa/kaspa.js          82202df28a83b6da08a4fa4a9184b9ad4ef0185d9d9df333544cf7c17013daca
nodejs/kaspa/kaspa.js       1e0ad892861bf3e0a63ba8ed51366efc2b812c5a34c6895385ee2f9d026d2fc1
```

**Persistence.** `public/sw.js:7` — `VERSION = "kaskly-sw-v1"` is a
constant, never bumped per deploy, and `/kaspa_bg.wasm` is served
cache-first with no revalidation (lines 38-52). Poison that response once
and it owns keygen and signing for that browser **indefinitely**: a
corrected redeploy does not evict it (sw.js is byte-identical so the SW
never updates, VERSION never changes so the activate purge never fires,
the URL never changes so no fresh fetch occurs). Only manual "clear site
data" recovers. The same mechanism means a legitimate SDK security patch
never reaches returning users. By contrast `/_next/static/**` self-heals,
because each deploy mints new build-ID URLs — that half is fine.

**FIX:** build-time per-file hash check against pinned values, and SW
revalidation for the wasm so a one-shot poisoning cannot persist.

---

#### F28 — MEDIUM — the connect-time "ownership proof" cannot fail, and the UI claims it passed

`src/lib/wallet.tsx:56-71` signs `kaskly-ownership-proof:${address}` with
the private key and verifies it against a keypair derived from **that
same key**. The verifier is the signer.

PoC (ports `openWallet` verbatim against the pinned SDK):
```
500 random keys: proofOk=true 500, proofOk=false 0, threw 0
A's signature over B's message, verified against B's pubkey: false
```
The last line is the comparison a real proof would have to make; the code
never makes it. `proofOk === false` is unreachable, so
`if (!w.proofOk) throw` (`wallet.tsx:104`) is dead code. Meanwhile
`wallet-panel.tsx:95-97` renders **"✓ key ownership verified by
signature"**, with a `text-danger` failure branch that can never appear.

Compounding: `TRACE.md:53` marks this row **verified** on evidence "human
connect flow PASSED" — a manual flow that cannot fail. `grep proofOk
tests/` returns nothing. Also inconsistent: the localStorage restore path
(`wallet.tsx:86-91`) skips the `proofOk` gate entirely, inert only
because the proof is tautological.

**FIX (human-directed):** either implement a real check, or remove the
false UI string AND the TRACE row that marks it verified.

---

#### F29 — HIGH — a reply carries no authorship: kasia1 ciphertexts have no context binding (no AAD)

`src/lib/ask/crypto.ts:70`/`:98` — `chacha20poly1305(key, nonce)` with
**no associated data**. Nothing binds a blob to an ask ref, an askId, a
direction (ask vs reply), or an author. `ref` sits in plaintext JSON
beside the opaque `message`; V3's `askId` sits in the binary header —
both OUTSIDE the AEAD.

PoC against the repo's compiled code:
```
EXPLOIT 1: Eve claims Ask B using Bob's reply, verbatim
  Eve CANNOT read it: decrypt throws for Eve.  Bytes identical to Bob's: true
EXPLOIT 2: a third party's ASK replayed as Eve's REPLY — subkind 'a' reused as 'r', accepted: true
EXPLOIT 3: Mallory sends Bob an Ask carrying Alice's ciphertext, under sender=MALLORY
V3 codec: Eve's claim parses, askId differs from Bob's, ciphertext identical, sender decrypts Bob's words
```

So a claimant can present, as their own reply, prose they demonstrably
cannot read — and the sender's UI renders it as that claimant's answer.
ASK's premise is "the reply IS the claim"; the reply carries zero
authorship. It also upgrades the known self-asserted-`sender` phishing
note: the phish now carries real, decryptable prose the victim
recognises.

**Related, same root (recorded here, not separately):** ciphertexts are
malleable in three byte-distinct encodings with no key — the parity byte
is semantically irrelevant and unauthenticated (207/208 single-bit flips
rejected; the one accepted is byte 12), which defeats any client-side
"seen this ciphertext" dedup. And ~0.70% of legacy 32-byte ephemerals are
mis-parsed (measured 28/4000), an inherited upstream format flaw.

**ROUTING (human-directed): DOCUMENT NOW, DO NOT PATCH UNILATERALLY.**
The auditor read upstream Kasia (`K-Kluster/Kasia` cipher/src/lib.rs,
staging branch) and confirmed **no divergence** — Kasia also uses no AAD.
Adding AAD would close this and the malleability together but **breaks
Kasia wire compatibility**, so it belongs in the SAME conversation as the
`r2:`/`a2:` interop question (Q3/Q4), not in a silent patch. Immediate
action is to correct ASKSPEC and TRUST.md, which imply authorship
authenticity that the scheme does not provide.

---

#### F30 — HIGH — a lying node can deny a legitimate claim

`asks-client.ts:358-359` — `if (daa >= BigInt(record.deadline)) throw
new DeadlinePassedError()`. Purely client-side, node-supplied, no chain
cross-check. A node feeding the RECIPIENT an inflated DAA makes their
client refuse to build a claim the chain would accept; the real deadline
then passes and the sender refunds. Value moves recipient → sender via a
node that merely lies. (The converse — inflated DAA to the sender causing
a premature auto-refund — is safely blocked by consensus CLTV.) Same root
as F24; fixing the DAA trust closes both.

---

#### F31 — LOW — quadratic backtracking in `sanitizeKeyInput`, on every render of the import panel

`wallet.tsx:35-41`, called from `wallet-panel.tsx:17` on every render.
Measured: 20k interior quote chars 215 ms, 80k 3.4 s, 200k 21.5 s, 500k
did not finish in 90 s. **Reachability honestly low** — only the user's
own paste reaches it; no attacker-controlled caller exists. Cost is a
frozen tab while a private key sits in the field.

#### F32 — LOW — "Disconnect (forgets the key)" leaves the plaintext message history behind

`wallet.tsx:134-138` removes only `kaskly.wallet.v1`. `kaskly.notes.v1`
holds **the plaintext of every Ask composed and every reply written**,
with no delete path anywhere in `src/`, alongside contacts/seen/earned.
The button text is literally true about the key and misleading about
everything else on a shared browser — while the footer advertises
end-to-end encryption, which is true on the wire and not on disk.

Also LOW/INFO: the private key is written into the DOM `value` **content
attribute** of the import field via React's controlled-input path
(verified in installed react-dom source; UNVERIFIED in a live browser),
and cleared only on success — after a failed import it persists until
unmount. Exact plaintext byte length is public (`len(ct) = len(pt) + 61`)
and ASKSPEC's public-metadata list omits it.

---

#### WHAT HELD, under PoC attack (valuable negative results)

**No key-extraction path was found.** The "React text nodes only" claim
was independently re-verified and extended past the original sweep:
`?to=`, KNS names, contact names, decrypted text, every `href`/`src`,
`next/image` (unused), prototype pollution through all four localStorage
stores, `postMessage`, iframes, `window.opener`. All clear; React 19.2.4
additionally blocks `javascript:` URLs (verified in installed source).

**The most promising extraction path held.** F15's forgery route hands an
attacker-chosen 33-byte ephemeral to `decryptKasia1` with the victim's
private key — a free, repeatable invalid-curve oracle if validation were
weak. 2,000 crafted points: **0 decryptions**; off-curve and
out-of-range rejected by @noble/curves; secp256k1 cofactor 1 leaves no
small-subgroup residues.

**Crypto primitives sound:** 20,000 encryptions gave 20,000 distinct
nonces AND ephemerals (nonce reuse structurally unreachable); parity
handled correctly across 500 recipients including 245 odd-Y (0 failures);
Poly1305 verified before plaintext is returned (207/208 tamper positions
rejected); HKDF wiring correct per installed @noble/hashes source; CSPRNG
confirmed; key-commitment collision is real in principle but **not
reachable** — no flow reads one blob against two keys (would become
reachable if a "reveal your key to prove what was said" feature is added).

**Key never reaches the wire:** three consumers, all terminating in local
primitives; no fetch body, URL, history, IndexedDB, sessionStorage or SW;
zero `console.*` in `src/`. Key material never echoed in error strings.
SW correctly refuses `/api/*` and all cross-origin. All `target="_blank"`
carry `rel="noopener noreferrer"`. The truncated-address `?to=` spoof
dies at `xOnlyFromAddress` before signing.

**npm audit — 3 high, all BUILD-TIME only**, none reachable in the
browser bundle: postcss (needs attacker-controlled CSS; the only CSS is
ours) and sharp/libvips (Next's image optimizer, verified absent from
client chunks). Caveat: the build environment holds deploy credentials,
the same trust boundary as F27.

**Restatement, with new amplification:** the KNS redirect is **F17**, not
new — but the auditor established that the resolved address is **never
displayed before send**, because the confirmation chip renders only when
the input matches an address shape and a `.kas` name never does.
Resolution happens inside the click handler. That materially worsens F17.

---

### ⚠️ TAG `covenant-v3` (35b3549) IS KNOWN-DEFECTIVE — do not treat as current

A second, harder audit against that tag found defects the first campaign
missed. **`35b3549` ships a V3 claim branch vulnerable to the
cross-version claim:** V2's claim branch checks only
`payload[0:15] == "ciph_msg:1:ask:"`, and the V3 header
`"ciph_msg:1:ask:r2:"` BEGINS with those bytes — so one V3-shaped payload
satisfied a V2 covenant too, and a recipient holding one V2 and one V3 Ask
could claim BOTH with a single reply. Fixed after the tag in `bb5c32f`
(`OpTxInputCount == 1` on the claim branch), chain-proven by spike 13.

The tag is deliberately left in place for audit-trail integrity. **We
retag ONCE, after the solver and doc corrections land.** Until then, any
audit package or reviewer pointer must use `main`, not `covenant-v3`.

Second-audit findings and status:
- **Cross-version claim — FIXED** (`bb5c32f`), spike 13: mixed V2+V3
  inputs rejected (`53e07c5d…`), V2 alone accepted (`2ae6e85c…`), V3 alone
  accepted (`6ef24aeb…`), R2-verified, both covenants drained. Accepted
  trade: claim-side fee subsidy is now permanently foreclosed.
- **Solver returned its own seed — FIXED.** `solveRefundFee` returned
  `guess`, so it always returned exactly 100,000 sompi and the "per-Ask"
  allowance was a constant 400,000. Now descends to the true minimum:
  **79,600 / allowance 318,400** at every viable amount.
- **Solver priced the wrong transaction — FIXED.** The sigscript template
  was hardcoded at 117 bytes (the V2 shape) while V3's real refund
  sigscript was 169, then 172 after the claim-branch pin. Now a named
  constant `V3_REFUND_SIGSCRIPT_BYTES`, asserted by unit test against the
  length derived from the committed golden vector — it had drifted twice,
  so it must fail loudly rather than be trusted on sight.
- **Large-amount stranding — REFUTED** (spike 12). A 25 KAS Ask (floor
  2,499,600,000, above 2^31) refunded successfully (`4396205b…`) while the
  sub-threshold control also refunded; R2 confirmed 2,499,900,000 sompi
  returned. The V3 floor arithmetic handles 5-byte operands. No upper
  bound established beyond 25 KAS.
- **Falsified docs — CORRECTED** (2026-08-04): the `amountSompi`/§4 claim
  in `node-v3.ts` (it proves the address, not the funding, and has no
  production caller); the "one reply can never claim two Asks" comment in
  `covenant-v3.ts` (true only V3-vs-V3 with distinct askIds — same-askId
  and mixed V2+V3 are blocked by the INPUT PIN, not the askId); design §6
  skim figures (79,600 / 318,400, replacing both the design's 74,100 /
  296,400 and the shipped-broken 100,000 / 400,000); the §9 gate naming
  `spike/09-small-ask-floor.cjs`, **a file that never existed while the
  tag claimed the campaign complete**; and ASKSPEC, which described v1
  throughout and now carries a §0 warning with the full v1→v2 delta table.
- **CONSOLIDATED KNOWN-OPEN:** behaviour under sustained fee-rate rise is
  REASONED, NOT CHAIN-DEMONSTRATED — TN10 cannot simulate elevated fees.
  Affects the solver's 1.35× failure mode (computed, never reproduced) and
  the claim-viability floor rising with no subsidy rescue (0.5 KAS minimum
  sits ~3× above the ~0.2 KAS cliff, and the input pin removed the
  recipient-subsidy escape). Close on mainnet or a fee-adjustable testnet.
  Recorded once, in COVENANT-V3-DESIGN.md §10b.
- **STILL OPEN:** `amountSompi` is announced but never compared against
  the funded UTXO in any V3 path (`rebuildCovenantFromAnnouncementV3`
  returns only an address and has no production caller) — my earlier claim
  that it closed the §4 funding gap was premature. askId uniqueness rests
  on sender honesty (ids are public, duplicates unenforced). ASKSPEC still
  describes V2 throughout. Design §6 skim figures and the §9 gate list
  (which names a `spike/09` that never existed) are falsified.

### SESSION PARK — 2026-08-04 (V3 campaign in flight; R3 is the next block)

**Read this first.** Phase 4 is tagged and pushed. Since then the session
found and is fixing a set of real defects (F12-F23, PROGRESS above). The
covenant V3 work is PARTWAY THROUGH its re-proof campaign. Nothing V3 is
tagged, and `src/lib/ask/covenant-v3.ts` MUST NOT enter a tag until the
R3 regression goes green (TRACE "Covenant V3" table is the checklist).

**Proven on chain this session (with controls, R2-verified):**
- F12 batch-refund drain: probe 07 flipped CONFIRMED→REFUTED against
  vector-backed V3; control 07c proved single-input refunds still work,
  so the rejection is the input pinning and not a blanket failure.
- F22 cross-Ask claim: probe 08 rejected both the two-senders variant and
  the same-lock-tx variant; all four controls claimed correctly.
- Gate spikes 11/11b/11c pinned opcode BEHAVIOUR (not just existence).

**Built but NOT yet regression-proven:** `covenant-v3.ts`,
`protocol-v3.ts`, `transactions-v3.ts`, `fees-v3.ts`, and the F14
classification fix in `asks-client.ts`. Unit suite 49 green, lint/build
clean. None of it is wired into the running client yet — the app still
creates and reads V2.

**NEXT BLOCK — R3 regression, start it FRESH (do not begin at a session
tail; the suite spends real TKAS and a half-wired run produces an
ambiguous result, which we treat as INCONCLUSIVE, never a pass):**
1. Parameterise `tests/integration/lifecycle.test.ts` over V2/V3, driving
   the REAL client path (covenant-v3 + protocol-v3 + transactions-v3),
   vector-backed via `assertV3VectorMatch`.
2. Run ALL NINE original chain-rejected attacks plus BOTH lifecycles
   against V3 — a green means the rewritten branches reopened nothing.
3. Confirm the V2 lifecycle STILL passes: the client must keep reading
   in-flight V2 Asks even though it will only create V3.
4. The V3 announcement must carry `askId` and `refundAllowance` — without
   both, the §4 escrow rebuild cannot reconstruct the covenant.
5. Then DAA probe 10, regenerate the golden vector, re-tag.
6. Then the harder second audit against the proven baseline.

**Open items that need the Kasia team (Q3), not us:** whether
`tn10.kaspa.stream` and Kasia clients skip the new `r2:` subkind cleanly
or render garbage when they meet 32 raw askId bytes where JSON used to
start. Do NOT claim it skips cleanly until their team confirms. The
namespace itself is still provisional.

**Standing discipline that produced this session's results — keep it:**
every probe needs a POSITIVE CONTROL before its verdict means anything
(spike 11 had none and two of its five results were my own fee bug);
"rejected" without a control is indistinguishable from "my probe is
broken"; SDK/build failures must surface as INCONCLUSIVE, never as a
refutation; and verdicts are written from node-recomputed state, never
from pre-broadcast locals.

### Notes for the session park before that (R7 ritual) — 2026-08-05

**WHERE WE STOPPED — LAUNCH-READY.** Everything is built, verified,
committed, and on origin/main; the app is LIVE at kaskly.app (Render,
auto-deploys on push); the repo is PUBLIC (human flipped it; in-product
"open source" trust links live in footer + landing); all beta posts are
written (BETA.md blurb + the three share-card paste texts); PWA shipped
(installable, SW verified — icons are brand-direction placeholders
pending the human's external assets, regenerate via
scripts/gen-icons.mjs when they land). Nothing in flight, nothing
stashed; local prod server stopped at park.

**THE REMAINING LAUNCH SEQUENCE (all human-led, in order):**
1. Create the Discord beta thread.
2. Render env session: set `NEXT_PUBLIC_FEEDBACK_URL` (thread URL) +
   `NEXT_PUBLIC_BETA_MIN_DEADLINE_SECONDS` (e.g. 120) → auto-rebuild.
3. Witness a full refund cycle ON PROD with the soak chip.
4. Remove the soak flag → auto-rebuild → verify the chip is GONE
   (DEPLOY.md checklist item 1).
5. Phone pass on kaskly.app (incl. PWA Add-to-Home-Screen on Android +
   iOS — full-screen branded launch) + scan a share-card QR end-to-end.
6. Fire the posts (BETA.md blurb into the thread; share cards to X).

~~Also still open (non-blocking, post-beta): Phase 4 gate formalities.~~
RESOLVED 2026-08-04 — see "Phase 4 gate — closure + formal go/no-go"
above: beta clean, checklist items human-confirmed, cold-start check
run + logged, TRACE closed (3 documented exceptions), tagged `phase-4`.

**Session ritual:** read this file + TRACE.md; `npm test` (**26 unit
tests**, sub-second) must be green before new work. Local mirror:
`npm run build && npm start` (prod) or `npm run dev`.
`npm run test:integration` re-proves the TN10 lifecycle+attacks+fees
+rebuild (~3 min, costs a little TKAS). PRIVATE-IDEAS.md is gitignored
and local-only — do not commit it.

**Standing facts:**
- **`spike/.keys.json` is gitignored and holds the FUNDED testnet keys**
  (sender `kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6`,
  balance ≈ 1,985+ TKAS; recipient holds the claimed amounts). Do not
  delete; the integration suite reads it.
- Node.js v24.18.1 system-wide (fresh terminals may still need
  `$env:ProgramFiles\nodejs` on PATH in tool shells).
- Public TN10 wRPC nodes are flaky (connectRpc retries; pin via
  KASPA_WRPC_URL if needed); REST api-tn10.kaspa.org intermittently
  ECONNRESETs from this machine (retry helpers everywhere).
- Vendored SDK: `nodejs/kaspa` AND `web/kaspa` are committed (two
  file: pins); re-extract the release zip for docs/examples.
- Origin: github.com/Kaskly-ask/Kaskly (private). GCM credentials
  stored — non-interactive pushes work.

### Phase 3 checklist (per brief §9)

- [x] Screens S1-S3 wired to `src/lib/ask`: COMPOSE (address/KNS, message,
      amount, deadline picker w/ 7-day default, TESTNET badge, honesty line
      from TRUST.md), INBOX (list + countdown + reply-to-claim), SENT
      (status states + countdown + explorer links to tn10.kaspa.stream)
- [x] Wallet connect per §3.2 (signature-based ownership proof; local key
      generation OK for testnet; keys never server-side)
- [x] Inbox verifies announcement reproduces the funded P2SH (ASKSPEC §4):
      deriveStatusFromChain gates every inbox item (firehose AND cache
      paths); unverified announcements are never surfaced
- [x] Normative client rules live: useAsks auto-broadcasts the sig-less
      refund past deadline (both roles); claimAsk refuses late construction
      (DeadlinePassedError) and the inbox shows the clean "deadline passed"
      state
- [x] DB as cache only + "rebuild from chain" check (§3.3) — INT test
      GREEN on TN10: sender rebuild reconstructs the answered lifecycle
      (claim txid exact) and refunded lifecycle (refund txid exact) from
      the address alone; recipient rebuild recovers the answered ask via
      its reply ref; UI action on Sent does the same drop-and-rebuild
- [x] Input hardening: MAX_MESSAGE_CHARS at textarea+library+codec layers;
      all message/reply text rendered via React text nodes only
      (grep-verified: no dangerouslySetInnerHTML/innerHTML anywhere)
- [x] Human end-to-end test on two real wallets (acceptance) — PASSED
      2026-08-04: full loop, observed refund, late-reply refusal
- [x] TRACE.md S1-S3 rows flipped to verified; committed + tagged
      `phase-3`

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

### 2026-08-03 — Session 2 (Phase 3)

- R7 ritual: read PROGRESS/TRACE/TRUST; `npm test` → **16/16 unit tests
  green** (483ms). Base verified before new work.
- Recorded Phase 3 context (Kaskly branding; logo deferred to external
  assets per mid-session human instruction) and the browser-side
  architecture decision above.
- Phase 3 build begun: web SDK wiring → wallet layer → S1-S3 screens →
  cache/rebuild → hardening.
- Web SDK wiring committed green (see architecture decision above). One
  bundler finding: the web kaspa.js carries wasm-bindgen Node-detection
  shims (dynamic `require(string)`, kaspa.js:14709-14720) that never run
  in a browser but fail Turbopack's static resolution; suppressed with
  `turbopack.ignoreIssue` scoped to `**/vendor/**` (our own code's issues
  still fail the build). Verified `next build` green with the client shell
  importing the SDK.
- Wallet layer + app shell built: browser-only keys (generate /
  import, localStorage `kaskly.wallet.v1`, testnet-only and labeled as
  such in the UI), connect-time signature ownership proof
  (signMessage/verifyMessage, verified from installed kaspa.d.ts:69/74),
  shared chain context (single lazy wRPC connection + 5s DAA-score
  clock), Kaskly header (wordmark placeholder, TESTNET badge, wallet
  panel with balance), dark/teal theme per brief §5, config guard that
  refuses any non-testnet network id (D10/T4).

### Session 2 continued — screens + data layer + rebuild (2026-08-03)

- Prisma 7 finding: the client REQUIRES a driver adapter
  (`@prisma/adapter-better-sqlite3` installed and wired in db.ts; export
  name is `PrismaBetterSqlite3` — lowercase "qlite").
- TN10 REST ground truth (probed with real Phase 2 txids before use, per
  R6): `GET /addresses/{addr}/full-transactions?limit=…&resolve_previous_
  outpoints=light` returns BOTH funding and spending transactions of a
  P2SH address, with payloads and `previous_outpoint_address` resolution —
  this is what makes chain-derived answered/refunded classification and
  the §3.3 rebuild possible without any indexer of our own.
- KNS: endpoint + response shape verified from Kasia source (fetched
  kns-integration-service.ts from GitHub; `{success, data:{owner, asset}}`
  with asset echo check). Implemented in src/lib/kns.ts; documented in
  TRUST.md as a trusted third-party lookup.
- Author-plaintext problem solved Kasia-style: on-chain text is encrypted
  to the counterparty, so the author's own copy (sent message / typed
  reply) is kept in browser localStorage (`src/lib/local-notes.ts`),
  never server-side. Cache DB carries ciphertexts only (D8-safe even with
  a shared localhost server between two test browsers).
- Live UX: block-firehose scanner feeds both roles — recipients see new
  Asks appear (after mandatory §4 verification), senders see "answered"
  arrive in real time with the reply decrypting client-side.
- Dev server left running for the human gate test: http://localhost:3000
  (plus the machine's LAN URL for the second device).

### Queued post-tag work (v1.0 polish — human-approved, NOT gate-blocking)

1. ~~**"Earned" widget**~~ — **SHIPPED 2026-08-04** as the centerpiece of
   the glass header (human pulled it forward into the visual pass).
   Chain-derived: `claimNetSompi` = sum of the claim tx's outputs paying
   the recipient, read from the same REST spender lookup the status
   derivation already does — rebuild-consistent by construction. Ticks
   up (350ms pop, reduced-motion aware) the moment a claim lands.
   (Sender-side "refunded back" total → IDEAS.md.)

### Visual pass — refined glassmorphism (human-directed, 2026-08-04)

Frosted translucent surfaces on the dark ground: `.glass` utility
(white/5 fill, 14px backdrop blur, 1px white/10 edge + inset top-edge
highlight), sticky blurred header that content slides beneath, two fixed
faint teal radial glows behind everything so the blur has depth to catch.
Micro-motion budget: card ease-in 240ms, badge fade 200ms, Earned tick
350ms — all disabled under `prefers-reduced-motion`. Blur is confined to
the header and cards (performance budget); honesty labels stay
high-contrast — the TESTNET badge sits on a SOLID background chip, never
on translucency, and the compose honesty line was bumped a contrast
step. §5's calm voice kept — glass, not disco.

**Glass iteration 2 (2026-08-04, after human review "not landing"):**
root cause confirmed — nothing visible behind the blur. Fixes: ambient
scene made real (four asymmetric teal glows up to 0.28 alpha, one placed
BEHIND the card column; drifting covenant-hex texture layer built from
the actual escrow bytes — `63 00 0f b8` + `ciph_msg:1:ask:` + `64 b0` —
as an SVG tile at 7% opacity, 160s drift, reduced-motion aware); glass
recipe strengthened (inner light gradient white/11→white/4, blur 18px +
saturate(1.4), top-edge highlight white/18, soft drop shadow); header
split to `.glass-deep` (darker tint, MORE translucent, blur 20px).
Verified with in-browser screenshots (claude-in-chrome): backdrop-filter
IS applying — content visibly smears under the sticky header on scroll;
cards read frosted over the glow/texture. Also fixed in review: Earned
flashed 0 on reload while REST derivation settled — now seeded from the
last chain-derived value per address (localStorage, display-only; the
chain remains the only writer). Known dev-only console warning: a
hydration mismatch caused by a browser EXTENSION injecting a
`__processed_*` attribute into <body> (named as a cause in React's own
message) — not our code, absent in clean profiles/production.

**Glass iteration 3 — CLEAR glass (human direction change, 2026-08-04):**
frosted read as gray; the target is a clean pane on a dark desk — seen
THROUGH in the middle, seen AT THE EDGES as light-bending. `.glass-clear`
recipe: fill white/2.5 with NO card blur (the covenant-hex texture and
glow show through clearly); a 1px gradient rim stroke (white/30 at the
top edge and upper corners fading to white/5, drawn via masked padded
pseudo-element so it follows the radius); inner bevel (inset top
highlight + faint inset bottom shadow); a barely-there 112° specular
sheen across the top third. The header alone stays frosted
(`.glass-deep`) — it slides over content, blur is correct there only.
Verified by in-browser screenshot + zoom: texture is legible through the
panel; the rim reads as a lit glass edge. Copy nit noted for later:
"decrypting reply…" on Sent shows during the REST fetch, not decryption.

**Glass iteration 4 — Liquid Glass reference locked (human, 2026-08-04,
iOS screenshot analysis):** panels BRIGHTEN the backdrop instead of
graying it (`brightness(1.18)` + `saturate(1.35)` in a minimal 2px body
blur — hex texture stays readable through the panel); the edge is
refraction, not a border — a 3px masked ring pseudo-element carries its
OWN stronger backdrop-filter (blur 10px, saturate 1.9, brightness 1.4)
so the backdrop visibly smears at the rim, with a crisp 1px stroke on
top (white/30 fading down), radial glints at the top corners, and a 1px
teal chromatic fringe on the right edge; body has a vertical luminosity
gradient + diagonal sheen. Verified by screenshot+zoom against the
locked test ("texture readable through the card AND the rim visibly
bends it") — passing to my eye; human judges against the reference.

**Glass iteration 5 — merged verdict (human, 2026-08-04):** iteration 4's
brightness lift washed out the backdrop (panels read MORE opaque). Merge:
body restored to near-transparent (fill white/3.5→white/2, blur stepped
2px→1px after side-by-side comparison, lift capped at brightness(1.05));
ALL iteration-4 edge work kept (refraction ring, 1px stroke, corner
glints, teal fringe). Verified by same-region zoom comparison: hex
texture reads through the card at iteration-3 clarity with the new edges.
Legibility now rides on content contrast + the solid inner panels, per
the human's rule.

**F10 (gate observation, fixed in this pass) — status/timer precedence:**
countdowns kept ticking on answered/refunded cards, and expiring timers
overwrote terminal states with deadline-passed styling. Fix: terminal
states take absolute precedence — settled cards never render a countdown
and instead show resolution-relative time ("answered 12m ago") derived
from the resolving tx's `block_time` (REST field verified on the real
claim tx 2026-08-04; epoch ms). Deadline-expiry styling now applies only
to awaiting-reply cards. A UI comment marks displayed times as estimates
over the DAA-denominated deadline (ASKSPEC §8 already says so).
2. ~~**Dev-only short deadline chip**~~ — **SHIPPED 2026-08-04**: "2 min
   (testing)" chip in the compose picker, warn-styled, gated on
   `NODE_ENV === "development"` (a compile-time constant in Next.js
   client bundles — production builds statically eliminate it; the
   production minimum stays 1 hour).
3. ~~**Countdown display smoothing**~~ — **SHIPPED 2026-08-04**: the
   countdown ticks locally at 1/s from a chain-synced target; small
   upward corrections are absorbed by HOLDING the display (never ticks
   up), small downward drift catches down at 2/s, and only drift beyond
   60s resyncs visibly. Deadline-passed is never smoothed. Tooltip marks
   times as estimates over the DAA-score deadline. Also fixed the Sent
   copy nit: "decrypting reply…" → "fetching reply from chain…" (the
   wait is the REST fetch, not decryption).

**Glass rendering bug — root-caused and fixed (2026-08-04, human report:
committed refinements not rendering).** Isolation test page (controlled
swatches, screenshot evidence) proved two engine interactions, both in
Chromium (the SAME browser for tester and agent — the automation
extension drives the tester's installed Chrome; the earlier "working"
evidence was over-read from zoomed JPEGs — stroke/glints mistaken for
smear; recorded honestly):
1. `background-attachment: fixed` mispaints on elements that also carry
   `backdrop-filter` → the world-space sheen never rendered as designed.
   Fix: the agreed fallback — SheenController, an rAF-throttled scroll
   listener driving a `--sheen-shift` CSS variable at 15% parallax
   (element-attached gradient, reduced-motion aware).
2. A parent `backdrop-filter` becomes the BACKDROP ROOT: the refraction
   ring pseudo sampled the parent's filtered surface, not the page —
   diluting the edge effect to nothing. Fix: the card body's
   backdrop-filter (blur 1px + 1.05 lift, visually near-nil) removed
   entirely; the ring is now the only backdrop-filter and samples the
   real page. Served-CSS audit also done: no Tailwind/Turbopack purging;
   lightningcss collapses longhands but loses nothing; both
   mask-composite forms served. Fix verified on real cards by zoomed
   screenshots (texture bends in the rim band, crisp in the body; sheen
   paints and drifts). Awaiting the human's fresh-eyes acceptance.

**Post-tag queue COMPLETE (2026-08-04).** Glass refinements (world-space
sheen via background-attachment:fixed — option 1 worked, no fallback
listener needed; refraction ring widened to 5px with harder filter)
approved by the human from zoomed screenshot evidence and committed.
STOPPED here by instruction: final fresh-eyes visual judgment tomorrow,
then Phase 4 on explicit human go (L3).

### Phase 3 gate findings (human end-to-end testing, 2026-08-04)

- **F6 — payload-limit UX + INCONSISTENT LIMIT (fixed).** Mashing a huge
  reply surfaced the raw "payload exceeds 16384 bytes" error. Deeper bug
  found while fixing: the old `MAX_MESSAGE_CHARS = 10,000` (UTF-16) was
  inconsistent with `MAX_PAYLOAD_BYTES = 16,384` — hex encoding doubles
  ciphertext, so 10,000 ASCII chars → ~20.2 KB payload; compose had the
  same latent failure. Fix: `MAX_MESSAGE_BYTES = 7,900` (UTF-8 bytes,
  derived: 2·P + ~410 envelope overhead ≤ 16,384 ⇒ P ≤ 7,987), enforced
  in lib + both screens with live byte counters, over-limit button
  disable, and friendly copy. ASKSPEC §1 corrected (spec/code together,
  P6).
- **F7 — claim fee must scale with transaction mass (fixed, re-proven on
  TN10).** A near-limit reply passed the client size check but the CHAIN
  rejected the broadcast: fixed 500,000-sompi fee vs required 3,080,600
  for "normalized transient mass 30806" (≡ exactly 100 sompi/gram; failing
  txid `1ef4c5fd57ed727dfa8ffa9afad37ed93d11a7894fb0e650c2beb3d910bb8a4b`).
  Fix: `quoteClaimFee` computes the fee from the ACTUAL serialized tx via
  the SDK's `calculateTransactionFee` (verified kaspa.d.ts:201), iterating
  because storage mass depends on output values; floored at the old
  500,000 so short replies (and all Phase 2 evidence) are byte-identical.
  `calculateTransactionFee → undefined` (no standard fee exists, e.g. huge
  reply on tiny Ask) maps to a friendly "reply too long for this Ask's
  amount" error. UI shows a debounced fee/net quote ("Reply & claim ~X"),
  and a backstop translates any residual node fee rejection. ASKSPEC §5.2
  updated (claims MUST fund mass-proportional minimum; refunds are safe
  with the fixed allowance — no payload, constant mass). Re-test GREEN on
  TN10 (tests/integration/fees.test.ts, 3/3): near-limit reply accepted
  with scaled fee, recipient credited exactly amount−fee; long-MESSAGE
  lock also verified (the SDK Generator funds payload mass correctly).
- **F8 — no awareness of new activity (small version shipped).** Refactor:
  the live core (discovery, derivation, auto-refund) moved from the
  per-page hook into an app-wide ActivityProvider, so the §8 auto-refund
  rule now runs whichever screen is open. Shipped: unread badge on the
  Inbox tab (new Asks), on the Sent tab (replies/refunds landed), and a
  document-title count for background tabs; "seen" state in localStorage,
  consumed only while the page is visible. Push notifications (v1.1),
  closed-app watcher tension (non-custodial; KaChat integration argument),
  and the unified Activity feed idea are parked in IDEAS.md.

- **F9 — inbox scannability + management (fixed, two-part; final scope
  per human decisions 2026-08-04).** Part 1 (scannability): message and
  reply text collapse to ~3 lines (CSS line-clamp) with a show more/less
  expander, on both Inbox and Sent. Part 2 (management, un-demoted with
  a safe v1 scope; naming per human revision: "hide", the mechanically
  honest word — nothing is stored anywhere new, a card is purely removed
  from view): Hide buttons appear ONLY on settled cards (answered /
  refunded / expired); live open Asks with claimable funds get NO hide
  affordance at all, so nothing hidden ever holds claimable money.
  Hidden cards move to a collapsed always-recoverable "Hidden (N)"
  section on each screen with an Unhide action; marks are
  localStorage-only (`kaskly.hidden.v1`) — rebuild-from-chain restores
  all data and respects them. The full any-card-with-amount+deadline-
  confirm version remains in IDEAS.md.

### Process note (2026-08-04, R5 violation — recorded per L4/R4 honesty)

While shipping the visible §4 badge, a chained shell command committed and
pushed (`6c8b05b`) even though `next build` had FAILED (missing prop
destructure) — the `;`-chain ignored the build's exit status. The break
was fixed and re-verified green in the immediate next commit (`8a3cd9e`);
main was broken on the remote for ~3 minutes. Corrective rule for future
sessions: never chain `git commit`/`git push` behind test/build steps in
one command — run gates first, inspect, then commit separately.

### R4 self-review (Phase 3: cache/store/S1 unit)

Diff reviewed against [§3.3, §3.2 S1, D2, D6 (KNS), D8, D9 defaults, C4];
deviations:
- Cache API is unauthenticated on localhost — anyone with local access
  could insert rows. Deliberate: the cache is untrusted by design; every
  displayed status is chain-re-derived, unverified inbox items are never
  surfaced, and Sent rows converge to chain truth on the next derivation.
  Reference-client scope, noted here per R1.
- `amount_kas` naming deviation carried from Phase 0 (amountSompi bigint)
  — unchanged.

### R4 self-review (Phase 3: S2/S3/use-asks unit)

Diff reviewed against [S2, S3, A2, A3, A5 client rule, §8 rules 1+2, §4
verification, C4, D8]; deviations:
- Recipient's own past replies are shown from local notes (not decryptable
  from chain by the recipient — they are encrypted to the sender); if
  local notes are cleared, the answered state + explorer link remain but
  not the reply text. Honest limitation of the encryption model, stated in
  TRUST.md.
- Auto-refund attempts are throttled to once per ask per session with
  retry on failure; a competing watcher winning the race is treated as
  success (protocol-correct — F1 mitigation is "anyone closes the door").

### R4 self-review (Phase 3: rebuild unit)

Diff reviewed against [§3.3 rebuild check, §2.3 parsing rules, §4, §7
historical sync]; deviations:
- Recipient-side rebuild recovers answered asks only (lock txs never touch
  the recipient's address; unanswered incoming asks are firehose-only) —
  documented in rebuild.ts and matching the protocol's discovery model.
- History fetch is capped at the REST limit (500 txs, no pagination) —
  sufficient for reference scale; noted as a limitation, logged for
  IDEAS/Phase 4 README.
- Pre-Q4 plaintext-era lifecycle txs (msgEnc "plain") are now malformed
  per §2.3 and correctly SKIPPED by rebuild — only encrypted-era records
  reconstruct. This is spec-conforming behavior, not data loss.

### R4 self-review (Phase 3: web SDK wiring + wallet/shell unit)

Diff reviewed against [D4, D10, T4, §3.2 wallet, §5 design, C4 partial
(explorer URL util)]; deviations:
- Private key persists in browser localStorage so the wallet survives
  reload — acceptable for a TESTNET reference client and stated in the
  wallet panel UI; would be wrong for mainnet (out of scope, D10). TRUST.md
  gets a line when Phase 3 TRUST updates land (hardening unit).
- `turbopack.ignoreIssue` suppresses all diagnostics from vendor/ files
  (path-only match; title-scoped match did not suppress the error) —
  scoped so first-party code issues still fail builds.
- No other deviations; no code maps to no spec ID.

### 2026-08-03 — Session 1 (Phases 0-2, all gates passed)

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
- Recorded Q1 context from the human (KaChat dev conversation — see section above).
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

## Q1 context from the human (recorded 2026-08-03; redacted for the
public repo 2026-08-05 — the original was a private conversation)

The human spoke with a KaChat/Kasia maintainer before Phase 1. Summary
of what shaped the project (paraphrased; no private correspondence
reproduced): the covenant-first direction was received positively, and
their near-term focus is core KaChat features — so nothing here is
blocked on them, and the deliverables were shaped to be self-contained
(spec + working reference + recorded txids).

## Open questions for the human (Section 10)

- Q1: ~~KaChat dev input~~ — answered; recorded above.
- Q3: Final protocol namespace + name (placeholder `ask:1:`) — needed before ASKSPEC.md v0.1 freezes in Phase 2.
- Q4: D7 reply privacy decision — deferred to Phase 2 gate.
- Q5: Open-source license + attribution — needed before Phase 4.

## Blockers

- Node.js installation (user is handling; scaffold + SDK type enumeration wait on this).
