// Integration: the §3.3 "rebuild from chain" check, against the REAL TN10
// history of the funded test keys. The Phase 2 lifecycle transactions are
// permanent chain facts (txids recorded in PROGRESS.md); a rebuild with no
// local state must reconstruct them with correct statuses. Read-only:
// spends nothing.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Keypair, PrivateKey, RpcClient } from "kaspa-wasm";
import { connectRpc } from "../../src/lib/ask";
import { rebuildFromChain } from "../../src/lib/rebuild";

const NETWORK_ID = process.env.KASPA_NETWORK_ID || "testnet-10";
const KEYS_FILE = path.join(__dirname, "..", "..", "spike", ".keys.json");

// Phase 2 encrypted-lifecycle evidence (PROGRESS.md, 2026-08-03).
const ANSWERED_LOCK =
  "1a8bb02ee6d481c024ca462ad047e32f7935e5b9dd59ecc09dec082b722c03a3";
const ANSWERED_CLAIM =
  "3f02de726903e2709368254d144c82b0d2b6d867bd9597d4455dcdb1f08b9d60";
const REFUNDED_LOCK =
  "4bf4980c769516db2db1342d263c831b4b220fa38142b5d077dfa91f0949d4e7";
const REFUNDED_REFUND =
  "0d45a744714c7123213850807ef2b85e7b8e0a0e9ce6c4fb19dd717c6a3daeb3";

let rpc: RpcClient;
let senderAddress: string;
let recipientAddress: string;

beforeAll(async () => {
  if (!fs.existsSync(KEYS_FILE)) {
    throw new Error("spike/.keys.json missing — funded test keys required");
  }
  const raw = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  senderAddress = Keypair.fromPrivateKey(new PrivateKey(raw.senderPrivateKey))
    .toAddress(NETWORK_ID)
    .toString();
  recipientAddress = Keypair.fromPrivateKey(
    new PrivateKey(raw.recipientPrivateKey)
  )
    .toAddress(NETWORK_ID)
    .toString();
  rpc = await connectRpc({
    networkId: NETWORK_ID,
    wrpcUrl: process.env.KASPA_WRPC_URL,
  });
});

afterAll(async () => {
  await rpc?.disconnect();
});

describe("rebuild from chain (§3.3)", () => {
  it("reconstructs the sender's asks with chain-settled statuses", async () => {
    const records = await rebuildFromChain(rpc, senderAddress);
    const answered = records.find((r) => r.askRef === ANSWERED_LOCK);
    expect(answered, "answered lifecycle must be reconstructed").toBeDefined();
    expect(answered!.status).toBe("answered");
    expect(answered!.claimTxid).toBe(ANSWERED_CLAIM);
    expect(answered!.senderAddress).toBe(senderAddress);
    expect(answered!.recipientAddress).toBe(recipientAddress);
    expect(BigInt(answered!.amountSompi)).toBe(100_000_000n);

    const refunded = records.find((r) => r.askRef === REFUNDED_LOCK);
    expect(refunded, "refunded lifecycle must be reconstructed").toBeDefined();
    expect(refunded!.status).toBe("refunded");
    expect(refunded!.refundTxid).toBe(REFUNDED_REFUND);
    expect(BigInt(refunded!.amountSompi)).toBe(100_000_000n);

    // Every reconstructed record is §4-verified by construction; none may
    // claim a status the chain does not back.
    for (const r of records) {
      expect(["open", "answered", "refunded", "expired_pending_refund"]).toContain(r.status);
    }
  }, 300_000);

  it("recovers the answered ask from the recipient's side via the reply ref", async () => {
    const records = await rebuildFromChain(rpc, recipientAddress);
    const answered = records.find((r) => r.askRef === ANSWERED_LOCK);
    expect(answered, "recipient must recover the answered ask").toBeDefined();
    expect(answered!.status).toBe("answered");
    expect(answered!.claimTxid).toBe(ANSWERED_CLAIM);
  }, 300_000);
});
