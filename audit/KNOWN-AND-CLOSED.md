# KNOWN AND CLOSED — read this FIRST

Findings already discovered in prior internal passes. **These are OUT OF
SCOPE as rediscoveries.** Do not spend budget re-deriving them.

They are in scope in exactly ONE way: **if you can break the FIX** — show a
closed finding is still exploitable despite the patch — that is a
high-value PROVEN finding. Attack the fixes, not the original bugs, and
back it with a passing control per the prime directives.

Status vocabulary: **FIXED** (patched + proven **and reachable from the
shipping client**) · **FIXED-BUT-UNREACHABLE** (the fix is proven correct
in isolation but the app never executes it — **the original defect is LIVE**)
· **DOCUMENTED** (accepted or routed, not patched) · **OPEN** (known,
unfixed).

---

## 🔴 CORRECTION, 2026-08-05 — AN EARLIER VERSION OF THIS FILE WAS WRONG

The first version of this document marked F12, F13, F21 and F22 as
**FIXED**, with chain-proof txids and no qualifier. **That was misleading
and it was written by the same assistant that wrote the fixes.**

The fourth internal pass caught it — two independent agents converged:
**the entire V3 hardening branch is unreachable from the shipping client.**
`src/lib/ask/index.ts` exports only `protocol / covenant / crypto /
transactions / node` — all V2. `sendAsk` (`src/lib/asks-client.ts:284`)
calls `createAsk`, the V2 builder. No `*V3` symbol has a production caller
outside the two ingest sites in `activity.tsx` / `ask-record.ts`.

The recorded txids are real and the V3 covenant genuinely behaves as
claimed. **They prove the covenant works; they do not prove anyone can
reach it.** On this tag the shipped path still creates V2, so the original
Criticals are LIVE. `PROGRESS.md` said so ("None of it is wired into the
running client yet"); this file, which is what an auditor reads first, did
not. That gap is the defect.

Quantified on the shipped V2 builder by the fourth pass: sweeping
600,000 → 10,500,000 sompi, **97 of 100 accepted amounts are unrefundable**
(0.006–0.102 KAS) — F13 is live in production, guarded only by prose.

---

## 📌 OPEN-POST-WIRING — defects that OUTLIVE the V3 migration

Recorded separately and deliberately. These live **below** the covenant
layer, wiring V3 does not touch any of them, and every one is exactly the
kind of item that gets quietly absorbed into a big migration and never
looked at again. They get their own pass AFTER the wiring lands. None may
be marked closed by the wiring work.

All four were PROVEN by the fourth internal pass with passing controls.

| ID | Defect | Why the migration will not fix it |
|---|---|---|
| **OPW-1** | **Unauthenticated POST rewrites the displayed MESSAGE of a chain-verified Ask.** `deriveStatusFromChain` re-verifies sender/recipient/amount/deadline/lockTxid against chain state, but **never `messageCiphertext`** — so a swapped message keeps `verification: "ok"` and the inbox paints "✓ escrowed" over it. Because `encryptKasia1` is a public-key operation and the recipient's x-only key comes from their address, an unauthenticated attacker crafts a blob decrypting to text of their choosing. PoC drove this against a live server: attacker-chosen phishing text under the verified badge. | The migration changes which covenant is built; it does not add auth to `/api/asks`, and it does not bring `messageCiphertext` under chain verification. Extends known-OPEN **F18** from "hide + suppress refund" to **positive content injection**. |
| **OPW-2** | **A single REST indexer is the sole authority for every settled verdict.** Once the covenant UTXO is gone, the funding fact, spender identity, payload, outputs and block time all come from one unauthenticated host, never cross-checked against wRPC. `RestTxLite.is_accepted` is **declared and never read**. PoC: a hostile indexer produced `refunded` on a real claim (the exact F14 lie through a different door), inflated "Earned" to 9,999 KAS, and made an Ask vanish. | V3 changes the covenant, not the verdict pipeline. `deriveStatusFromChain` reads REST identically for V2 and V3. |
| **OPW-3** | **50 dust payments evict the rebuild window.** `asks-client.ts` requests `full-transactions?limit=50` with no pagination, and BOTH load-bearing predicates (`funded`, `spender`) must find their rows inside it. Results are newest-first (confirmed against the live indexer), the covenant P2SH is publicly derivable, and anyone may pay to it. PoC: 50 dust rows → `rebuildFromChain` returns `[]`, i.e. **the designated recovery action loses the Ask**. | Distinct mechanism from known-OPEN **F16** (which jams `getCovenantUtxo`); this evicts the REST window and takes recovery with it. The window is version-agnostic. |
| **OPW-4** | **Any RPC error string permanently suppresses auto-refund for the session.** `isChainRejection` matches the bare substring `"RPC Server (remote error)"`, which every remote failure carries; `maybeAutoRefund` converts it to `return null` — the same value meaning "someone else already refunded" — and `activity.tsx` marks the ask attempted BEFORE awaiting, rolling back only in `catch`. `null` does not throw. PoC: attempt 1 attempted, attempts 2–3 skipped, never retried until reload. | The suppression is in the auto-refund effect, untouched by V3. Worse after wiring, not better: the failure it silences is exactly the stranded-refund case. |

**Fix sketches** (not started): OPW-1 authenticate writes or stop rendering
cached messages under a verified badge; OPW-2 re-fetch the spender by txid
over wRPC and require `is_accepted`; OPW-3 paginate until the lock txid is
found and distinguish "no spender" from "window exhausted"; OPW-4 narrow
`isChainRejection` to genuine double-spend rejections and rethrow otherwise.

Two smaller items from the same pass, also outliving the migration:
`use-hidden.ts` claims "nothing hidden ever holds claimable money" while
`expired_pending_refund` is hideable; and `tests/unit/wallet-import.test.ts`
is flaky ~1 run in 32 (a random address ending in `x` makes the "altered"
address identical), which trains people to re-run a blocking money-adjacent
gate rather than investigate.

---

## 🧭 STANDING RULE — do not prove code against the fixture it came from

Three separate versions of the same defect shipped because a measurement
taken from a fixture was hardcoded, and then asserted against **that same
fixture**:

- V2 sig script measured at 117 → wrong once V3 existed;
- V3 measured at 172 from the golden vector's 3-byte deadline → wrong for
  every 9-digit production DAA;
- each time, the anti-drift test asserted against the vector that produced
  the number, so it was **blind by construction**.

**Any proof that asserts against a fixture the code was derived from is not
a proof.** For the V3 wiring re-proof this is binding: the end-to-end
create→lock→claim→refund run must use **live-chain values** — real DAA
magnitudes, real deadlines, real funded amounts — not golden-vector values.
The golden vector is for detecting drift in the script bytes. It is not
evidence that anything works.

---

## ⚠️ Framing this document must not let you forget

Every finding below was found by the SAME CLASS OF REASONER as you, and
every fix below was written by it too — several under time pressure, in
one long session. Three prior passes each found real defects in the
previous pass's work, **including in its fixes**. The fourth pass finding
nothing in eight fresh fixes would be the surprising result, not the
reassuring one.

---

## FIRST PASS — mainnet-eyes review (F12–F23)

| ID | Finding | Status |
|---|---|---|
| **F12** | **CRITICAL.** Refund branch pinned outputs but NOT inputs — N expired covenants of one sender batch-refunded into one output, surplus to the miner. **Proven on chain: 4 KAS locked, 2.995 returned, 0.995 lost.** | **FIXED-BUT-UNREACHABLE** — `OpTxInputCount == 1` on the refund branch. ⚠️ **NOT WIRED — the app still creates V2, so the original defect is LIVE on this tag (see CORRECTION above).** Proof: lock `ceb03d9b…`, drain `ab5575a6…` (V2, confirmed); V3 flip `spike/07-batch-refund-drain.cjs` REFUTED; control `spike/07c-v3-refund-control.cjs` accepted `b269d3f2…`, `bf6d0162…` |
| **F13** | **CRITICAL.** Asks between 0.005 and ~0.105 KAS lockable but permanently unspendable — KIP-9 storage mass scales inversely with output value, so the fixed 500k-sompi allowance was insufficient. Verified identical on mainnet and testnet-10. | **FIXED-BUT-UNREACHABLE** — per-Ask allowance from a solved fee; ⚠️ **NOT WIRED — the app still creates V2, so the original defect is LIVE on this tag (see CORRECTION above).** `FeeSolveRefusal` refuses rather than guesses. Evidence `audit/verify-refund-mass.cjs`, `tests/unit/fees-v3.test.ts` |
| **F14** | **HIGH.** Status derivation fell through to `refunded` whenever the spender payload was not a matching reply — including when parsing THREW. A garbage-body claim told the sender "every sompi is back in your wallet" while the recipient took the money; rebuild-from-chain reproduced the lie. | **FIXED** — positive refund test (exactly one output, to sender, ≥ minRefund); new terminal state `claimed_unreadable` |
| **F15** | **HIGH.** Firehose reply ingestion sets `answered` from any tx carrying a matching payload, without checking it spent the covenant. | **OPEN** |
| **F16** | **HIGH.** `getCovenantUtxo` returns `entries[0]` unfiltered — one dust payment to the publicly-derivable P2SH jams claim, refund and display. | **OPEN** |
| **F17** | **HIGH.** Unvalidated KNS response redirects the payment; the resolved address is NEVER shown before send (the confirm chip cannot match a `.kas` name). | **OPEN** |
| **F18** | **HIGH.** `/api/asks` POST/DELETE unauthenticated — can hide a real Ask and suppress its auto-refund. | **OPEN** |
| **F19** | **MEDIUM.** No CSP or security headers. | **PARTIAL** — `frame-ancestors 'none'`, `X-Frame-Options: DENY`, Referrer-Policy, nosniff added (F25). **No `script-src`** — still open |
| **F20** | Mis-filed as MEDIUM (DAA constant). **Superseded by F24.** | see F24 |
| **F21** | **MEDIUM.** Refunds paid exactly the floor, handing the miner the whole allowance. | **FIXED-BUT-UNREACHABLE** — pays `input − solved fee`; ⚠️ **NOT WIRED — the app still creates V2, so the original defect is LIVE on this tag (see CORRECTION above).** shown on chain (0.999/2.999 vs floors 0.995/2.995) |
| **F22** | **CRITICAL.** Claim branch checked only the 15-byte prefix — one reply payload could claim several senders' Asks. | **FIXED-BUT-UNREACHABLE** — per-Ask `askId` at payload[18:50]. ⚠️ **NOT WIRED — the app still creates V2, so the original defect is LIVE on this tag (see CORRECTION above).** Proof `spike/08-cross-ask-claim.cjs`: two-sender and same-lock-tx variants rejected, all four controls accepted |
| **F23** | **MEDIUM.** ASKSPEC/TRUST claimed more than the opcodes enforce. | **FIXED** — corrections in ASKSPEC §0, TRUST.md, design §6/§9 |

## SECOND PASS — the V3 fix's own surface

| Finding | Status |
|---|---|
| **Cross-version claim (CRITICAL).** V2's claim branch checks only `payload[0:15]`, and the V3 header `ciph_msg:1:ask:r2:` BEGINS with those bytes — one V3 payload satisfied a V2 covenant too, so a recipient holding one of each claimed both. | **FIXED-BUT-UNREACHABLE** — `OpTxInputCount == 1` on the V3 CLAIM branch. ⚠️ **NOT WIRED — the app still creates V2, so the original defect is LIVE on this tag (see CORRECTION above).** Proof `spike/13-cross-version-claim.cjs`: mixed rejected `53e07c5d…`; controls V2 alone `2ae6e85c…`, V3 alone `6ef24aeb…` |
| **Solver returned its own seed.** `solveRefundFee` returned `guess`, so the fee was always 100,000 and the "per-Ask" allowance a constant 400,000. | **FIXED** — descends to the true minimum. NOTE: the *values* 79,600 / 318,400 come from the golden vector's deadline; at production deadlines the true minimum is 79,700 (see the row below). |
| **Solver priced the wrong shape.** Sigscript template hardcoded at 117 bytes (V2) against a real 169, then 172. | **RE-BROKEN (4th pass, PROVEN).** The constant 172 is correct ONLY for the golden vector's `deadlineDaa = 1000000` (a 3-byte script number). Live TN10 DAA is 9 digits → 4-byte push → real redeem 170 B, sig script **173 B**, so every refund under-pays by 100 sompi (171/171 amounts swept). The anti-drift test asserts against that same vector and is **blind by construction**. The "PARITY with spike/lib.cjs" comment is false — the spike prices the REAL transaction, which is why the chain proofs passed. |
| **Large-amount stranding.** Suspected 4-byte operand limit above 21.475 KAS. | **REFUTED on chain** — `spike/12-large-amount-floor.cjs`: 25 KAS refunded (`4396205b…`), control passed |
| **`amountSompi` announced but never compared to the funded UTXO.** | **OPEN** — field is mandatory, but no production code compares it; the V3 §4 path has no production caller |
| **askId uniqueness rests on sender honesty** — ids are public, duplicates unenforced. | **OPEN** |

## THIRD PASS — below the covenant (F24–F32)

| ID | Finding | Status |
|---|---|---|
| **F24** | **CRITICAL.** An untrusted node's DAA score written verbatim into the covenant CLTV; deploy config leaves the wRPC URL empty so `Resolver()` picks arbitrarily; only bound was 500 billion (~1,585 years). Self-concealing — the countdown reads the same lying node. | **FIXED** — `src/lib/ask/daa-guard.ts`: anchor-projection plausibility check + 90-day bound, both in `prepareAskV3` before the covenant is derived. 11 unit tests, controls first. **Mainnet anchor is an UNVERIFIED-STUB — guard 1 does not protect mainnet** |
| **F25** | **HIGH.** App framable + one-click unconfirmed Disconnect = clickjack destroys the key. | **FIXED** — `frame-ancestors 'none'` + `X-Frame-Options: DENY` + Disconnect confirmation. PoC `scratchpad/clickjack-poc.html` re-run cross-origin: "frame document empty, CLICKJACK BLOCKED" |
| **F26** | **HIGH.** No key export/backup path at all — routine browser actions destroyed funds with no attacker. | **FIXED** — reveal/copy/download; `kaskly.backup.v1` stores addresses+timestamps only; Disconnect warns differently when no backup exists |
| **F27** | **HIGH.** Vendored SDK had no integrity mechanism (recorded hash was of a gitignored zip); SW served the wasm cache-first so one poisoning was permanent. | **FIXED** — `scripts/verify-sdk-integrity.mjs` (per-file pins, in `prebuild`, proven to abort the build on one corrupted byte); SW network-first for the wasm, proven by `audit/sw-poison-poc.mjs` (OLD persists / NEW evicts / offline falls back) |
| **F28** | **MEDIUM.** Ownership "proof" signed and verified with the same key — 500/500 pass, `false` unreachable — while the UI claimed "✓ verified by signature". | **FIXED** — ceremony deleted; `importKey(hex, expectedAddress?)` refuses a mismatch; guard test on comment-stripped source |
| **F29** | **HIGH.** kasia1 has no AAD, so ciphertexts have no context binding — a reply can be replayed as another claim, and a claimant can present prose they cannot read. PoC-proven, incl. against the V3 codec. | **DOCUMENTED / routed** — inherited from upstream Kasia (verified: they also use no AAD). Fixing breaks Kasia wire compat → travels with the Q3 namespace conversation. NOT patched unilaterally |
| **F30** | **HIGH.** A lying node inflates DAA to the recipient, whose client refuses to build a claim the chain would accept. | **OPEN** (same root as F24; the guard bounds creation, not this path) |
| **F31** | **LOW.** Quadratic backtracking in `sanitizeKeyInput`, on every render. | **OPEN** |
| **F32** | **LOW.** Disconnect leaves `kaskly.notes.v1` — plaintext of every message written — behind. | **OPEN** |

Also from the third pass, **held under PoC attack**: no key-extraction path
found; invalid-curve oracle rejected 2,000/2,000; nonce/parity/AEAD/HKDF/
CSPRNG all sound; key never reaches network, URL, storage or SW.

## Deploy-trust residuals (no single code fix closes these)

- **build→browser.** The F27 check protects repo→build. `instantiateStreaming`
  has no SRI equivalent and there is **no runtime hash check before
  `init()`**, so a compromised SERVER can still serve a bad wasm to a fresh
  visitor. Same boundary as F19's missing `script-src`.
- **Offline poison window.** SW falls back to cache when offline, including
  to a poisoned copy.
- **Fee-rate behaviour is reasoned, not chain-demonstrated** — TN10 cannot
  simulate elevated fees (COVENANT-V3-DESIGN.md §10b).
