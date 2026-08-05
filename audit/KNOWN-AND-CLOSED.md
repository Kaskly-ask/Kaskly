# KNOWN AND CLOSED — read this FIRST

Findings already discovered in prior internal passes. **These are OUT OF
SCOPE as rediscoveries.** Do not spend budget re-deriving them.

They are in scope in exactly ONE way: **if you can break the FIX** — show a
closed finding is still exploitable despite the patch — that is a
high-value PROVEN finding. Attack the fixes, not the original bugs, and
back it with a passing control per the prime directives.

Status vocabulary: **FIXED** (patched + proven) · **DOCUMENTED** (accepted
or routed, not patched) · **OPEN** (known, unfixed).

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
| **F12** | **CRITICAL.** Refund branch pinned outputs but NOT inputs — N expired covenants of one sender batch-refunded into one output, surplus to the miner. **Proven on chain: 4 KAS locked, 2.995 returned, 0.995 lost.** | **FIXED** — `OpTxInputCount == 1` on the refund branch. Proof: lock `ceb03d9b…`, drain `ab5575a6…` (V2, confirmed); V3 flip `spike/07-batch-refund-drain.cjs` REFUTED; control `spike/07c-v3-refund-control.cjs` accepted `b269d3f2…`, `bf6d0162…` |
| **F13** | **CRITICAL.** Asks between 0.005 and ~0.105 KAS lockable but permanently unspendable — KIP-9 storage mass scales inversely with output value, so the fixed 500k-sompi allowance was insufficient. Verified identical on mainnet and testnet-10. | **FIXED** — per-Ask allowance from a solved fee; `FeeSolveRefusal` refuses rather than guesses. Evidence `audit/verify-refund-mass.cjs`, `tests/unit/fees-v3.test.ts` |
| **F14** | **HIGH.** Status derivation fell through to `refunded` whenever the spender payload was not a matching reply — including when parsing THREW. A garbage-body claim told the sender "every sompi is back in your wallet" while the recipient took the money; rebuild-from-chain reproduced the lie. | **FIXED** — positive refund test (exactly one output, to sender, ≥ minRefund); new terminal state `claimed_unreadable` |
| **F15** | **HIGH.** Firehose reply ingestion sets `answered` from any tx carrying a matching payload, without checking it spent the covenant. | **OPEN** |
| **F16** | **HIGH.** `getCovenantUtxo` returns `entries[0]` unfiltered — one dust payment to the publicly-derivable P2SH jams claim, refund and display. | **OPEN** |
| **F17** | **HIGH.** Unvalidated KNS response redirects the payment; the resolved address is NEVER shown before send (the confirm chip cannot match a `.kas` name). | **OPEN** |
| **F18** | **HIGH.** `/api/asks` POST/DELETE unauthenticated — can hide a real Ask and suppress its auto-refund. | **OPEN** |
| **F19** | **MEDIUM.** No CSP or security headers. | **PARTIAL** — `frame-ancestors 'none'`, `X-Frame-Options: DENY`, Referrer-Policy, nosniff added (F25). **No `script-src`** — still open |
| **F20** | Mis-filed as MEDIUM (DAA constant). **Superseded by F24.** | see F24 |
| **F21** | **MEDIUM.** Refunds paid exactly the floor, handing the miner the whole allowance. | **FIXED** — pays `input − solved fee`; shown on chain (0.999/2.999 vs floors 0.995/2.995) |
| **F22** | **CRITICAL.** Claim branch checked only the 15-byte prefix — one reply payload could claim several senders' Asks. | **FIXED** — per-Ask `askId` at payload[18:50]. Proof `spike/08-cross-ask-claim.cjs`: two-sender and same-lock-tx variants rejected, all four controls accepted |
| **F23** | **MEDIUM.** ASKSPEC/TRUST claimed more than the opcodes enforce. | **FIXED** — corrections in ASKSPEC §0, TRUST.md, design §6/§9 |

## SECOND PASS — the V3 fix's own surface

| Finding | Status |
|---|---|
| **Cross-version claim (CRITICAL).** V2's claim branch checks only `payload[0:15]`, and the V3 header `ciph_msg:1:ask:r2:` BEGINS with those bytes — one V3 payload satisfied a V2 covenant too, so a recipient holding one of each claimed both. | **FIXED** — `OpTxInputCount == 1` on the V3 CLAIM branch. Proof `spike/13-cross-version-claim.cjs`: mixed rejected `53e07c5d…`; controls V2 alone `2ae6e85c…`, V3 alone `6ef24aeb…` |
| **Solver returned its own seed.** `solveRefundFee` returned `guess`, so the fee was always 100,000 and the "per-Ask" allowance a constant 400,000. | **FIXED** — descends to the true minimum (79,600 / 318,400) |
| **Solver priced the wrong shape.** Sigscript template hardcoded at 117 bytes (V2) against a real 169, then 172. | **FIXED** — `V3_REFUND_SIGSCRIPT_BYTES`, asserted against the golden vector |
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
