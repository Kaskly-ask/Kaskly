// F24 — the deadline/score guards.
//
// THE CONTROL MATTERS MOST. A bound that rejects legitimate Asks is a
// worse outcome than the bug it fixes, so the honest-path cases come
// first and are the ones to watch on any future tuning of the band.
import { describe, it, expect } from "vitest";
import { payToAddressScript, type IUtxoEntry } from "kaspa-wasm";
import {
  assertPlausibleDaaScore,
  assertDeadlineWithinBound,
  DaaScoreImplausible,
  DeadlineOutOfRange,
  DAA_ANCHORS,
  MAX_DEADLINE_SECONDS,
} from "../../src/lib/ask/daa-guard";
import { prepareAskV3 } from "../../src/lib/ask/node-v3";

const NET = "testnet-10";
const ANCHOR = DAA_ANCHORS[NET];
const ADDR = "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6";

/** A realistic "now" and the score an honest node would report then. */
const DAY_MS = 86_400_000;
const nowMs = ANCHOR.observedAtMs + 3 * DAY_MS;
const honestScore =
  ANCHOR.daaScore + BigInt(Math.floor((3 * DAY_MS) / 1000) * ANCHOR.ratePerSecond);
/** The hostile score from the F24 PoC. */
const HOSTILE = 499_000_000_000n;

const utxoTemplate = (amount: bigint) =>
  ({
    address: ADDR,
    outpoint: { transactionId: "aa".repeat(32), index: 0 },
    amount,
    scriptPublicKey: payToAddressScript(ADDR),
    blockDaaScore: 1n,
    isCoinbase: false,
  }) as unknown as IUtxoEntry;

const prepare = (currentDaa: bigint, deadlineDaa: bigint) =>
  prepareAskV3({
    networkId: NET,
    senderAddress: ADDR,
    recipientAddress: ADDR,
    amount: 100_000_000n,
    message: "F24 guard check",
    deadlineDaa,
    currentDaa,
    nowMs,
    utxoTemplate,
  });

describe("F24 CONTROL — legitimate Asks must still build", () => {
  it("accepts an honest score with a 7-day deadline", () => {
    const deadline = honestScore + BigInt(7 * 86400 * ANCHOR.ratePerSecond);
    const p = prepare(honestScore, deadline);
    expect(p.p2shAddress).toMatch(/^kaspatest:/);
    expect(p.covenantParams.deadlineDaa).toBe(deadline);
  });

  it("accepts short deadlines (2 minutes) and the 90-day maximum", () => {
    expect(() => prepare(honestScore, honestScore + 1200n)).not.toThrow();
    const at90 = honestScore + BigInt(MAX_DEADLINE_SECONDS * ANCHOR.ratePerSecond);
    expect(() => prepare(honestScore, at90)).not.toThrow();
  });

  it("tolerates a network running well off the recorded rate", () => {
    // The band is deliberately wide: this guard catches orders-of-magnitude
    // lies, not normal variance. Half-speed and double-speed must pass.
    const elapsedS = (nowMs - ANCHOR.observedAtMs) / 1000;
    for (const factor of [0.5, 0.75, 1.5, 2, 3]) {
      const score =
        ANCHOR.daaScore + BigInt(Math.floor(elapsedS * ANCHOR.ratePerSecond * factor));
      expect(() => assertPlausibleDaaScore(NET, score, nowMs), `factor ${factor}`).not.toThrow();
    }
  });

  it("tolerates modest clock skew in either direction", () => {
    for (const skewMs of [-3600_000, 3600_000, -DAY_MS, DAY_MS]) {
      expect(() =>
        assertPlausibleDaaScore(NET, honestScore, nowMs + skewMs)
      ).not.toThrow();
    }
  });
});

describe("F24 — the hostile score is refused before the covenant is built", () => {
  it("rejects the PoC score (499_000_000_000)", () => {
    expect(() => assertPlausibleDaaScore(NET, HOSTILE, nowMs)).toThrow(DaaScoreImplausible);
  });

  it("prepareAskV3 refuses to construct from it", () => {
    // The whole point: no covenant is derived, so nothing can be funded.
    const deadline = HOSTILE + BigInt(7 * 86400 * 10);
    expect(() => prepare(HOSTILE, deadline)).toThrow(DaaScoreImplausible);
  });

  it("rejects a score far BELOW plausible too (a stale or lying node)", () => {
    expect(() => assertPlausibleDaaScore(NET, 1_000_000n, nowMs)).toThrow(DaaScoreImplausible);
  });

  it("refuses networks with no recorded anchor rather than trusting them", () => {
    expect(() => assertPlausibleDaaScore("mainnet", honestScore, nowMs)).toThrow(
      /no DAA anchor/
    );
  });
});

describe("F24 — the deadline bound is independent of the score check", () => {
  it("rejects a lock beyond 90 days even when the score is honest", () => {
    const tooFar = honestScore + BigInt(120 * 86400 * ANCHOR.ratePerSecond);
    expect(() =>
      assertDeadlineWithinBound({
        currentDaa: honestScore,
        deadlineDaa: tooFar,
        ratePerSecond: ANCHOR.ratePerSecond,
      })
    ).toThrow(DeadlineOutOfRange);
    expect(() => prepare(honestScore, tooFar)).toThrow(DeadlineOutOfRange);
  });

  it("rejects a deadline at or before the current score", () => {
    expect(() =>
      assertDeadlineWithinBound({
        currentDaa: honestScore,
        deadlineDaa: honestScore,
        ratePerSecond: 10,
      })
    ).toThrow(DeadlineOutOfRange);
  });

  it("catches the centuries-long lock the PoC produced", () => {
    // Even if a score somehow passed the band, 1,585 years fails here.
    expect(() =>
      assertDeadlineWithinBound({
        currentDaa: 535_000_000n,
        deadlineDaa: 499_006_048_000n,
        ratePerSecond: 10,
      })
    ).toThrow(/above the 90-day maximum/);
  });
});
