// PHASE 3 — THE LIVE PROOF, through the SHIPPED CLIENT.
//
// Everything before this ran against a fake node. lifecycle-v3.test.ts
// proves the V3 covenant on chain, but it calls node-v3/transactions-v3
// DIRECTLY — it proves the BUILDERS. This file only ever calls the four
// functions the browser calls:
//
//     sendAsk  ->  claimAsk  ->  maybeAutoRefund  ->  deriveStatusFromChain
//
// No covenant is derived here, no builder is named, no version is chosen by
// the test. If the wiring routes to the wrong builder the chain rejects the
// transaction, and these tests fail on a live node rather than on a mock.
//
// ANTI-FIXTURE RULE (it has caught three bugs). Every value is live: the
// DAA score is read from the node (9 digits, ~535,xxx,xxx), deadlines are
// real offsets from it, amounts are really locked and really returned. The
// golden vector's deadlineDaa = 1_000_000 appears nowhere.
//
// CONTROLS FIRST: within each half the legitimate lifecycle must succeed
// before any negative assertion runs. A rejection proves nothing unless the
// honest path is shown to work in the same harness.
//
// BOTH HALVES, and the second is the point of the migration:
//   1. A V3 Ask created by `sendAsk` locks, claims, and refunds.
//   2. An IN-FLIGHT V2 Ask — locked the way the client locked them before
//      the migration — completes its full lifecycle through the SAME
//      migrated client. If the migration orphaned V2 funds, this half fails
//      and real money on the public deploy is stuck.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RpcClient, Keypair, PrivateKey } from "kaspa-wasm";
import { connectRpc, currentDaaScore, createAsk } from "../../src/lib/ask";
import {
  sendAsk,
  claimAsk,
  maybeAutoRefund,
  deriveStatusFromChain,
} from "../../src/lib/asks-client";
import { validateAskRecord, type AskRecordDto } from "../../src/lib/ask-record";
import { REST_API_BASE } from "../../src/lib/config";

const NETWORK_ID = process.env.KASPA_NETWORK_ID || "testnet-10";
const KEYS_FILE = path.join(__dirname, "..", "..", "spike", ".keys.json");

const ASK_AMOUNT = 100_000_000n; // 1 TKAS
const CLAIMABLE_SPAN = 50_000n; // ~83 min at ~10 DAA/s — claim comfortably inside
const REFUND_SPAN = 700n; // ~70s — long enough to confirm the lock first

let rpc: RpcClient;
let sender: Keypair;
let recipient: Keypair;
let senderAddress: string;
let recipientAddress: string;
let senderPriv: string;
let recipientPriv: string;
/** Every txid this file put on chain, reported at the end. */
const txids: Record<string, string> = {};

/** The cache API is a Next.js route; there is no server here. Intercept
 * ONLY that relative URL and let every other fetch — the REST indexer the
 * status derivation uses — hit the real network. Stubbing all of fetch
 * would quietly disable the independent verification source. */
function stubCacheApi() {
  const real = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/asks")) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    return real(input as RequestInfo, init);
  }) as typeof fetch;
}

async function waitForDaa(target: bigint, label: string) {
  const deadline = Date.now() + 300_000;
  for (;;) {
    const daa = await currentDaaScore(rpc);
    if (daa >= target) return daa;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for DAA ${target} (${label})`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

/** Wait until an Ask's escrow is CONFIRMED, using only the shipped status
 * derivation. Two reasons, both learned from the first live run:
 *
 *  1. A claim issued milliseconds after the lock broadcast finds no UTXO —
 *     trial reconstruction correctly refuses to guess, which looks exactly
 *     like a routing failure. It is not; it is the harness racing the node.
 *  2. While the lock sits in the mempool the node still lists the outputs
 *     it spends, so the NEXT lock from the same wallet picks one and is
 *     rejected as a double spend. That is what killed the first V2 half.
 *
 * Waiting for confirmation removes both. This is a HARNESS fix — no product
 * behaviour is being adjusted to make a test pass. */
async function waitVerified(record: AskRecordDto, label: string) {
  const until = Date.now() + 240_000;
  for (;;) {
    try {
      const d = await deriveStatusFromChain(rpc, { ...record, status: "open" });
      if (d.verified) return d;
    } catch {
      /* not yet resolvable — the escrow is still unconfirmed */
    }
    if (Date.now() > until) throw new Error(`${label} never confirmed on chain`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}

/** R2 (b): recompute from raw chain data via a source INDEPENDENT of the
 * wRPC node this client used — the REST indexer. Returns the transaction's
 * outputs as the chain actually stored them. */
async function rawOutputsFromIndexer(
  txid: string
): Promise<{ amount: bigint; address: string | null }[]> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      const r = await fetch(`${REST_API_BASE}/transactions/${txid}`);
      if (r.ok) {
        const tx = (await r.json()) as {
          outputs: { amount: number | string; script_public_key_address?: string }[];
        };
        if (tx.outputs?.length) {
          return tx.outputs.map((o) => ({
            amount: BigInt(o.amount),
            address: o.script_public_key_address ?? null,
          }));
        }
      }
    } catch {
      /* indexer lag — retry */
    }
    if (Date.now() > deadline) throw new Error(`indexer never returned ${txid}`);
    await new Promise((res) => setTimeout(res, 5000));
  }
}

/** R2 (b) continued: confirm the transaction contains NO output beyond the
 * ones the protocol specifies. D2 — zero fees, provably, from raw data. */
function assertNoFeeOutput(
  outputs: { amount: bigint; address: string | null }[],
  allowed: string[]
) {
  for (const o of outputs) {
    expect(
      allowed,
      `unexpected output of ${o.amount} sompi to ${o.address} — D2 forbids fee outputs`
    ).toContain(o.address);
  }
}

beforeAll(async () => {
  stubCacheApi();
  const keys = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  senderPriv = keys.senderPrivateKey;
  recipientPriv = keys.recipientPrivateKey;
  sender = Keypair.fromPrivateKey(new PrivateKey(senderPriv));
  recipient = Keypair.fromPrivateKey(new PrivateKey(recipientPriv));
  senderAddress = sender.toAddress("testnet").toString();
  recipientAddress = recipient.toAddress("testnet").toString();
  rpc = await connectRpc({ networkId: NETWORK_ID, wrpcUrl: process.env.KASPA_WRPC_URL });

  const daa = await currentDaaScore(rpc);
  // The anti-fixture guard, asserted rather than assumed: if this ever runs
  // against a fixture or a fresh devnet, the whole file is meaningless.
  expect(
    daa.toString().length,
    `DAA score ${daa} is not a live mainnet-scale value — refusing to call ` +
      `this a live proof`
  ).toBeGreaterThanOrEqual(9);

  const { entries } = await rpc.getUtxosByAddresses({ addresses: [senderAddress] });
  const balance = entries.reduce((a, e) => a + BigInt(e.amount), 0n);
  if (balance < 5n * ASK_AMOUNT) {
    throw new Error(`sender ${senderAddress} needs at least 5 TKAS from the faucet`);
  }
}, 120_000);

afterAll(async () => {
  await rpc?.disconnect();
  // Persisted, not logged. Vitest swallows stdout on a PASSING run, so the
  // first green run's txids were recoverable only by re-querying the indexer
  // and matching on block_time. A file survives either outcome.
  fs.writeFileSync(
    path.join(__dirname, "..", "..", "phase3-txids.json"),
    JSON.stringify(txids, null, 2)
  );
});

// ---------------------------------------------------------------------------
// HALF 1 — a V3 Ask, created by the shipped compose path
// ---------------------------------------------------------------------------
describe("HALF 1 — V3 through sendAsk / claimAsk / maybeAutoRefund", () => {
  let claimable: AskRecordDto;
  let refundable: AskRecordDto;

  it("CONTROL: sendAsk locks a V3 Ask at a live deadline", async () => {
    const daa = await currentDaaScore(rpc);
    claimable = await sendAsk(rpc, {
      senderAddress,
      senderPrivateKeyHex: senderPriv,
      recipientAddress,
      amountSompi: ASK_AMOUNT,
      message: "phase 3 — claimed through the shipped path",
      deadlineDaa: daa + CLAIMABLE_SPAN,
    });
    txids.v3_lock_claimed = claimable.lockTxid;
    await waitVerified(claimable, "v3 claimable lock");

    // The shipped path produced a V3 record: this is F12/F13/F21/F22 leaving
    // production, and it is the assertion the whole migration exists for.
    expect(claimable.protocolVersion).toBe(2);
    expect(claimable.askId).toMatch(/^[0-9a-f]{64}$/);
    expect(claimable.refundAllowance).toBeTruthy();
    expect(BigInt(claimable.deadline)).toBeGreaterThan(535_000_000n); // live, 9-digit
    expect(claimable.lockTxid).toMatch(/^[0-9a-f]{64}$/);
  }, 180_000);

  it("R2: the lock is confirmed by an independent source, with no fee output", async () => {
    const outs = await rawOutputsFromIndexer(claimable.lockTxid);
    // Escrow output + change to the sender. Nothing else may exist (D2).
    const escrow = outs.filter((o) => o.amount === ASK_AMOUNT);
    expect(
      escrow,
      "no output of exactly the locked amount — the escrow was not funded as announced"
    ).toHaveLength(1);
    const allowed = [escrow[0].address, senderAddress];
    assertNoFeeOutput(outs, allowed as string[]);
  }, 240_000);

  it("CONTROL: claimAsk pays the recipient and delivers the reply", async () => {
    const before = await rpc.getUtxosByAddresses({ addresses: [recipientAddress] });
    const beforeSum = before.entries.reduce((a, e) => a + BigInt(e.amount), 0n);

    const { claimTxid, net } = await claimAsk(
      rpc,
      claimable,
      recipientPriv,
      "phase 3 reply — claimed by the shipped client"
    );
    txids.v3_claim = claimTxid;
    expect(claimTxid).toMatch(/^[0-9a-f]{64}$/);
    expect(net).toBeGreaterThan(0n);
    expect(net).toBeLessThan(ASK_AMOUNT);

    // R2 (a): the node's own view — the recipient's balance really moved.
    const grew = await (async () => {
      const until = Date.now() + 120_000;
      for (;;) {
        const now = await rpc.getUtxosByAddresses({ addresses: [recipientAddress] });
        const sum = now.entries.reduce((a, e) => a + BigInt(e.amount), 0n);
        if (sum > beforeSum) return sum - beforeSum;
        if (Date.now() > until) return 0n;
        await new Promise((r) => setTimeout(r, 4000));
      }
    })();
    expect(grew, "recipient balance did not increase after the claim").toBe(net);
  }, 300_000);

  it("R2: the claim paid ONLY the recipient — verified from raw chain data", async () => {
    const outs = await rawOutputsFromIndexer(txids.v3_claim);
    expect(
      outs,
      "a claim must be a single output to the recipient; anything else is a fee or a leak"
    ).toHaveLength(1);
    expect(outs[0].address).toBe(recipientAddress);
    assertNoFeeOutput(outs, [recipientAddress]);
  }, 240_000);

  it("CONTROL: sendAsk locks a second V3 Ask, then maybeAutoRefund returns it", async () => {
    const daa = await currentDaaScore(rpc);
    const deadline = daa + REFUND_SPAN;
    refundable = await sendAsk(rpc, {
      senderAddress,
      senderPrivateKeyHex: senderPriv,
      recipientAddress,
      amountSompi: ASK_AMOUNT,
      message: "phase 3 — ignored, must refund",
      deadlineDaa: deadline,
    });
    txids.v3_lock_refunded = refundable.lockTxid;
    expect(refundable.protocolVersion).toBe(2);
    await waitVerified(refundable, "v3 refundable lock");

    await waitForDaa(deadline, "v3 refund deadline");
    const refundTxid = await maybeAutoRefund(rpc, refundable);
    expect(refundTxid, "the V3 Ask did not auto-refund past its deadline").toBeTruthy();
    txids.v3_refund = refundTxid!;
  }, 600_000);

  it("R2: the V3 refund beat the covenant floor — F21 closed on chain", async () => {
    const outs = await rawOutputsFromIndexer(txids.v3_refund);
    expect(outs, "a refund must be exactly one output, to the sender").toHaveLength(1);
    expect(outs[0].address).toBe(senderAddress);
    assertNoFeeOutput(outs, [senderAddress]);

    const floor = ASK_AMOUNT - BigInt(refundable.refundAllowance!);
    // THE LIVE DISCRIMINATOR. The V2 builder pays exactly the floor,
    // surrendering the whole allowance to the miner. Only the V3 builder,
    // which solves the fee against the sig script it emits, lands above it.
    // Proven here on real money returned to a real address.
    expect(
      outs[0].amount,
      `refund paid exactly the covenant floor (${floor}) — that is the V2 ` +
        `builder and F21 is still live on the shipped path`
    ).toBeGreaterThan(floor);
    expect(outs[0].amount).toBeLessThan(ASK_AMOUNT);
  }, 240_000);

  it("status derivation resolves V3 from a FRESH connection, with no cache", async () => {
    // A brand-new RpcClient and records carrying no status — everything is
    // re-derived from the chain, which is brief §3.3's actual promise.
    const fresh = await connectRpc({ networkId: NETWORK_ID, wrpcUrl: process.env.KASPA_WRPC_URL });
    try {
      const a = await deriveStatusFromChain(fresh, { ...claimable, status: "open" });
      expect(a.verified, "the claimed V3 Ask could not be verified from chain").toBe(true);
      expect(a.status).toBe("answered");
      expect(a.claimTxid).toBe(txids.v3_claim);

      const b = await deriveStatusFromChain(fresh, { ...refundable, status: "open" });
      expect(b.verified).toBe(true);
      expect(b.status).toBe("refunded");
      expect(b.refundTxid).toBe(txids.v3_refund);
    } finally {
      await fresh.disconnect();
    }
  }, 300_000);

  it("NEGATIVE (after the controls): a claim on the refunded Ask is refused", async () => {
    await expect(
      claimAsk(rpc, refundable, recipientPriv, "too late")
    ).rejects.toThrow();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// HALF 2 — an in-flight V2 Ask, through the SAME migrated client
// ---------------------------------------------------------------------------
describe("HALF 2 — the migration did not orphan in-flight V2 funds", () => {
  let v2Claimable: AskRecordDto;
  let v2Refundable: AskRecordDto;

  /** Lock a V2 Ask exactly as the client did BEFORE the migration, then
   * hand it to the migrated client as a record with no version field —
   * which is what pre-migration cache rows actually look like. */
  async function lockV2(message: string, deadlineDaa: bigint): Promise<AskRecordDto> {
    const created = await createAsk(rpc, NETWORK_ID, {
      senderAddress,
      senderPrivateKeyHex: senderPriv,
      recipientAddress,
      amount: ASK_AMOUNT,
      message,
      deadlineDaa,
    });
    return validateAskRecord({
      askRef: created.lockTxid,
      // No protocolVersion — normalised to 1, the pre-migration shape.
      senderAddress,
      recipientAddress,
      amountSompi: ASK_AMOUNT.toString(),
      messageCiphertext: created.envelope.message,
      deadline: deadlineDaa.toString(),
      lockTxid: created.lockTxid,
      claimTxid: null,
      refundTxid: null,
      status: "open",
    });
  }

  it("CONTROL: a pre-migration V2 Ask still claims through the migrated client", async () => {
    const daa = await currentDaaScore(rpc);
    v2Claimable = await lockV2("phase 3 — in-flight V2, claimed", daa + CLAIMABLE_SPAN);
    txids.v2_lock_claimed = v2Claimable.lockTxid;
    expect(v2Claimable.protocolVersion).toBe(1);
    expect(v2Claimable.askId).toBeNull();

    // Confirmed BEFORE the claim — and the fact that this resolves at all
    // is itself the V2 half of trial reconstruction working on live data.
    const pre = await waitVerified(v2Claimable, "v2 claimable lock");
    expect(pre.status).toBe("open");

    const { claimTxid } = await claimAsk(
      rpc,
      v2Claimable,
      recipientPriv,
      "phase 3 reply — in-flight V2 claimed after the migration"
    );
    txids.v2_claim = claimTxid;
    expect(claimTxid).toMatch(/^[0-9a-f]{64}$/);

    const outs = await rawOutputsFromIndexer(claimTxid);
    expect(outs).toHaveLength(1);
    expect(outs[0].address).toBe(recipientAddress);
  }, 600_000);

  it("CONTROL: a pre-migration V2 Ask still auto-refunds through the migrated client", async () => {
    const daa = await currentDaaScore(rpc);
    const deadline = daa + REFUND_SPAN;
    v2Refundable = await lockV2("phase 3 — in-flight V2, refunded", deadline);
    txids.v2_lock_refunded = v2Refundable.lockTxid;
    await waitVerified(v2Refundable, "v2 refundable lock");

    await waitForDaa(deadline, "v2 refund deadline");
    const refundTxid = await maybeAutoRefund(rpc, v2Refundable);
    expect(
      refundTxid,
      "an in-flight V2 Ask did not refund after the migration — funds locked " +
        "before the wiring would be stranded on the public deploy"
    ).toBeTruthy();
    txids.v2_refund = refundTxid!;

    const outs = await rawOutputsFromIndexer(refundTxid!);
    expect(outs).toHaveLength(1);
    expect(outs[0].address).toBe(senderAddress);
    assertNoFeeOutput(outs, [senderAddress]);
  }, 600_000);

  it("status derivation resolves V2 from a FRESH connection", async () => {
    const fresh = await connectRpc({ networkId: NETWORK_ID, wrpcUrl: process.env.KASPA_WRPC_URL });
    try {
      const a = await deriveStatusFromChain(fresh, { ...v2Claimable, status: "open" });
      expect(a.verified).toBe(true);
      expect(a.status).toBe("answered");
      expect(a.claimTxid).toBe(txids.v2_claim);

      const b = await deriveStatusFromChain(fresh, { ...v2Refundable, status: "open" });
      expect(b.verified).toBe(true);
      expect(b.status).toBe("refunded");
    } finally {
      await fresh.disconnect();
    }
  }, 300_000);
});
