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
// PARITY: spike/lib.cjs solveSpendFee implements the same algorithm for
// the CJS probes. tests/unit/fees-v3.test.ts pins the boundary values so
// the two cannot silently diverge.
import { calculateTransactionFee, createTransaction, type IUtxoEntry } from "kaspa-wasm";

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
}): RefundFeeSolution {
  const { networkId, amountSompi, senderAddress, utxoTemplate } = params;
  const trace: string[] = [];
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
    tx.inputs[0].signatureScript = "00".repeat(117); // sig-less refund shape

    const required = calculateTransactionFee(networkId, tx);
    trace.push(`${guess}->${required === undefined ? "none" : required}`);

    if (required === undefined) {
      throw new FeeSolveRefusal(
        `no valid fee exists for ${amountSompi} sompi (transaction mass exceeds the standard limit)`,
        amountSompi,
        trace
      );
    }
    if (required <= guess) {
      return {
        fee: guess,
        allowance: guess * ALLOWANCE_MARGIN,
        iterations: i + 1,
        trace,
      };
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
