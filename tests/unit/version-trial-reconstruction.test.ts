// PHASE 0 — committed FAILING, before trial reconstruction exists.
//
// THE PROPERTY: which covenant the client uses must be decided by TRIAL
// MATCH against the funded address, never by a stored `protocolVersion`
// field. A field can be flipped; a funded P2SH cannot.
//
// WHY THIS IS THE REAL SAFETY PROOF. The wiring in e493dbf stores the
// version in AskRecordDto and in the cache DB, and `covenantFor` branches
// on it. That does not remove the trust in a version claim — it RELOCATES
// it from the indexer to the cache, which F18 leaves unauthenticated. A
// hostile POST flipping `protocolVersion` on a real V3 record makes
// `covenantFor` derive the V2 address, so §4 finds no UTXO, the row is
// filtered from both screens, and maybeAutoRefund no-ops against an
// address that was never funded. Denial, triggered by a field.
//
// Trial reconstruction removes the field from the trust path: derive both
// candidates, keep whichever matches the funded address, fail closed if
// neither does. The stored version survives only as a PERFORMANCE HINT
// (try-hinted-first), never as authority.
//
// EXPECTED STATE WHEN COMMITTED: the "version lie" test FAILS, because the
// current code returns the V2 address for a lied record. It fails on an
// ADDRESS COMPARISON — not a missing symbol, not a setup error — so the
// failure is evidence of the defect rather than of a broken harness.
import { describe, it, expect } from "vitest";
import { payToAddressScript, type IUtxoEntry } from "kaspa-wasm";
import { covenantFor, type CovenantView } from "../../src/lib/asks-client";
import { prepareAskV3 } from "../../src/lib/ask/node-v3";
import { DAA_ANCHORS } from "../../src/lib/ask/daa-guard";

const NETWORK_ID = "testnet-10";
const ADDR = "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6";
const ANCHOR = DAA_ANCHORS[NETWORK_ID];

// Live-magnitude values (anti-fixture rule): 9-digit DAA, real 7-day span.
const NOW_MS = ANCHOR.observedAtMs + 86_400_000;
const CURRENT_DAA = ANCHOR.daaScore + BigInt(86_400 * ANCHOR.ratePerSecond);
const DEADLINE = CURRENT_DAA + BigInt(7 * 86_400 * ANCHOR.ratePerSecond);
const AMOUNT = 100_000_000n;
const ASK_ID = "3f".repeat(32);

const utxoTemplate = (amount: bigint) =>
  ({
    address: ADDR,
    outpoint: { transactionId: "aa".repeat(32), index: 0 },
    amount,
    scriptPublicKey: payToAddressScript(ADDR),
    blockDaaScore: 1n,
    isCoinbase: false,
  }) as unknown as IUtxoEntry;

/** The address a genuine V3 Ask with these parameters is funded at. */
const prepared = prepareAskV3({
  networkId: NETWORK_ID,
  senderAddress: ADDR,
  recipientAddress: ADDR,
  amount: AMOUNT,
  message: "trial reconstruction check",
  deadlineDaa: DEADLINE,
  currentDaa: CURRENT_DAA,
  nowMs: NOW_MS,
  askIdHex: ASK_ID,
  utxoTemplate,
});
const FUNDED_V3_ADDRESS = prepared.p2shAddress;

/** The chain oracle trial reconstruction needs: "is this the funded one?".
 * Injected so the property is testable without a live node. Counts calls,
 * so the cost bound is asserted rather than assumed. */
function makeLookup(fundedAddress: string) {
  const tried: string[] = [];
  return {
    tried,
    fn: async (p2sh: string) => {
      tried.push(p2sh);
      return p2sh === fundedAddress;
    },
  };
}

/** Call shape for trial reconstruction. Cast so this file compiles both
 * BEFORE the second parameter exists (current code ignores it and branches
 * on the stored field → returns V2 → the test fails on the address) and
 * AFTER it lands. Without the cast this would be a compile error, and a
 * compile error is a broken test, not a proof. */
const resolve = covenantFor as unknown as (
  record: unknown,
  isFunded?: (p2sh: string) => Promise<boolean>
) => Promise<CovenantView>;

/** A genuine V3 record, except the version field says v1 — the flip a
 * hostile unauthenticated cache write (F18) can perform today. */
const liedRecord = {
  senderAddress: ADDR,
  recipientAddress: ADDR,
  amountSompi: AMOUNT.toString(),
  deadline: DEADLINE.toString(),
  protocolVersion: 1 as const, // THE LIE
  askId: ASK_ID,
  refundAllowance: prepared.refundAllowance.toString(),
};

const honestRecord = { ...liedRecord, protocolVersion: 2 as const };

describe("version resolution must come from the chain, not from a field", () => {
  it("CONTROL: an honest V3 record resolves to the funded V3 address", async () => {
    const lookup = makeLookup(FUNDED_V3_ADDRESS);
    const cov = await resolve(honestRecord, lookup.fn);
    expect(cov.p2shAddress).toBe(FUNDED_V3_ADDRESS);
  });

  it("a flipped protocolVersion CANNOT change the covenant that is used", async () => {
    // The record is genuinely V3 and genuinely funded at the V3 address.
    // Only the field lies. Resolution must follow the chain.
    const lookup = makeLookup(FUNDED_V3_ADDRESS);
    const cov = await resolve(liedRecord, lookup.fn);
    expect(
      cov.p2shAddress,
      "a stored protocolVersion decided the covenant — flip the field and the " +
        "client queries an address that was never funded (F18 → denial)"
    ).toBe(FUNDED_V3_ADDRESS);
  });

  it("fails closed when NEITHER candidate matches the funded address", async () => {
    const lookup = makeLookup("kaspatest:pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq");
    await expect(
      resolve(honestRecord, lookup.fn),
      "an unmatchable record must be refused, never silently resolved"
    ).rejects.toThrow();
  });

  it("COST BOUND: an honest record costs ONE candidate query (hint-ordered)", async () => {
    const lookup = makeLookup(FUNDED_V3_ADDRESS);
    await resolve(honestRecord, lookup.fn);
    expect(
      lookup.tried.length,
      "the stored version is a HINT: a correct hint must avoid the second derivation"
    ).toBe(1);
  });

  it("COST BOUND: a record with no V3 params never derives a V3 candidate", async () => {
    // Cheap precondition — V3 is not constructible without askId AND
    // refundAllowance, so a flood of junk cannot cost two derivations each.
    const v2Only = {
      senderAddress: ADDR,
      recipientAddress: ADDR,
      amountSompi: AMOUNT.toString(),
      deadline: DEADLINE.toString(),
      protocolVersion: 1 as const,
      askId: null,
      refundAllowance: null,
    };
    const lookup = makeLookup("kaspatest:pqnomatchnomatchnomatchnomatchnomatchnomatchnomatchnomatchnomatch");
    await expect(resolve(v2Only, lookup.fn)).rejects.toThrow();
    expect(lookup.tried.length).toBeLessThanOrEqual(1);
  });
});
