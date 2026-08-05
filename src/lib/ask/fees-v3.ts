// V3 refund fee solving (findings F13 and F21).
//
// F13: the V2 code used a FIXED REFUND_FEE_ALLOWANCE of 500,000 sompi and
// claimed a refund's mass was "small and constant". That is false. A
// refund's mass is dominated by KIP-9 STORAGE MASS, which scales INVERSELY
// with the output value — so below roughly 0.105 KAS the required fee
// exceeds the allowance, no valid refund exists, and the funds are
// stranded forever. Measured on both mainnet and testnet-10; see
// audit/verify-refund-mass.cjs and PROGRESS.md F13.
//
// F21: V2 also paid exactly the floor, handing the whole allowance to a
// miner even when the network minimum was ~74,100 sompi. Solving for the
// real fee returns that difference to the sender.
//
// THE HARD RULE (human-approved, COVENANT-V3-DESIGN.md §3): the fee is a
// FIXED POINT — the required fee depends on the output value, and the
// output value depends on the fee. It does not always converge. When it
// does not, this module THROWS. It must never fall back to the last
// iterate: doing so produces an unbroadcastable refund and strands funds,
// which is the very bug being fixed.
//
// PARITY (corrected 2026-08-05, A1): spike/lib.cjs prices the REAL
// transaction it is about to broadcast. This module now does the same via
// `sigScriptBytes` — the earlier claim of parity was false while this file
// priced a constant-sized shape, which is exactly why every chain proof
// passed while the shipped module under-paid.
import {
  calculateTransactionFee,
  createTransaction,
  ScriptBuilder,
  type IUtxoEntry,
} from "kaspa-wasm";
import { buildAskRedeemScriptV3 } from "./covenant-v3";

/** Iteration cap. Reaching it is a REFUSAL, not a result. */
export const FEE_SOLVE_MAX_ITERS = 12;

/** Safety margin over the solved fee when pinning a per-Ask allowance.
 * 4x tolerates the network minimum fee rate quadrupling after lock before
 * a refund becomes unbroadcastable. Because the solved fee is flat
 * (~74,100 sompi) above ~0.15 KAS, the worst-case skim a hostile refunder
 * can withhold is a CONSTANT 74,100 x (margin - 1) — about 0.22% of a
 * 1 KAS Ask at 4x. Larger margins buy rate tolerance we have no evidence
 * of needing, at a proportionally worse skim on small Asks. See
 * COVENANT-V3-DESIGN.md §6. */
export const ALLOWANCE_MARGIN = 4n;

/**
 * Conservative UPPER BOUND on the refund sig script, used only when a
 * caller cannot supply the real figure. Deliberately generous: the two
 * variable pushes (`deadlineDaa`, `refundAllowance`) are at most 9 bytes
 * each including their length prefix, so 180 covers any production Ask.
 * Over-paying a few sompi is recoverable; under-paying strands the funds.
 *
 * Replaces `V3_REFUND_SIGSCRIPT_BYTES = 172`, which was measured from the
 * golden vector's 3-byte deadline and under-priced every real Ask (A1).
 */
export const V3_REFUND_SIGSCRIPT_UPPER_BOUND = 180;

export class FeeSolveRefusal extends Error {
  constructor(
    message: string,
    readonly amountSompi: bigint,
    readonly trace: string[]
  ) {
    super(message);
    this.name = "FeeSolveRefusal";
  }
}

/**
 * Byte length of the REAL sig script `buildRefundTransactionV3` emits for
 * a given Ask: `push(<empty>) ‖ push(redeemScript)`.
 *
 * A1 (fourth audit) — WHY THIS IS A FUNCTION AND NOT A CONSTANT. The
 * redeem script contains two VARIABLE-LENGTH script-number pushes:
 * `addLockTime(deadlineDaa)` and `addI64(refundAllowance)`. The old
 * constant 172 was measured from the golden vector, whose
 * `deadlineDaa = 1_000_000` is a 3-byte number. Live DAA scores are
 * 9 digits — a 4-byte push — so every production refund was priced 1 byte
 * short and under-paid by 100 sompi. The anti-drift test asserted against
 * that same vector, so it could never catch it.
 *
 * The measurement is deliberately biased UPWARD: over-estimating costs a
 * few sompi of fee, under-estimating produces an unbroadcastable refund.
 */
export function refundSigScriptBytes(params: {
  deadlineDaa: bigint;
  refundAllowance: bigint;
  recipientXOnlyHex: string;
  senderAddress: string;
}): number {
  // askId is a FIXED 32 bytes, so its value cannot change the measurement —
  // only the two variable-length numeric pushes can.
  const redeem = buildAskRedeemScriptV3({ ...params, askIdHex: "00".repeat(32) });
  const sig = new ScriptBuilder()
    .addData(new Uint8Array(0))
    .addData(Buffer.from(redeem.toString(), "hex"))
    .drain();
  return sig.length / 2;
}

export interface RefundFeeSolution {
  /** Fee the refund should actually pay (F21: not the whole allowance). */
  fee: bigint;
  /** Per-Ask covenant allowance = fee * ALLOWANCE_MARGIN (F13). */
  allowance: bigint;
  iterations: number;
  trace: string[];
}

/**
 * Solve the refund fee for an Ask of `amountSompi`, for the refund shape
 * the covenant pins: exactly one input, exactly one output to the sender,
 * no payload.
 *
 * @throws FeeSolveRefusal when no fee exists or the iteration does not
 * converge. THE CALLER MUST TREAT THIS AS "REFUSE TO CREATE THIS ASK".
 */
export function solveRefundFee(params: {
  networkId: string;
  amountSompi: bigint;
  senderAddress: string;
  /** A UTXO shape to measure against; only its amount and SPK matter. */
  utxoTemplate: (amount: bigint) => IUtxoEntry;
  /** Byte length of the sig script the refund will ACTUALLY carry (A1).
   * Callers that know the covenant MUST pass it — see
   * `refundSigScriptBytes`. Omitting it falls back to a conservative
   * upper bound rather than the old vector-derived constant, so a caller
   * that forgets over-pays instead of stranding funds. */
  sigScriptBytes?: number;
}): RefundFeeSolution {
  const { networkId, amountSompi, senderAddress, utxoTemplate } = params;
  const sigBytes = params.sigScriptBytes ?? V3_REFUND_SIGSCRIPT_UPPER_BOUND;
  const trace: string[] = [];
  const seen = new Set<bigint>();
  let guess = 100_000n;

  for (let i = 0; i < FEE_SOLVE_MAX_ITERS; i++) {
    const output = amountSompi - guess;
    if (output <= 0n) {
      throw new FeeSolveRefusal(
        `refund fee ${guess} would consume the whole Ask of ${amountSompi} sompi`,
        amountSompi,
        trace
      );
    }
    const tx = createTransaction(
      [utxoTemplate(amountSompi)],
      [{ address: senderAddress, amount: output }],
      0n,
      undefined,
      0
    );
    tx.lockTime = 100_000n;
    tx.inputs[0].sequence = 0n;
    // Must match the sig script the refund builder ACTUALLY emits, or the
    // solver prices a different transaction than the one broadcast.
    tx.inputs[0].signatureScript = "00".repeat(sigBytes);

    const required = calculateTransactionFee(networkId, tx);
    trace.push(`${guess}->${required === undefined ? "none" : required}`);

    if (required === undefined) {
      throw new FeeSolveRefusal(
        `no valid fee exists for ${amountSompi} sompi (transaction mass exceeds the standard limit)`,
        amountSompi,
        trace
      );
    }
    if (required === guess) {
      // Exact fixed point: this is the true minimum for its own shape.
      return {
        fee: guess,
        allowance: guess * ALLOWANCE_MARGIN,
        iterations: i + 1,
        trace,
      };
    }
    if (required < guess) {
      // We over-guessed. Paying less enlarges the output, which LOWERS
      // storage mass, so `required` stays sufficient — keep descending
      // toward the real minimum instead of returning the guess.
      // (Second audit, finding 4: the old code returned `guess` here, so
      // the "solver" always returned its 100,000-sompi starting value and
      // the per-Ask allowance was a constant 400,000. F21 was ~94% fixed
      // and the design's skim figures were understated by ~45%.)
      if (seen.has(required)) {
        // Two-cycle: return the LARGER of the cycle, which is the value
        // known to be sufficient. Never return an insufficient fee.
        const safe = required > guess ? required : guess;
        return {
          fee: safe,
          allowance: safe * ALLOWANCE_MARGIN,
          iterations: i + 1,
          trace,
        };
      }
      seen.add(guess);
      guess = required;
      continue;
    }
    guess = required;
  }

  // Non-convergence. Refuse — never return the last iterate.
  throw new FeeSolveRefusal(
    `refund fee did not converge for ${amountSompi} sompi in ${FEE_SOLVE_MAX_ITERS} iterations; refusing to create an Ask whose refund may be unbroadcastable`,
    amountSompi,
    trace
  );
}

/** True when an Ask of this size can be created safely. Used by compose
 * and by createAsk — replaces the V2 guard `amount <= 500_000`, which was
 * roughly 20x too permissive. */
export function isAskAmountViable(
  params: Parameters<typeof solveRefundFee>[0]
): { viable: true; solution: RefundFeeSolution } | { viable: false; reason: string } {
  try {
    return { viable: true, solution: solveRefundFee(params) };
  } catch (e) {
    if (e instanceof FeeSolveRefusal) return { viable: false, reason: e.message };
    throw e;
  }
}
