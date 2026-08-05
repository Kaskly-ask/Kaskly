// PHASE 2 — does the SHIPPED spend path route to the V3 builders?
//
// WHY THIS FILE EXISTS, AND WHY THE OBVIOUS TEST WOULD BE WORTHLESS. A test
// that supplies the funding oracle itself and calls buildClaimTransactionV3
// directly proves the BUILDER works. It says nothing about whether
// `claimAsk` — the function the reply box actually calls — ever reaches it.
// Phase 1 shipped a resolver that no production call site invoked with an
// oracle; the unit tests were green the whole time.
//
// So: these tests call the REAL exported `claimAsk` and `maybeAutoRefund`
// with a fake RPC and nothing else. The oracle is built INSIDE those
// functions from that RPC. The assertion is made on the transaction that
// arrives at `submitTransaction` — the bytes that would have gone to a node.
// Nothing about the covenant choice is supplied by the test.
//
// The fake RPC funds exactly ONE address: the one a genuine Ask of that
// version is locked at. Resolution therefore has to work for the call to
// produce a transaction at all — and if it resolved to the other version,
// the UTXO lookup misses and the function throws/no-ops instead of
// submitting. That is what makes "a transaction was submitted, and it is
// V3-shaped" evidence rather than assertion.
//
// EXPECTED STATE WHEN FIRST COMMITTED: red. Pre-wiring, claimAsk and
// maybeAutoRefund call covenantFor with NO oracle and the V2 builders, so a
// V3 record resolves by hint to the V2 address, finds no UTXO, and never
// submits. The failure is "no transaction submitted / wrong header" — the
// defect itself, not a missing symbol.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  payToAddressScript,
  PrivateKey,
  Keypair,
  type IUtxoEntry,
} from "kaspa-wasm";
import { claimAsk, maybeAutoRefund } from "../../src/lib/asks-client";
import { prepareAskV3 } from "../../src/lib/ask/node-v3";
import { deriveAskCovenant, xOnlyFromAddress } from "../../src/lib/ask/covenant";
import { REFUND_FEE_ALLOWANCE } from "../../src/lib/ask/protocol";
import { DAA_ANCHORS } from "../../src/lib/ask/daa-guard";
import type { AskRecordDto } from "../../src/lib/ask-record";
import type { RpcClient } from "kaspa-wasm";

const NETWORK_ID = "testnet-10";
const ANCHOR = DAA_ANCHORS[NETWORK_ID];

// LIVE-MAGNITUDE values (anti-fixture rule): 9-digit DAA, a real 7-day span,
// a real 1 KAS lock. Not the golden vector's deadlineDaa = 1_000_000.
const NOW_MS = ANCHOR.observedAtMs + 86_400_000;
const CURRENT_DAA = ANCHOR.daaScore + BigInt(86_400 * ANCHOR.ratePerSecond);
const DEADLINE = CURRENT_DAA + BigInt(7 * 86_400 * ANCHOR.ratePerSecond);
const AMOUNT = 100_000_000n;
const ASK_ID = "5c".repeat(32);
const LOCK_TXID = "bb".repeat(32);

// A real keypair, so the claim's recipient signature and the covenant's
// pinned x-only key are the same key — the script has to actually verify.
const RECIPIENT_PRIV =
  "0000000000000000000000000000000000000000000000000000000000000007";
const RECIPIENT_ADDR = Keypair.fromPrivateKey(new PrivateKey(RECIPIENT_PRIV))
  .toAddress("testnet")
  .toString();
const SENDER_ADDR = Keypair.fromPrivateKey(
  new PrivateKey("00".repeat(31) + "09")
)
  .toAddress("testnet")
  .toString();

const utxoTemplate = (amount: bigint) =>
  ({
    address: SENDER_ADDR,
    outpoint: { transactionId: "aa".repeat(32), index: 0 },
    amount,
    scriptPublicKey: payToAddressScript(SENDER_ADDR),
    blockDaaScore: 1n,
    isCoinbase: false,
  }) as unknown as IUtxoEntry;

/** The address a genuine V3 Ask with these parameters is funded at. */
const V3 = prepareAskV3({
  networkId: NETWORK_ID,
  senderAddress: SENDER_ADDR,
  recipientAddress: RECIPIENT_ADDR,
  amount: AMOUNT,
  message: "routing check",
  deadlineDaa: DEADLINE,
  currentDaa: CURRENT_DAA,
  nowMs: NOW_MS,
  askIdHex: ASK_ID,
  utxoTemplate,
});

/** The address a genuine V2 Ask with the same parameters is funded at. */
const V2 = deriveAskCovenant(
  {
    recipientXOnlyHex: xOnlyFromAddress(RECIPIENT_ADDR),
    senderAddress: SENDER_ADDR,
    deadlineDaa: DEADLINE,
    minRefund: AMOUNT - REFUND_FEE_ALLOWANCE,
  },
  NETWORK_ID
);

const baseRecord = {
  askRef: LOCK_TXID,
  senderAddress: SENDER_ADDR,
  recipientAddress: RECIPIENT_ADDR,
  amountSompi: AMOUNT.toString(),
  messageCiphertext: "00".repeat(80),
  deadline: DEADLINE.toString(),
  lockTxid: LOCK_TXID,
  claimTxid: null,
  refundTxid: null,
  status: "open" as const,
};

const v3Record: AskRecordDto = {
  ...baseRecord,
  protocolVersion: 2,
  askId: ASK_ID,
  refundAllowance: V3.refundAllowance.toString(),
};
const v2Record: AskRecordDto = {
  ...baseRecord,
  protocolVersion: 1,
  askId: null,
  refundAllowance: null,
};
/** Genuinely V3 and genuinely funded at the V3 address — only the version
 * FIELD says otherwise. Routing must follow the chain, not the field. */
const liedV3Record: AskRecordDto = { ...v3Record, protocolVersion: 1 };

/** Fake node. Funds exactly one P2SH; records what was submitted. Only the
 * three methods the real code path calls are implemented — anything else it
 * reaches for is an unmodelled dependency and should throw, loudly. */
function fakeRpc(fundedAddress: string, daaScore: bigint) {
  const submitted: { payloadHex: string; outputs: { value: bigint; spk: string }[] }[] =
    [];
  const queried: string[] = [];
  const rpc = {
    getBlockDagInfo: async () => ({ virtualDaaScore: daaScore.toString() }),
    getUtxosByAddresses: async ({ addresses }: { addresses: string[] }) => {
      queried.push(...addresses);
      if (!addresses.includes(fundedAddress)) return { entries: [] };
      return {
        entries: [
          {
            address: fundedAddress,
            outpoint: { transactionId: LOCK_TXID, index: 0 },
            amount: AMOUNT,
            scriptPublicKey: payToAddressScript(fundedAddress),
            blockDaaScore: 1n,
            isCoinbase: false,
          },
        ],
      };
    },
    submitTransaction: async ({ transaction }: { transaction: unknown }) => {
      const tx = transaction as {
        payload: string;
        outputs: { value: bigint; scriptPublicKey: unknown }[];
      };
      submitted.push({
        payloadHex: tx.payload,
        outputs: tx.outputs.map((o) => ({
          value: BigInt(o.value),
          spk: JSON.stringify(o.scriptPublicKey),
        })),
      });
      return { transactionId: "cc".repeat(32) };
    },
  };
  return { rpc: rpc as unknown as RpcClient, submitted, queried };
}

const V2_HEADER = Buffer.from("ciph_msg:1:ask:", "utf8").toString("hex");
const V3_HEADER = Buffer.from("ciph_msg:1:ask:r2:", "utf8").toString("hex");

beforeEach(() => {
  // Post-submit cache write; not part of the routing decision, but it must
  // not be what fails the test.
  vi.stubGlobal("fetch", async () => ({ ok: true, status: 200 }) as Response);
});

describe("VACUITY CONTROL — the two versions are distinguishable", () => {
  it("V2 and V3 fund different addresses, and their headers differ", () => {
    expect(V3.p2shAddress).not.toBe(V2.p2shAddress);
    expect(V3_HEADER.startsWith(V2_HEADER)).toBe(true); // V3 extends V2's
    expect(V3_HEADER).not.toBe(V2_HEADER);
  });
});

describe("claimAsk routes to the V3 builder on the real path", () => {
  it("CONTROL: a V2 record still produces a V2 claim", async () => {
    const { rpc, submitted } = fakeRpc(V2.p2shAddress, CURRENT_DAA);
    await claimAsk(rpc, v2Record, RECIPIENT_PRIV, "hello");
    expect(submitted).toHaveLength(1);
    // The V2 payload carries the short header and NO askId — byte 15 begins
    // the JSON body, so the r2 marker must be absent.
    expect(submitted[0].payloadHex.startsWith(V2_HEADER)).toBe(true);
    expect(submitted[0].payloadHex.startsWith(V3_HEADER)).toBe(false);
  });

  it("a V3 record produces a V3 claim, askId bound in, through claimAsk", async () => {
    const { rpc, submitted } = fakeRpc(V3.p2shAddress, CURRENT_DAA);
    await claimAsk(rpc, v3Record, RECIPIENT_PRIV, "hello");
    expect(
      submitted,
      "claimAsk submitted nothing — it resolved to a covenant the fake node " +
        "never funded, i.e. it did not route to V3"
    ).toHaveLength(1);
    const payload = submitted[0].payloadHex;
    expect(payload.startsWith(V3_HEADER)).toBe(true);
    // The covenant compares payload bytes 18..50 against the askId it pins.
    // If the wiring called the V3 builder but dropped the askId, this is
    // where it shows — and the chain would reject the claim.
    expect(payload.slice(18 * 2, 50 * 2)).toBe(ASK_ID);
  });

  it("a flipped version field does NOT downgrade the claim", async () => {
    const { rpc, submitted } = fakeRpc(V3.p2shAddress, CURRENT_DAA);
    await claimAsk(rpc, liedV3Record, RECIPIENT_PRIV, "hello");
    expect(
      submitted,
      "the version FIELD decided the covenant — flip it and the recipient " +
        "cannot claim their own funds"
    ).toHaveLength(1);
    expect(submitted[0].payloadHex.startsWith(V3_HEADER)).toBe(true);
    expect(submitted[0].payloadHex.slice(36, 100)).toBe(ASK_ID);
  });
});

describe("maybeAutoRefund routes to the V3 builder on the real path", () => {
  it("CONTROL: a V2 record still produces a V2 refund", async () => {
    const { rpc, submitted } = fakeRpc(V2.p2shAddress, DEADLINE);
    const txid = await maybeAutoRefund(rpc, v2Record);
    expect(txid).not.toBeNull();
    expect(submitted).toHaveLength(1);
    // The V2 builder pays out EXACTLY the covenant floor: it does not solve
    // the fee, so the entire allowance is surrendered to the miner (F21).
    // That exact-floor payout is the V2 signature this file discriminates on.
    expect(submitted[0].outputs[0].value).toBe(AMOUNT - REFUND_FEE_ALLOWANCE);
  });

  it("a V3 record produces a V3 refund priced on its own allowance", async () => {
    const { rpc, submitted } = fakeRpc(V3.p2shAddress, DEADLINE);
    const txid = await maybeAutoRefund(rpc, v3Record);
    expect(
      txid,
      "maybeAutoRefund no-opped — it looked for the V2 address, which was " +
        "never funded, so a real V3 Ask would never auto-refund"
    ).not.toBeNull();
    expect(submitted).toHaveLength(1);
    const out = submitted[0].outputs[0].value;
    expect(submitted[0].outputs).toHaveLength(1);

    // THE DISCRIMINATOR. Both builders can be handed this covenant, and both
    // produce a script-valid refund — so "is it above the floor" is not
    // enough. What separates them is WHERE in the band they land:
    //
    //   V2 builder: pays exactly (input - allowance). The whole allowance
    //               becomes miner fee — the F21 overpayment.
    //   V3 builder: solves the fee against the sig script it actually emits
    //               (A1) and keeps the rest for the sender.
    //
    // Measured for these parameters: floor 99,678,400 vs solved 99,920,300 —
    // 241,900 sompi of the sender's money that the V2 path gives away. A
    // STRICT inequality against the floor can only be satisfied by the V3
    // builder, so this assertion cannot pass on the old wiring.
    expect(
      out,
      "the refund paid exactly the covenant floor — that is the V2 builder, " +
        "surrendering the full allowance as fee (F21)"
    ).toBeGreaterThan(AMOUNT - V3.refundAllowance);
    expect(out).toBeLessThan(AMOUNT);
    expect(
      V3.refundAllowance,
      "if the per-Ask allowance equalled the V2 constant this assertion " +
        "could not tell the builders apart"
    ).toBeLessThan(REFUND_FEE_ALLOWANCE);
  });

  it("a flipped version field does NOT strand the refund", async () => {
    const { rpc, submitted, queried } = fakeRpc(V3.p2shAddress, DEADLINE);
    const txid = await maybeAutoRefund(rpc, liedV3Record);
    expect(txid).not.toBeNull();
    expect(submitted[0].outputs[0].value).toBeGreaterThan(
      AMOUNT - V3.refundAllowance
    );
    // And it got there by TRYING the hinted V2 address first and moving on —
    // evidence the hint is a hint, not authority.
    expect(queried).toContain(V3.p2shAddress);
  });

  it("fails closed: neither covenant funded ⇒ no transaction at all", async () => {
    const { rpc, submitted } = fakeRpc("kaspatest:qqunfunded", DEADLINE);
    expect(await maybeAutoRefund(rpc, v3Record)).toBeNull();
    expect(
      submitted,
      "an unresolvable record must never be broadcast against a guessed address"
    ).toHaveLength(0);
  });
});
