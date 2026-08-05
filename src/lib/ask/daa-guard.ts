// F24 — bounding what an untrusted node can do to a deadline.
//
// THE DEFECT: `currentDaaScore` returns a wRPC node's `virtualDaaScore`
// verbatim, the compose screen turns it into `deadlineDaa`, and that value
// is written irreversibly into the covenant's CLTV. The only existing
// bound is LOCK_TIME_THRESHOLD (500_000_000_000), which exists to keep the
// value in the DAA threshold class — not to sanity-check a deadline. A
// hostile node reporting 499_000_000_000 produces a covenant locked for
// ~1,585 years, and the countdown reads from the SAME node, so the UI
// still says "7 days". Funds are destroyed, not stolen.
//
// THE DURABLE DEFENCE IS HERE, CLIENT-SIDE. Pinning a trusted node
// (NEXT_PUBLIC_KASPA_WRPC_URL) is defence-in-depth, not the primary fix,
// because config can be overridden and a pinned node can still be wrong.
// These checks hold even when the node lies.
//
// Two independent guards:
//   1. Is the reported DAA score plausible AT ALL, given wall-clock time
//      elapsed since a recorded anchor?
//   2. Is the resulting deadline within a sane maximum (90 days)?
// A hostile score fails (1); a merely-odd score that still yields an
// absurd lock fails (2).

/** A (time, score) anchor observed on this network, plus its rate. The
 * score check is only as good as the anchor, so anchors are RECORDED
 * OBSERVATIONS with provenance — never guesses. */
export interface DaaAnchor {
  /** Wall-clock ms when the score below was observed. */
  observedAtMs: number;
  /** virtualDaaScore observed at that moment. */
  daaScore: bigint;
  /** Observed DAA per second on this network. */
  ratePerSecond: number;
  /** Where this observation came from. */
  source: string;
}

export const DAA_ANCHORS: Record<string, DaaAnchor> = {
  // Measured by spike/10-daa-rate.cjs during the 2026-08-05 session:
  // 9.9268 DAA/s over a 91.3s window, virtualDaaScore 535,051,466 at the
  // end of that window. Rate rounded to the pinned 10 for the band maths.
  "testnet-10": {
    observedAtMs: Date.UTC(2026, 7, 5, 20, 24, 0),
    daaScore: 535_051_466n,
    ratePerSecond: 10,
    source: "spike/10-daa-rate.cjs, 2026-08-05 (9.9268 DAA/s measured)",
  },
  // UNVERIFIED-STUB: no mainnet anchor has been measured. config.ts
  // refuses non-testnet networks today; if that guard is ever lifted, an
  // anchor MUST be measured first — shipping a wrong one would reject
  // every legitimate Ask, or accept a hostile score.
};

/** Widest plausible band around the anchor projection. Deliberately loose:
 * this guard exists to catch a node that is wrong by ORDERS OF MAGNITUDE
 * (the PoC was ~933x), not to police normal variance. A false rejection of
 * a legitimate Ask is the failure mode we care about most. */
export const DAA_BAND_LOW = 0.25; // network could be 4x slower than recorded
export const DAA_BAND_HIGH = 4.0; // or 4x faster
/** Absolute slack, in DAA, for clock skew and short-window jitter.
 *
 * A3 (fourth audit): this was 5,000,000 (~5.8 days), which ALONE turned a
 * 7-day Ask into a 12.8-day lock — an 83% overshoot, invisible because the
 * countdown reads the same node. It is now ~1.16 days, and — more
 * importantly — slack no longer inflates the lock at all, because guard 2
 * measures the deadline against the INDEPENDENT anchor projection rather
 * than against the node's own score. */
export const DAA_SLACK = 1_000_000n;

/** A3: the band is built from time elapsed since the anchor, so it widened
 * without limit — a month past the anchor, an in-band lie already exceeded
 * the 90-day ceiling. Elapsed time is capped, and an anchor older than this
 * is REFUSED rather than trusted with an unbounded band. */
export const MAX_ANCHOR_AGE_SECONDS = 120 * 24 * 60 * 60;

/** Hard maximum lock, in seconds, regardless of what any node says. */
export const MAX_DEADLINE_SECONDS = 90 * 24 * 60 * 60;

export class DaaScoreImplausible extends Error {
  constructor(
    message: string,
    readonly reported: bigint,
    readonly expected: bigint
  ) {
    super(message);
    this.name = "DaaScoreImplausible";
  }
}

export class DeadlineOutOfRange extends Error {
  constructor(
    message: string,
    readonly requestedSeconds: number
  ) {
    super(message);
    this.name = "DeadlineOutOfRange";
  }
}

/**
 * Guard 1 — is this DAA score plausible for this network right now?
 *
 * Projects the anchor forward by elapsed wall-clock time and rejects
 * anything outside a deliberately wide band. THROWS on failure; the caller
 * must treat that as "refuse to build the covenant", never as a warning.
 *
 * Networks with no anchor are NOT silently accepted — an unknown network
 * is exactly where a wrong deadline would be invisible.
 */
export function assertPlausibleDaaScore(
  networkId: string,
  reported: bigint,
  nowMs: number = Date.now()
): bigint {
  const anchor = DAA_ANCHORS[networkId];
  if (!anchor) {
    throw new DaaScoreImplausible(
      `no DAA anchor recorded for network "${networkId}" — refusing to set a deadline from an unvalidated score`,
      reported,
      0n
    );
  }
  const rawElapsedS = (nowMs - anchor.observedAtMs) / 1000;
  if (rawElapsedS > MAX_ANCHOR_AGE_SECONDS) {
    throw new DaaScoreImplausible(
      `the recorded DAA anchor for ${networkId} is ${(rawElapsedS / 86400).toFixed(0)} days old — ` +
        `beyond ${MAX_ANCHOR_AGE_SECONDS / 86400} days the plausible band is too wide to be a guard. ` +
        `Re-measure the anchor (spike/10-daa-rate.cjs) before creating Asks.`,
      reported,
      0n
    );
  }
  const elapsedS = rawElapsedS;
  // Before the anchor (clock skew, or a stale machine): fall back to the
  // anchor itself as the projection rather than going backwards.
  const projected =
    anchor.daaScore +
    BigInt(Math.max(0, Math.floor(elapsedS * anchor.ratePerSecond)));

  const low =
    anchor.daaScore +
    BigInt(Math.max(0, Math.floor(elapsedS * anchor.ratePerSecond * DAA_BAND_LOW))) -
    DAA_SLACK;
  const high =
    anchor.daaScore +
    BigInt(Math.max(0, Math.ceil(elapsedS * anchor.ratePerSecond * DAA_BAND_HIGH))) +
    DAA_SLACK;

  if (reported < low || reported > high) {
    throw new DaaScoreImplausible(
      `node reported DAA score ${reported} for ${networkId}, outside the plausible range ${low}..${high} ` +
        `(projected ~${projected} from ${anchor.source}). Refusing to set a deadline from it — ` +
        `a wrong score here locks funds for as long as the score is wrong.`,
      reported,
      projected
    );
  }
  // Guard 2 needs a reference the NODE did not supply.
  return projected;
}

/**
 * Guard 2 — is the resulting lock within a sane maximum?
 *
 * Independent of guard 1 on purpose: a score that squeaks through the band
 * can still yield an absurd deadline, and a 90-day ceiling is meaningful
 * on its own terms (nobody should lock funds for centuries by accident).
 */
export function assertDeadlineWithinBound(params: {
  /** INDEPENDENT reference from `assertPlausibleDaaScore` — NOT the node's
   * reported score. A3: measuring against the node's own number meant the
   * delta was always the 7 days the client itself chose, so guard 2 could
   * never catch a node lie. Thirty days past the anchor an in-band lie
   * produced a 102-day real lock while guard 2 passed. */
  projectedDaa: bigint;
  deadlineDaa: bigint;
  ratePerSecond: number;
}): void {
  const { projectedDaa: currentDaa, deadlineDaa, ratePerSecond } = params;
  if (deadlineDaa <= currentDaa) {
    throw new DeadlineOutOfRange(
      `deadline ${deadlineDaa} is not after the current score ${currentDaa}`,
      0
    );
  }
  const seconds = Number(deadlineDaa - currentDaa) / ratePerSecond;
  if (seconds > MAX_DEADLINE_SECONDS) {
    throw new DeadlineOutOfRange(
      `deadline is ${(seconds / 86400).toFixed(1)} days away, above the ${MAX_DEADLINE_SECONDS / 86400}-day maximum — refusing to build the covenant`,
      seconds
    );
  }
}
