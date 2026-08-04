# Covenant V3 — revision design (F12, F22, F20, F21, F13)

**Status: DESIGN + VERIFICATION SPIKES ONLY. No V3 script authored. No
covenant file touched.** Date 2026-08-04. Human decisions of this session
are folded in and marked **[HUMAN]**.

One covenant change covering every script-level defect: each change alters
the redeem script → alters every P2SH address → forces a version bump.
Batching means one break, one re-tag, one re-proof campaign.

---

## 0. Opcode inventory (read from the pinned SDK, not from memory)

Present in `vendor/kaspa-wasm32-sdk/nodejs/kaspa/kaspa.d.ts`:
`OpTxInputCount` 179, `OpTxOutputCount` 180, `OpTxPayloadSubstr` 184,
`OpTxInputIndex` 185, `OpOutpointTxId` 186, `OpOutpointIndex` 187,
`OpTxInputAmount` 190, `OpTxOutputAmount` 194, `OpTxOutputSpk` 195.

### ⚠️ HARD GATE [HUMAN] — RESULTS IN (spikes 11 and 11b, 2026-08-04)

The enum proves existence, not behaviour, so nothing could be authored
until this was pinned empirically: a wrong assumption baked into a script
strands funds forever (spike 11 demonstrated exactly that at a cost of
0.5 TKAS — see §11).

**Spike 11b carried a positive control** (plain `<key> OpCheckSig` P2SH
through the identical signing code). It **PASSED**
(`5fd8289c375e79a8074426f91e5792f6d1f88c5f57cb13ce78b0c780ee672c5b`),
which is what makes every other verdict in that run attributable rather
than confounded — spike 11's results were not, and two of its five
attempts turned out to be my own fee bug rather than opcode behaviour.

| Q | Question | Verdict |
|---|---|---|
| Control | Does the harness work? | **PASS** — OpCheckSig, sigscript construction and mass-derived fee solving all sound |
| Q3 | `OpTxPayloadSubstr` on a short payload | **FAIL-CLOSED at `[0:32]`** — self-identifying error `substring [0:32] is out of bounds for string of length 2`; in-bounds extraction also works (Q2's script ran past it). **Scope limit:** this tested offset 0 only. M1 reads `[17:49]`, so this does NOT establish fail-closed at M1's real offset — see §2's explicit length guard and the required Q3b probe. |
| Q4 | Does the F12 floor arithmetic compute *and constrain*? | **CONFIRMED.** Below-floor spend rejected, above-floor accepted (`27f38aebd809b1b424c071726d00afbb94b48808a3a60c7f5578ed49841dacc1`). `OpTxInputAmount` returns usable sompi, `OpTxInputIndex` works in arithmetic position, `OpSub` handles the magnitudes. |
| Q1 | Do introspection opcodes pop an input index? | **Corroborated indirectly.** Spike 11's self-identifying `Number too big: numeric value encoded as [32 bytes] exceeds the max allowed of 8` showed `OpOutpointTxId` consuming a stack value as its index; Q4 then proved the same `OpTxInputIndex`-first convention works for `OpTxInputAmount`. Not confirmed against rusty-kaspa source. |
| Q2 | `OpOutpointTxId` byte order | **UNRESOLVED.** Both orders rejected with `script ran, but verification failed` *despite* the passing control — so the fault is in the outpoint comparison, not the harness. |

**Consequence: M1 is unblocked for authoring, with one probe still owed;
M2 is not available.** M1 needs the F12 floor arithmetic (Q4 ✔) and
`OpTxPayloadSubstr` at offsets 0 and 17. Offset 0 is covered; **offset 17
boundary behaviour still needs Q3b** (payload lengths 16 / 48 / 49), which
must pass before the V3 script is considered proven — though with the
explicit `OpTxPayloadLen` guard in §2, Q3b is about avoiding
false-rejection of valid claims rather than about a bypass. M2 needs Q2,
which remains open. This retires the *authoring* gate for the chosen
design without retiring either open question.

---

## 1. F12 — refund branch drains batched inputs (CRITICAL, proven on chain)

**Change** — in the refund (`OpElse`) branch:

```
  OpTxInputCount, 1, OpNumEqualVerify           # NEW: exactly one input
  ...existing CLTV, OpTxOutputCount==1, output[0].spk == senderSpk...
  0, OpTxOutputAmount,
  OpTxInputIndex, OpTxInputAmount,              # NEW: this input's real amount
  <allowance>, OpSub,                           # NEW: floor = input - allowance
  OpGreaterThanOrEqual
```

**Why it closes it.** The proven attack spends N covenant UTXOs into one
output equal to the largest `minRefund`. `OpTxInputCount == 1` makes that
transaction invalid at every input's script, so no surplus exists to
capture. Deriving the floor from `OpTxInputAmount` additionally closes an
overfunding leak found during design: with a baked `minRefund`, anything
paid into the P2SH above the expected amount currently goes to the miner
on refund.

**Chain proof.** `spike/07-batch-refund-drain.cjs` re-run unchanged must
flip **CONFIRMED → REFUTED**, with `isChainRejection` confirming a real
node rejection. Plus a single-input control (honest refund still works,
R2-verified) and an overfunded-covenant case (surplus returns to sender).

---

## 2. F22 — one payload claims N Asks (CRITICAL [HUMAN]: not Medium)

### Why `OpTxInputCount == 1` on the claim branch is the wrong fix

It works, but permanently forbids the recipient adding their own input to
a claim — foreclosing claim-side fee subsidy, the natural remedy for
F13's claim side, in a script we cannot upgrade without breaking every
address again. Rejected on those grounds.

### The core problem

The natural Ask identifier is the lock txid, which the payload carries as
`ref`. But the P2SH address is derived from the script, the lock pays *to*
that address, so the lock txid cannot exist when the script is built.
Baking `ref` in at derivation time is impossible — which is why the
current script only checks a 15-byte prefix.

### DEFAULT: Mechanism M1 — per-Ask `askId` nonce [HUMAN decision]

Bake a random 32-byte `askId`, generated by the sender at compose time,
into the redeem script as a new parameter, and require it at a fixed
payload offset:

```
OpIf
  0, 17, OpTxPayloadSubstr, <"ciph_msg:1:ask:r:">, OpEqualVerify  # kind = reply
  17, 49, OpTxPayloadSubstr, <askId>, OpEqualVerify               # binds THIS Ask
  <recipientKey>, OpCheckSig
```

Payload layout becomes `ciph_msg:1:ask:r:` (17 bytes) ‖ `<32-byte askId>`
‖ `<JSON envelope as today>`.

**Why it closes the finding.** A transaction has exactly ONE payload. Each
input's script demands that the single payload's fixed 32-byte field equal
*its own* `askId`. Two covenant UTXOs from two different Asks impose
contradictory requirements on the same bytes — unsatisfiable. One reply can
never claim two senders' Asks. Input count stays free, so fee-subsidy
inputs remain possible later.

**Why M1 over M2 [HUMAN].** The correctness argument is one sentence — *a
unique random nonce appears in the script and must appear in the payload* —
and an auditor can verify it without also verifying `OpOutpointTxId`
semantics and byte order. Right before an external audit, trivially
auditable beats elegant. I agree with this call and am not arguing for M2:
its only advantage is avoiding one extra announcement field, which does not
buy enough to widen the audit surface.

**Also fixed free:** checking bytes 0–17 instead of 0–15 pins the subkind
to `r:`, so an `a`-subkind payload can no longer satisfy the claim branch
(one of F14's three routes).

**What it still does not do.** The chain cannot parse or decrypt JSON, so a
claim with a valid header, correct `askId`, and a garbage body remains
chain-valid. That residue is unavoidable at script level — F14's client
fix is **required alongside V3**, not optional.

**Payload length handling — explicit check REQUIRED [HUMAN].** Q3 proved
`OpTxPayloadSubstr` fails closed for `[0:32]` on a 2-byte payload
(`substring [0:32] is out of bounds for string of length 2`). I briefly
concluded from that we could drop the explicit length guard. **That was an
overgeneralisation and is retracted:** M1 extracts the askId at
`[17:49]`, and Q3 tested neither that offset nor the interesting lengths.
Fail-closed at offset 0 is not evidence of fail-closed at offset 17.

The V3 claim branch therefore opens with an explicit guard —
`OpTxPayloadLen` (196, present in the pinned SDK):

```
OpIf
  OpTxPayloadLen, 49, OpGreaterThanOrEqual, OpVerify      # explicit length guard
  0, 17, OpTxPayloadSubstr, <"ciph_msg:1:ask:r:">, OpEqualVerify
  17, 49, OpTxPayloadSubstr, <askId>, OpEqualVerify
  <recipientKey>, OpCheckSig
```

Rationale [HUMAN], and I agree: four opcodes make "a short payload cannot
bypass the askId comparison" a **local, auditable property of this
script**, instead of a claim resting on opcode behaviour an auditor must
independently re-verify. This is the F22 claim branch — a Critical — and
is the wrong place to economise on a security check. The audit-surface
argument that chose M1 over M2 actually *supports* the guard: locality is
what makes M1 easy to audit.

**Still required regardless: probe Q3b for the real offsets.** The guard
protects against the security direction (short payload bypassing the
check). It does not tell us the script behaves correctly at the *in-bounds*
boundary, and getting that wrong strands funds in the opposite direction —
legitimate claims permanently rejected. Q3b must cover payload lengths
**48** (one short: must reject), **49** (exactly enough: must ACCEPT and
claim successfully), and **16** (shorter than even the header). A V3 script
that rejects a valid 49-byte payload would be an F13-class bug wearing an
F22 fix.

### FALLBACK: Mechanism M2 — `OpOutpointTxId` binding (documented, not chosen)

Compare the payload's ref field against `OpTxInputIndex OpOutpointTxId`
(and `OpOutpointIndex`, necessary because two Asks funded by the *same*
lock transaction share a txid — exactly what probe 07 did). Needs no extra
parameter but rests on the unverified semantics above. Kept in the spec as
the documented alternative; the spike runs regardless, since the answer is
useful either way.

### Chain proof — new probe `spike/08-cross-ask-claim.cjs`

1. Two Asks to the same recipient from **two different senders**, both
   open. One claim transaction spending both covenant UTXOs with one reply
   payload → **must be chain-rejected**.
2. Same, with both Asks funded by **one lock transaction** → must also be
   rejected (this is the case that proves the identifier is per-Ask, not
   per-funding-tx).
3. Control: each Ask claimed separately still succeeds, R2-verified.
4. Negative control: a claim whose payload carries a *different* Ask's
   `askId` is rejected.

---

## 3. F13 (covenant side) — fixed allowance strands small Asks

**Change.** `REFUND_FEE_ALLOWANCE` stops being a global constant and
becomes a **per-Ask parameter** computed at creation from real mass. No new
script structure is needed: the allowance only enters through the refund
floor, which F12's change already rewrites.

Client companion (same release): solve the fee fixed point before locking
and **refuse** any amount that cannot be served — replacing the
`amount <= 500_000` guard at `node.ts:110`, which is ~20× too low.

### ⚠️ HARD REQUIREMENT [HUMAN]: non-convergence MUST refuse, never fall back

Measured this session against the pinned SDK (analysis reproduced in
§6). At **0.1 KAS the iteration does not converge** — it climbs
153,500 → 155,800 → 158,200 → 160,700 → 163,300 with *growing*
increments, so there is no fixed point. At **0.05 KAS** mass exceeds the
standard limit and no valid fee exists at all.

The implementation MUST treat non-convergence as "refuse this amount".
Using the last iterate would produce a covenant whose refund is
unbroadcastable — reintroducing F13 inside the F13 fix.

**This is a test, not a comment [HUMAN].** `spike/09-small-ask-floor.cjs`
must include an explicit **0.1 KAS case asserting the client refuses to
construct**, alongside: below-floor refusal, just-above-floor lock→refund
success with R2 verification, and a deliberately under-allowanced covenant
whose refund is chain-rejected (proving the failure mode still exists for
anyone ignoring the rule).

---

## 4. F21 — every refund overpays the miner ~425,900 sompi

**Change.** No script change beyond F12's floor rewrite. The covenant
already permits paying the sender *more* than the floor
(`OpGreaterThanOrEqual`); the client stops paying exactly the floor and
pays `inputAmount − actualComputedFee` instead. The waste is purely
client-side: `transactions.ts:199` hardcodes the output to `minRefund`.

**Chain proof.** Folded into F12's single-input control: R2 recomputation
must show the sender receiving `inputAmount − actualFee`, with the measured
fee at the network minimum (74,100 sompi) rather than the 500,000
allowance.

---

## 5. F20 — `DAA_PER_SECOND = 10n` measured on TN10 only

**Not a script change.** `deadlineDaa` is already a parameter; the defect is
how the client computes it. Replace the constant with a measurement —
sample `virtualDaaScore` twice a few seconds apart (or read target BPS) at
compose time. `currentDaaScore` is already called at that call site
(`ask/page.tsx:110`), so it costs one extra round trip.

**Chain proof.** `spike/10-daa-rate.cjs` measures observed DAA/s on TN10
and asserts the derived deadline lands within tolerance of the intended
wall-clock duration; re-run read-only on mainnet before validation.

---

## 6. Allowance margin — recommendation with numbers [answers open Q3]

Measured (testnet-10; mainnet figures were byte-identical in the F13
verification):

| amount | solved fee | note |
|---|---|---|
| 0.05 KAS | none | mass over standard limit |
| 0.10 KAS | none | **does not converge** (increments grow) |
| 0.105 KAS | 91,500 | converges |
| 0.15 KAS and above | 74,100 | flat — storage mass no longer dominant |

Because the fee is flat above ~0.15 KAS, **the maximum skim is a constant
`74,100 × (margin − 1)` sompi regardless of Ask size**, so its
*proportional* cost is worst at the smallest allowed Ask:

| margin | allowance | max skim | as % of a 0.2 KAS Ask | as % of 1 KAS | fee-rate rise tolerated |
|---|---|---|---|---|---|
| 2× | 148,200 | 0.00074 KAS | 0.37% | 0.074% | 2× |
| **4×** | **296,400** | **0.0022 KAS** | **1.11%** | **0.22%** | **4×** |
| 8× | 592,800 | 0.0052 KAS | 2.59% | 0.52% | 8× |
| 16× | 1,185,600 | 0.0111 KAS | 5.56% | 1.11% | 16× |

"Max skim" is what a hostile refunder can withhold: anyone may trigger the
refund, and a griefer can pay only the floor and let the difference go to
the miner. They gain nothing — it is pure griefing — but the sender loses
it.

**Recommendation: margin 4×, with a minimum Ask of 0.5 KAS.**

- 4× tolerates the network minimum fee rate quadrupling (100 → 400
  sompi/gram) after lock before a refund becomes unbroadcastable.
  Stranding is the severe failure; skim is bounded and recoverable-ish.
- At a 0.5 KAS minimum, worst-case skim is 0.44% and typical Asks (≥1 KAS)
  see ≤0.22%. At a 0.2 KAS minimum, 4× costs 1.11% — tolerable but
  noticeably worse, which is why I pair the margin with the higher floor.
- 8×/16× buy rate tolerance that history does not obviously demand, at
  2.6–5.6% worst-case skim. Note the asymmetry: a fee-rate spike is
  *temporary* (a refund can be broadcast later when rates fall, since the
  covenant has no expiry), whereas skim is immediate and permanent. That
  asymmetry argues against buying large rate tolerance with skim.
- 0.5 KAS also sits comfortably clear of the 0.105–0.15 KAS band where
  fees are elevated and the fixed point is fragile.

### Correction to my own earlier claim

In the draft I said a bigger margin would *lower* F13's floor. **That is
wrong**, and the math above is why: the floor is set by whether a fixed
point exists at all, which depends only on the amount, not on the
allowance. A larger allowance actually *raises* the practical minimum,
since the allowance is a bigger share of a small Ask. Recorded so the
error does not survive into implementation.

---

## 7. Interactions

- **F21 ↔ F13.** Storage mass scales inversely with output value, so
  paying the true (smaller) fee makes the output larger and the required
  fee smaller. The fixes cooperate — but only through the fixed point,
  which must refuse on non-convergence (§3).
- **F12 ↔ F13.** `OpTxInputCount == 1` forecloses funding a refund's fee
  from an external input, an alternative F13 remedy. Deliberate trade: the
  drain is proven and costly, the external-funding remedy is hypothetical,
  and the per-Ask allowance solves F13 without it.
- **F12 ↔ F21.** Deriving the floor from `OpTxInputAmount` is what makes
  F21 safe: against a baked constant, a client paying "the true fee" on an
  overfunded covenant could drop below the pinned floor and produce an
  unbroadcastable refund.
- **F22 ↔ F14.** M1 kills the `a`-subkind route, but a garbage JSON body
  stays chain-valid. F14's client fix ships with V3 or neither is complete.
- **F22 ↔ Kasia interop.** M1 changes the reply payload layout (fixed
  32-byte field before the JSON). Kasia-visible; belongs in the Q3
  conversation with their team.

## 8. What this breaks

New redeem script → every P2SH address changes; V2 and V3 cannot mix. The
golden vector in `tests/unit/covenant.test.ts` is invalidated by design and
must be regenerated. Payload layout changes → version bump. In-flight V2
Asks keep working under old rules, so the client must continue to *read* V2
while creating only V3; migration note required in ASKSPEC.

## 9. Re-proof gate before any re-tag

1. Spikes 11/11b (opcode semantics) report verdicts — **gate on
   authoring**. DONE: control PASS, Q4 CONFIRMED, Q3 partial (offset 0),
   Q2 unresolved (M2 only).
1b. **Spike 11c / Q3b** — `OpTxPayloadSubstr` at `[17:49]` with payload
   lengths 16, 48 (must reject) and 49 (must ACCEPT), against a script
   carrying the `OpTxPayloadLen` guard. Guards against the opposite
   stranding bug: valid claims rejected.
2. Probe 07 flips CONFIRMED → REFUTED.
3. New probe 08 rejects both cross-Ask variants, passes both controls.
4. New probes 09 (incl. the 0.1 KAS refusal assertion) and 10 pass.
5. The full existing R3 attack suite re-runs green against V3 — nine
   chain-rejected attacks plus both lifecycles, R2 dual-verified.
6. Golden vector regenerated; unit suite, lint, build clean.
7. ASKSPEC, TRUST.md and the UI honesty strings updated to describe what
   V3 actually enforces; correction notices moved from "being designed" to
   what shipped.

## 11. Cost of the gate — stranded probe funds (testnet)

Three probe P2SH addresses hold TKAS that cannot currently be swept:

- spike 11 `implicit-form` (0.5 TKAS) — **permanently unspendable**. Its
  script pushes 32 bytes then asks `OpOutpointTxId` to read them as an
  index, which fails identically for every possible spend.
- spike 11 `index-form` (0.5 TKAS) and spike 11b `outpoint` (0.5 TKAS) —
  recoverable only if Q2 is ever answered, since a valid spend requires
  knowing what `OpOutpointTxId` actually pushes.

Testnet funds only, and the funded wallet is comfortable. Recorded because
it is a live, small-scale instance of precisely the failure this gate
exists to prevent: an unverified opcode assumption baked into a script,
stranding funds forever. It cost 0.5 TKAS here instead of every V3 Ask.

## 10. Remaining open question

**Version marker:** new namespace (`ciph_msg:1:ask2:`) or an envelope
version field? Q3 territory, and it touches the Kasia conversation. Note
M1 already forces a payload layout change, so the marker decision should be
made in the same breath.
