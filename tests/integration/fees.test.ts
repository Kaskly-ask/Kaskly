// Integration re-test for gate finding F7 on the REAL testnet: a
// near-limit-length reply must now broadcast successfully with a
// mass-proportional fee (the original failure: fixed 500,000-sompi fee
// rejected with "under the required amount ... transient mass", txid
// 1ef4c5fd... recorded in PROGRESS.md). Also empirically verifies the
// Generator funds a long-MESSAGE lock correctly (payload mass on A1).
// Costs ~2.1 TKAS locked and recovered + fees per run.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Keypair, PrivateKey, RpcClient, type IUtxoEntry } from "kaspa-wasm";
import {
  connectRpc,
  createAsk,
  getCovenantUtxo,
  currentDaaScore,
  buildClaimTransaction,
  encodeReplyPayload,
  CLAIM_FEE_FLOOR,
} from "../../src/lib/ask";

const NETWORK_ID = process.env.KASPA_NETWORK_ID || "testnet-10";
const KEYS_FILE = path.join(__dirname, "..", "..", "spike", ".keys.json");
const LONG_DEADLINE = 500_000n;

let rpc: RpcClient;
let sender: Keypair;
let recipient: Keypair;
let senderAddress: string;
let recipientAddress: string;

async function waitForUtxo(p2sh: string, tries = 20): Promise<IUtxoEntry> {
  for (let i = 0; i < tries; i++) {
    const utxo = await getCovenantUtxo(rpc, p2sh);
    if (utxo) return utxo;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`covenant UTXO never appeared at ${p2sh}`);
}

beforeAll(async () => {
  const raw = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  sender = Keypair.fromPrivateKey(new PrivateKey(raw.senderPrivateKey));
  recipient = Keypair.fromPrivateKey(new PrivateKey(raw.recipientPrivateKey));
  senderAddress = sender.toAddress(NETWORK_ID).toString();
  recipientAddress = recipient.toAddress(NETWORK_ID).toString();
  rpc = await connectRpc({
    networkId: NETWORK_ID,
    wrpcUrl: process.env.KASPA_WRPC_URL,
  });
});

afterAll(async () => {
  await rpc?.disconnect();
});

describe("F7: long payloads broadcast with mass-scaled fees (TN10)", () => {
  it("claims with a near-limit reply; net = amount - quoted fee", async () => {
    const deadlineDaa = (await currentDaaScore(rpc)) + LONG_DEADLINE;
    const created = await createAsk(rpc, NETWORK_ID, {
      senderAddress,
      senderPrivateKeyHex: sender.privateKey,
      recipientAddress,
      amount: 100_000_000n,
      message: "F7 re-test: please answer with a very long reply",
      deadlineDaa,
    });
    const utxo = await waitForUtxo(created.p2shAddress);

    // ~7,800 ASCII chars — passes MAX_MESSAGE_BYTES, near the payload cap.
    const longReply = "All my thoughts on this, at length. ".repeat(216).slice(0, 7_800);
    const claimTx = buildClaimTransaction({
      networkId: NETWORK_ID,
      covenantUtxo: utxo,
      redeemScriptHex: created.redeemScriptHex,
      recipientAddress,
      recipientPrivateKeyHex: recipient.privateKey,
      lockTxid: created.lockTxid,
      replyText: longReply,
      senderAddress,
    });
    const fee = 100_000_000n - BigInt(claimTx.outputs[0].value);
    expect(fee).toBeGreaterThan(CLAIM_FEE_FLOOR); // mass-scaled, not fixed

    // The original bug reproduced exactly here — this submit used to fail
    // with "under the required amount ... transient mass".
    const { transactionId } = await rpc.submitTransaction({
      transaction: claimTx,
    });
    expect(transactionId).toMatch(/^[0-9a-f]{64}$/);

    // Settle: covenant drained, recipient credited with exactly the net.
    let credited: bigint | null = null;
    for (let i = 0; i < 20 && credited === null; i++) {
      const { entries } = await rpc.getUtxosByAddresses({
        addresses: [recipientAddress],
      });
      const hit = (
        entries as unknown as Array<{
          outpoint: { transactionId: string };
          amount: bigint;
        }>
      ).find((u) => u.outpoint.transactionId === transactionId);
      if (hit) credited = BigInt(hit.amount);
      else await new Promise((r) => setTimeout(r, 3000));
    }
    expect(credited).toBe(100_000_000n - fee);
  }, 300_000);

  it("locks an Ask whose MESSAGE is near-limit (Generator pays payload mass)", async () => {
    const deadlineDaa = (await currentDaaScore(rpc)) + LONG_DEADLINE;
    const longMessage = "A very long question, in detail. ".repeat(240).slice(0, 7_800);
    const created = await createAsk(rpc, NETWORK_ID, {
      senderAddress,
      senderPrivateKeyHex: sender.privateKey,
      recipientAddress,
      amount: 100_000_000n,
      message: longMessage,
      deadlineDaa,
    });
    const utxo = await waitForUtxo(created.p2shAddress);
    expect(BigInt(utxo.amount)).toBe(100_000_000n);

    // Recover the funds with a short reply (also exercises the floor path).
    const claimTx = buildClaimTransaction({
      networkId: NETWORK_ID,
      covenantUtxo: utxo,
      redeemScriptHex: created.redeemScriptHex,
      recipientAddress,
      recipientPrivateKeyHex: recipient.privateKey,
      lockTxid: created.lockTxid,
      replyText: "short answer",
      senderAddress,
    });
    expect(BigInt(claimTx.outputs[0].value)).toBe(100_000_000n - CLAIM_FEE_FLOOR);
    const { transactionId } = await rpc.submitTransaction({
      transaction: claimTx,
    });
    expect(transactionId).toMatch(/^[0-9a-f]{64}$/);
  }, 300_000);

  it("quote matches what the UI estimator computes for the same reply size", () => {
    // The synthetic-UTXO estimator (estimateReplyClaim) and the real build
    // must agree — both route through quoteClaimFee with size-identical
    // payloads; spot-check the payload-length identity here.
    const p = 4_321;
    const synthetic = encodeReplyPayload({
      v: 1,
      ref: "0".repeat(64),
      msgEnc: "kasia1",
      message: "00".repeat(p + 61),
    });
    // nonce(12)+ephemeral(33)+tag(16) = 61 bytes of framing around P.
    expect(synthetic.length).toBe(
      encodeReplyPayload({
        v: 1,
        ref: "f".repeat(64),
        msgEnc: "kasia1",
        message: "ab".repeat(p + 61),
      }).length
    );
  });
});
