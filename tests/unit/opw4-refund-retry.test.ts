// OPW-4 — a transient node error permanently suppresses auto-refund.
//
// THE DEFECT. `maybeAutoRefund` returns `string | null`, and `null` carries
// two incompatible meanings:
//
//   (a) "someone else already closed this"  -> terminal, stop.
//   (b) "the broadcast failed"              -> transient, MUST retry.
//
// `isChainRejection` collapses them by matching the bare substring
// "RPC Server (remote error)", which EVERY remote failure carries — a
// dropped connection, a timeout, a node restart. `activity.tsx` adds the
// ask to `refundAttempted` BEFORE awaiting and removes it only in `catch`.
// `null` does not throw. So one transient blip permanently suppresses the
// auto-refund for the whole session, and the sender's money stays locked
// until they happen to reload.
//
// WHY IT GOT WORSE THIS WEEK. Before the V3 wiring the shipped client
// created V2 Asks whose refunds the app rarely executed. Now V3 is live and
// auto-refunds actually fire, so the path this silences is exactly the
// stranded-refund recovery it exists to perform. The migration activated a
// dormant bug.
//
// THE FIX, and why it is not "narrow the substring". Enumerating consensus
// rejection strings means inventing them: only ONE real rejection string is
// in evidence (observed in the Phase 3 run — "output (...) already spent by
// transaction ... in the mempool"). Guessing the rest is precisely what R6
// forbids. So the classifier is removed from the decision entirely and the
// CHAIN is asked instead: after a failed submit, re-read the covenant UTXO.
//   - escrow gone  -> someone closed it. Terminal. Return null.
//   - still funded -> our broadcast failed. Throw, so the caller retries.
//
// BOTH DIRECTIONS ARE PROVEN HERE. A fix that made every failure retry
// would be just as wrong: a completed refund must stop cleanly and not
// retry forever. The CONTROL cases assert that and pass before and after.
//
// EXPECTED STATE WHEN COMMITTED: the two FIX cases fail (they receive
// `null` where a throw is required); all four CONTROL cases pass.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { payToAddressScript, PrivateKey, Keypair, type RpcClient } from "kaspa-wasm";
import { maybeAutoRefund } from "../../src/lib/asks-client";
import { prepareAskV3 } from "../../src/lib/ask/node-v3";
import { DAA_ANCHORS } from "../../src/lib/ask/daa-guard";
import type { AskRecordDto } from "../../src/lib/ask-record";

const NETWORK_ID = "testnet-10";
const ANCHOR = DAA_ANCHORS[NETWORK_ID];
const CURRENT_DAA = ANCHOR.daaScore + BigInt(86_400 * ANCHOR.ratePerSecond);
const DEADLINE = CURRENT_DAA + BigInt(7 * 86_400 * ANCHOR.ratePerSecond);
const AMOUNT = 100_000_000n;
const ASK_ID = "9d".repeat(32);

const RECIPIENT = Keypair.fromPrivateKey(new PrivateKey("00".repeat(31) + "07"))
  .toAddress("testnet")
  .toString();
const SENDER = Keypair.fromPrivateKey(new PrivateKey("00".repeat(31) + "09"))
  .toAddress("testnet")
  .toString();

const V3 = prepareAskV3({
  networkId: NETWORK_ID,
  senderAddress: SENDER,
  recipientAddress: RECIPIENT,
  amount: AMOUNT,
  message: "opw-4",
  deadlineDaa: DEADLINE,
  currentDaa: CURRENT_DAA,
  nowMs: ANCHOR.observedAtMs + 86_400_000,
  askIdHex: ASK_ID,
  utxoTemplate: (amount: bigint) =>
    ({
      address: SENDER,
      outpoint: { transactionId: "aa".repeat(32), index: 0 },
      amount,
      scriptPublicKey: payToAddressScript(SENDER),
      blockDaaScore: 1n,
      isCoinbase: false,
    }) as never,
});

/** Each case gets its own lock txid: `covenantFor` memoises the resolved
 * version by askRef, and sharing one across cases lets an earlier case
 * decide a later one. (Learned the hard way in Phase 2.) */
function recordFor(lockTxid: string): AskRecordDto {
  return {
    askRef: lockTxid,
    protocolVersion: 2,
    askId: ASK_ID,
    refundAllowance: V3.refundAllowance.toString(),
    senderAddress: SENDER,
    recipientAddress: RECIPIENT,
    amountSompi: AMOUNT.toString(),
    messageCiphertext: "00".repeat(80),
    deadline: DEADLINE.toString(),
    lockTxid,
    claimTxid: null,
    refundTxid: null,
    status: "open",
  };
}

/** A REAL rejection string, copied verbatim from the Phase 3 run rather
 * than invented — the racing-watcher case the `null` return exists for. */
const REAL_CONFLICT_ERROR =
  "RPC Server (remote error) -> Rejected transaction 1a667560ba406612df4d33fca5aedb36af14e1591853233ed4c36784306f72b5: " +
  "output (4ca8a2ffb3f63b6c9de0e2c0be948bfed71152b1ad062e529715f31c1cbca4a4, 1) already spent by transaction " +
  "dc09a471820ce2b0a99a6bc2a837affc9980545ebcbaa995f2fe73e3225a66d4 in the mempool";

/** A TRANSIENT failure. Note it carries the same "RPC Server (remote
 * error)" banner as the conflict above — which is exactly why substring
 * matching cannot separate them. */
const TRANSIENT_ERROR =
  "RPC Server (remote error) -> WebSocket connection reset by peer";

interface NodeOpts {
  /** How the submit fails, if it does. */
  submitError?: string;
  /** Whether the escrow is still funded when the failure is re-checked. */
  fundedAfterFailure?: boolean;
  /** Escrow funded at all to begin with. */
  fundedInitially?: boolean;
}

function fakeNode(lockTxid: string, opts: NodeOpts) {
  let funded = opts.fundedInitially !== false;
  let submits = 0;
  const rpc = {
    getBlockDagInfo: async () => ({ virtualDaaScore: DEADLINE.toString() }),
    getUtxosByAddresses: async ({ addresses }: { addresses: string[] }) => {
      if (!funded || !addresses.includes(V3.p2shAddress)) return { entries: [] };
      return {
        entries: [
          {
            address: V3.p2shAddress,
            outpoint: { transactionId: lockTxid, index: 0 },
            amount: AMOUNT,
            scriptPublicKey: payToAddressScript(V3.p2shAddress),
            blockDaaScore: 1n,
            isCoinbase: false,
          },
        ],
      };
    },
    submitTransaction: async () => {
      submits++;
      if (opts.submitError) {
        // The competing spend lands (or does not) at the moment of failure.
        if (opts.fundedAfterFailure === false) funded = false;
        throw new Error(opts.submitError);
      }
      funded = false;
      return { transactionId: "cc".repeat(32) };
    },
  };
  return {
    rpc: rpc as unknown as RpcClient,
    submits: () => submits,
    heal: () => {
      opts.submitError = undefined;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", async () => ({ ok: true, status: 200 }) as Response);
});

describe("CONTROLS — the terminal cases must stop cleanly", () => {
  it("a healthy node refunds and returns the txid", async () => {
    const n = fakeNode("c1".repeat(32), {});
    const txid = await maybeAutoRefund(n.rpc, recordFor("c1".repeat(32)));
    expect(txid).toBe("cc".repeat(32));
  });

  it("an escrow that is already gone returns null and broadcasts nothing", async () => {
    const n = fakeNode("c2".repeat(32), { fundedInitially: false });
    expect(await maybeAutoRefund(n.rpc, recordFor("c2".repeat(32)))).toBeNull();
    expect(n.submits()).toBe(0);
  });

  it("a REAL racing-watcher conflict returns null — no retry forever", async () => {
    // The competing refund won: the submit is rejected AND the escrow is
    // gone when re-checked. This is the case `null` was written for, and
    // the fix must not turn a completed refund into an endless retry.
    const n = fakeNode("c3".repeat(32), {
      submitError: REAL_CONFLICT_ERROR,
      fundedAfterFailure: false,
    });
    expect(await maybeAutoRefund(n.rpc, recordFor("c3".repeat(32)))).toBeNull();
  });

  it("a refund already completed stays completed on a second pass", async () => {
    const ref = "c4".repeat(32);
    const n = fakeNode(ref, {});
    expect(await maybeAutoRefund(n.rpc, recordFor(ref))).toBeTruthy();
    // Second pass: escrow gone, must settle silently rather than re-broadcast.
    expect(await maybeAutoRefund(n.rpc, recordFor(ref))).toBeNull();
    expect(n.submits()).toBe(1);
  });
});

describe("THE FIX — a transient failure must be retryable", () => {
  it("a transient error THROWS while the escrow is still funded", async () => {
    // Same "RPC Server (remote error)" banner as the conflict above, but
    // the money is still locked — the refund did NOT happen. Returning null
    // here tells activity.tsx "handled", and it never tries again.
    const n = fakeNode("f1".repeat(32), {
      submitError: TRANSIENT_ERROR,
      fundedAfterFailure: true,
    });
    await expect(
      maybeAutoRefund(n.rpc, recordFor("f1".repeat(32))),
      "a failed broadcast reported as `null` is indistinguishable from " +
        "`already refunded`, and activity.tsx never retries a non-throw"
    ).rejects.toThrow();
  });

  it("does not latch: it stays retryable until the node recovers", async () => {
    const ref = "f2".repeat(32);
    const n = fakeNode(ref, {
      submitError: TRANSIENT_ERROR,
      fundedAfterFailure: true,
    });
    await expect(maybeAutoRefund(n.rpc, recordFor(ref))).rejects.toThrow();
    await expect(maybeAutoRefund(n.rpc, recordFor(ref))).rejects.toThrow();
    n.heal();
    // The whole point: once the node is back, the sender's money comes home.
    expect(await maybeAutoRefund(n.rpc, recordFor(ref))).toBe("cc".repeat(32));
  });
});

describe("the caller's retry contract", () => {
  it("activity.tsx clears the attempted-marker only on a throw", async () => {
    // maybeAutoRefund throwing is only useful if the caller reacts. This
    // pins the other half of the contract at the source level: the effect
    // marks BEFORE awaiting and un-marks in `catch`, so a returned value —
    // any returned value — is final for the session.
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/activity.tsx", "utf8");
    const effect = src.slice(src.indexOf("Normative rule 1"));
    const body = effect.slice(0, effect.indexOf("Unread math"));
    expect(body).toMatch(/refundAttempted\.current\.add\(/);
    expect(body).toMatch(/catch\s*\{[\s\S]*refundAttempted\.current\.delete\(/);
  });
});
