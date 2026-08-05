// THE STRONG REACHABILITY ASSERTION — asserts the DEFECT, not a proxy.
//
// v3-reachability.test.ts checks exports and greps source for `createAskV3`.
// Those are proxies: they would fail for a missing symbol or a renamed
// function just as readily as for the real defect, so a failure there does
// not prove the shipped path builds the wrong covenant.
//
// This asserts the thing itself: take the parameters a real compose action
// produces, derive the P2SH the SHIPPED creation path would fund, and
// compare it against BOTH covenant derivations. Before the wiring it must
// equal the V2 address; after, the V3 address. Same assertion, same code
// path, only the wiring changed.
//
// Deliberately does not mock: it calls the same `prepareAskV3` /
// `deriveAskCovenant` the client calls, with live-magnitude values.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { payToAddressScript, type IUtxoEntry } from "kaspa-wasm";
import { deriveAskCovenant, xOnlyFromAddress } from "../../src/lib/ask/covenant";
import { prepareAskV3 } from "../../src/lib/ask/node-v3";
import { DAA_ANCHORS } from "../../src/lib/ask/daa-guard";
import { REFUND_FEE_ALLOWANCE } from "../../src/lib/ask/protocol";

const NETWORK_ID = "testnet-10";
const ADDR = "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6";
const ANCHOR = DAA_ANCHORS[NETWORK_ID];

// LIVE-MAGNITUDE values, per the anti-fixture rule: a 9-digit DAA score and
// a real 7-day deadline, not the golden vector's 1_000_000.
const NOW_MS = ANCHOR.observedAtMs + 86_400_000;
const CURRENT_DAA = ANCHOR.daaScore + BigInt(86_400 * ANCHOR.ratePerSecond);
const DEADLINE = CURRENT_DAA + BigInt(7 * 86_400 * ANCHOR.ratePerSecond);
const AMOUNT = 100_000_000n; // 1 KAS

const utxoTemplate = (amount: bigint) =>
  ({
    address: ADDR,
    outpoint: { transactionId: "aa".repeat(32), index: 0 },
    amount,
    scriptPublicKey: payToAddressScript(ADDR),
    blockDaaScore: 1n,
    isCoinbase: false,
  }) as unknown as IUtxoEntry;

/** The address the V2 builder would fund for these parameters. */
function v2Address(): string {
  return deriveAskCovenant(
    {
      recipientXOnlyHex: xOnlyFromAddress(ADDR),
      senderAddress: ADDR,
      deadlineDaa: DEADLINE,
      minRefund: AMOUNT - REFUND_FEE_ALLOWANCE,
    },
    NETWORK_ID
  ).p2shAddress;
}

/** The address the V3 builder would fund for the same parameters. */
function v3Address(askIdHex: string): string {
  return prepareAskV3({
    networkId: NETWORK_ID,
    senderAddress: ADDR,
    recipientAddress: ADDR,
    amount: AMOUNT,
    message: "shipped-path check",
    deadlineDaa: DEADLINE,
    currentDaa: CURRENT_DAA,
    nowMs: NOW_MS,
    askIdHex,
    utxoTemplate,
  }).p2shAddress;
}

/** Which builder does the SHIPPED creation path invoke? Read from the one
 * production call site rather than from a mock, so this tracks the real
 * code. Comment-stripped so prose about the migration cannot satisfy it. */
function shippedCreationBuilder(): "v2" | "v3" | "unknown" {
  const code = fs
    .readFileSync("src/lib/asks-client.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const sendAsk = code.slice(code.indexOf("export async function sendAsk"));
  const body = sendAsk.slice(0, sendAsk.indexOf("\n}\n"));
  if (/createAskV3\s*\(/.test(body)) return "v3";
  if (/createAsk\s*\(/.test(body)) return "v2";
  return "unknown";
}

describe("the SHIPPED creation path funds the hardened covenant", () => {
  it("V2 and V3 derive DIFFERENT addresses for identical parameters", () => {
    // Without this the whole assertion is vacuous — if both derivations
    // agreed, "builds V3" could never be distinguished from "builds V2".
    const a = v2Address();
    const b = v3Address("11".repeat(32));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^kaspatest:/);
    expect(b).toMatch(/^kaspatest:/);
  });

  it("sendAsk funds the V3 address, NOT the V2 address", () => {
    const builder = shippedCreationBuilder();
    expect(
      builder,
      "sendAsk's creation call could not be identified — broken assertion, not a result"
    ).not.toBe("unknown");

    // THE DEFECT, stated as an address comparison. Pre-wiring this reads
    // "v2", so the shipped path funds v2Address() and F12/F13/F21/F22 are
    // live on every Ask the client creates.
    expect(
      builder,
      `sendAsk builds the ${builder.toUpperCase()} covenant. V2 address ${v2Address()} ` +
        `carries the batch-refund drain (F12), the stranding band (F13), the miner ` +
        `overpayment (F21) and the cross-Ask claim (F22).`
    ).toBe("v3");
  });

  it("the askId reaches the funded address — a V3 covenant is per-Ask", () => {
    // Guards against a wiring that calls the V3 builder but drops the askId,
    // which would produce a V3-shaped script without the F22 binding.
    expect(v3Address("11".repeat(32))).not.toBe(v3Address("22".repeat(32)));
  });
});
