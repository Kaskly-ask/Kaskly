// Integration suite: the full ASK lifecycle (A1-A5) and the R3 attack set,
// executed against the real covenant testnet (testnet-10). Requires
// spike/.keys.json with a faucet-funded sender (see spike/README.md).
// Run: npm run test:integration     (several minutes: real deadline waits)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  connectRpc,
  createAsk,
  getCovenantUtxo,
  currentDaaScore,
  startAskScanner,
  isChainRejection,
  xOnlyFromAddress,
  buildClaimTransaction,
  buildRefundTransaction,
  buildClaimSignatureScript,
  buildRefundSignatureScript,
  parseAskPayload,
  encodeReplyPayload,
  encryptKasia1,
  decryptKasia1,
  ASK_PREFIX,
  REFUND_FEE_ALLOWANCE,
} from "../../src/lib/ask";
import {
  Keypair,
  PrivateKey,
  RpcClient,
  createTransaction,
  createInputSignature,
  type IUtxoEntry,
} from "kaspa-wasm";

const NETWORK_ID = process.env.KASPA_NETWORK_ID || "testnet-10";
const KEYS_FILE = path.join(__dirname, "..", "..", "spike", ".keys.json");

const SHORT_DEADLINE = 600n; // ~60s at ~10 DAA/s (measured, finding F5)
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

async function waitPastDaa(target: bigint): Promise<void> {
  for (;;) {
    const daa = await currentDaaScore(rpc);
    if (daa >= target + 20n) return;
    await new Promise((r) => setTimeout(r, 10000));
  }
}

/** Append lifecycle evidence txids for PROGRESS.md (file is gitignored). */
function recordTxids(kind: string, txids: Record<string, string>) {
  const file = path.join(__dirname, ".txids.json");
  const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  cur[kind] = { ...txids, at: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(cur, null, 2));
}

/** REST fetch with retries — the local network path to api-tn10.kaspa.org
 * intermittently resets (seen repeatedly this session). */
interface RestTx {
  outputs: Array<{ script_public_key_address: string; amount: string | number }>;
  payload: string;
}

async function fetchJsonWithRetry(url: string, tries = 5): Promise<RestTx> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function expectChainRejection(txPromise: Promise<unknown>, label: string): Promise<string> {
  try {
    await txPromise;
  } catch (e) {
    if (isChainRejection(e)) return String((e as Error).message ?? e);
    throw new Error(`${label}: failed but NOT via chain rejection: ${e}`);
  }
  throw new Error(`${label}: transaction was ACCEPTED but must be rejected`);
}

beforeAll(async () => {
  if (!fs.existsSync(KEYS_FILE)) {
    throw new Error("spike/.keys.json missing — run node spike/01-keys.cjs and fund the sender");
  }
  const raw = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  sender = Keypair.fromPrivateKey(new PrivateKey(raw.senderPrivateKey));
  recipient = Keypair.fromPrivateKey(new PrivateKey(raw.recipientPrivateKey));
  senderAddress = sender.toAddress(NETWORK_ID).toString();
  recipientAddress = recipient.toAddress(NETWORK_ID).toString();
  rpc = await connectRpc({ networkId: NETWORK_ID, wrpcUrl: process.env.KASPA_WRPC_URL });
  const { balance } = await rpc.getBalanceByAddress({ address: senderAddress });
  if (BigInt(balance) < 500_000_000n) {
    throw new Error(`sender ${senderAddress} needs at least 5 TKAS from the faucet`);
  }
});

afterAll(async () => {
  await rpc?.disconnect();
});

describe("ASK lifecycle on testnet (A1-A5) + R3 attacks", () => {
  it("answers an Ask: lock -> discover -> attacks rejected -> claim-by-reply -> R2 verify", async () => {
    // --- A2 first: subscribe BEFORE creating so the scanner sees the lock.
    const seen: Array<{ kind: string; txid: string }> = [];
    const stopScanner = startAskScanner(rpc, (parsed, txid) => {
      if (parsed) seen.push({ kind: parsed.kind, txid });
    });

    // --- A1 CREATE (message is encrypted to the recipient inside createAsk)
    const deadlineDaa = (await currentDaaScore(rpc)) + LONG_DEADLINE;
    const created = await createAsk(rpc, NETWORK_ID, {
      senderAddress,
      senderPrivateKeyHex: sender.privateKey,
      recipientAddress,
      amount: 100_000_000n,
      message: "Integration test ask — please reply",
      deadlineDaa,
    });
    expect(created.lockTxid).toMatch(/^[0-9a-f]{64}$/);
    const utxo = await waitForUtxo(created.p2shAddress);
    expect(BigInt(utxo.amount)).toBe(100_000_000n);
    // Encrypted-only (Q4): the envelope must carry kasia1 ciphertext, the
    // plaintext must not appear, and the RECIPIENT's key must decrypt it.
    expect(created.envelope.msgEnc).toBe("kasia1");
    expect(created.envelope.message).not.toContain("Integration");
    expect(decryptKasia1(created.envelope.message, recipient.privateKey)).toBe(
      "Integration test ask — please reply"
    );

    // --- A2 NOTIFY: the firehose scanner must surface the ask
    const deadlineMs = Date.now() + 60_000;
    while (Date.now() < deadlineMs && !seen.some((s) => s.txid === created.lockTxid)) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    await stopScanner();
    expect(seen.some((s) => s.kind === "ask" && s.txid === created.lockTxid)).toBe(true);

    // --- R3: claim by wrong key (sender signs the claim branch)
    {
      const tx = createTransaction(
        [utxo],
        [{ address: recipientAddress, amount: BigInt(utxo.amount) - REFUND_FEE_ALLOWANCE }],
        0n,
        Buffer.from(
          `${ASK_PREFIX}r:` +
            JSON.stringify({ v: 1, ref: created.lockTxid, msgEnc: "plain", message: "x" })
        ).toString("hex"),
        1
      );
      const sig = createInputSignature(tx, 0, new PrivateKey(sender.privateKey));
      tx.inputs[0].signatureScript = buildClaimSignatureScript(created.redeemScriptHex, sig);
      const msg = await expectChainRejection(
        rpc.submitTransaction({ transaction: tx }),
        "wrong-key claim"
      );
      expect(msg).toMatch(/false stack entry|signature invalid/);
    }

    // --- R3: claim with NO payload
    {
      const tx = createTransaction(
        [utxo],
        [{ address: recipientAddress, amount: BigInt(utxo.amount) - REFUND_FEE_ALLOWANCE }],
        0n,
        undefined,
        1
      );
      const sig = createInputSignature(tx, 0, new PrivateKey(recipient.privateKey));
      tx.inputs[0].signatureScript = buildClaimSignatureScript(created.redeemScriptHex, sig);
      const msg = await expectChainRejection(
        rpc.submitTransaction({ transaction: tx }),
        "no-payload claim"
      );
      expect(msg).toMatch(/out of bounds/);
    }

    // --- R3: claim with WRONG-NAMESPACE payload (a Kasia comm payload)
    {
      const tx = createTransaction(
        [utxo],
        [{ address: recipientAddress, amount: BigInt(utxo.amount) - REFUND_FEE_ALLOWANCE }],
        0n,
        Buffer.from("ciph_msg:1:comm:aabbccddeeff:SGVsbG8=", "utf8").toString("hex"),
        1
      );
      const sig = createInputSignature(tx, 0, new PrivateKey(recipient.privateKey));
      tx.inputs[0].signatureScript = buildClaimSignatureScript(created.redeemScriptHex, sig);
      const msg = await expectChainRejection(
        rpc.submitTransaction({ transaction: tx }),
        "wrong-namespace claim"
      );
      expect(msg).toMatch(/script ran, but verification failed|false stack entry/);
    }

    // --- R3: refund before deadline (deadline is far in the future)
    {
      const tx = buildRefundTransaction({
        covenantUtxo: utxo,
        redeemScriptHex: created.redeemScriptHex,
        senderAddress,
        deadlineDaa,
        minRefund: created.minRefund,
      });
      const msg = await expectChainRejection(
        rpc.submitTransaction({ transaction: tx }),
        "early refund"
      );
      expect(msg).toMatch(/not finalized/);
    }

    // --- A3 CLAIM-BY-REPLY (legitimate; reply encrypted to the SENDER)
    const claimTx = buildClaimTransaction({
      networkId: NETWORK_ID,
      covenantUtxo: utxo,
      redeemScriptHex: created.redeemScriptHex,
      recipientAddress,
      recipientPrivateKeyHex: recipient.privateKey,
      lockTxid: created.lockTxid,
      replyText: "Reply from the test suite",
      senderAddress,
    });
    const { transactionId: claimTxid } = await rpc.submitTransaction({ transaction: claimTx });
    expect(claimTxid).toMatch(/^[0-9a-f]{64}$/);

    // --- R3: double-claim (replay the same claim)
    {
      const msg = await expectChainRejection(
        rpc.submitTransaction({ transaction: claimTx }),
        "double-claim"
      );
      expect(msg).toMatch(/already|orphan|missing|spent/i);
    }

    // --- R2 dual verification from an independent source (REST decode)
    const rest = await fetchJsonWithRetry(
      `https://api-tn10.kaspa.org/transactions/${claimTxid}?inputs=true&outputs=true`
    );
    expect(rest.outputs).toHaveLength(1);
    expect(rest.outputs[0].script_public_key_address).toBe(recipientAddress);
    expect(BigInt(rest.outputs[0].amount)).toBe(100_000_000n - REFUND_FEE_ALLOWANCE);
    const parsedReply = parseAskPayload(rest.payload);
    expect(parsedReply?.kind).toBe("reply");
    if (parsedReply?.kind === "reply") {
      expect(parsedReply.envelope.ref).toBe(created.lockTxid);
      // On-chain reply is ciphertext; only the SENDER's key opens it.
      expect(parsedReply.envelope.msgEnc).toBe("kasia1");
      expect(parsedReply.envelope.message).not.toContain("Reply");
      expect(decryptKasia1(parsedReply.envelope.message, sender.privateKey)).toBe(
        "Reply from the test suite"
      );
    }
    recordTxids("answered", { lock: created.lockTxid, claim: claimTxid });
  });

  it("refunds an ignored Ask: lock -> deadline -> attacks rejected -> sig-less refund -> late claim rejected", async () => {
    // --- A1 CREATE with a short deadline
    const deadlineDaa = (await currentDaaScore(rpc)) + SHORT_DEADLINE;
    const created = await createAsk(rpc, NETWORK_ID, {
      senderAddress,
      senderPrivateKeyHex: sender.privateKey,
      recipientAddress,
      amount: 100_000_000n,
      message: "Integration test ask — will be ignored",
      deadlineDaa,
    });
    const utxo = await waitForUtxo(created.p2shAddress);

    // --- A4: wait out the deadline
    await waitPastDaa(deadlineDaa);

    // --- R3: refund to a NON-SENDER address (covenant pins destination)
    {
      const tx = createTransaction(
        [utxo],
        [{ address: recipientAddress, amount: created.minRefund }],
        0n,
        undefined,
        0
      );
      tx.lockTime = deadlineDaa;
      tx.inputs[0].sequence = 0n;
      tx.inputs[0].signatureScript = buildRefundSignatureScript(created.redeemScriptHex);
      const msg = await expectChainRejection(
        rpc.submitTransaction({ transaction: tx }),
        "wrong-destination refund"
      );
      expect(msg).toMatch(/verification failed|false stack entry/);
    }

    // --- R3: refund with an unexpected EXTRA OUTPUT (count pinned to 1)
    {
      const half = created.minRefund / 2n;
      const tx = createTransaction(
        [utxo],
        [
          { address: senderAddress, amount: half },
          { address: senderAddress, amount: created.minRefund - half },
        ],
        0n,
        undefined,
        0
      );
      tx.lockTime = deadlineDaa;
      tx.inputs[0].sequence = 0n;
      tx.inputs[0].signatureScript = buildRefundSignatureScript(created.redeemScriptHex);
      const msg = await expectChainRejection(
        rpc.submitTransaction({ transaction: tx }),
        "two-output refund"
      );
      expect(msg).toMatch(/verification failed|false stack entry/);
    }

    // --- R3: skimmed refund (pays sender less; difference to miners)
    {
      const tx = createTransaction(
        [utxo],
        [{ address: senderAddress, amount: created.minRefund - 100_000n }],
        0n,
        undefined,
        0
      );
      tx.lockTime = deadlineDaa;
      tx.inputs[0].sequence = 0n;
      tx.inputs[0].signatureScript = buildRefundSignatureScript(created.redeemScriptHex);
      const msg = await expectChainRejection(
        rpc.submitTransaction({ transaction: tx }),
        "skimmed refund"
      );
      expect(msg).toMatch(/verification failed|false stack entry/);
    }

    // --- A4 REFUND (legitimate, sig-less, anyone-can-trigger)
    const refundTx = buildRefundTransaction({
      covenantUtxo: utxo,
      redeemScriptHex: created.redeemScriptHex,
      senderAddress,
      deadlineDaa,
      minRefund: created.minRefund,
    });
    const { transactionId: refundTxid } = await rpc.submitTransaction({ transaction: refundTx });
    expect(refundTxid).toMatch(/^[0-9a-f]{64}$/);

    // --- R3: double-refund (replay)
    {
      const msg = await expectChainRejection(
        rpc.submitTransaction({ transaction: refundTx }),
        "double-refund"
      );
      expect(msg).toMatch(/already|orphan|missing|spent/i);
    }

    // --- A5 / R3: late claim after the refund — chain must reject
    {
      const tx = createTransaction(
        [utxo],
        [{ address: recipientAddress, amount: BigInt(utxo.amount) - REFUND_FEE_ALLOWANCE }],
        0n,
        encodeReplyPayload({
          v: 1,
          ref: created.lockTxid,
          msgEnc: "kasia1",
          message: encryptKasia1(xOnlyFromAddress(senderAddress), "too late"),
        }),
        1
      );
      const sig = createInputSignature(tx, 0, new PrivateKey(recipient.privateKey));
      tx.inputs[0].signatureScript = buildClaimSignatureScript(created.redeemScriptHex, sig);
      const msg = await expectChainRejection(
        rpc.submitTransaction({ transaction: tx }),
        "late claim after refund"
      );
      expect(msg).toMatch(/orphan|already|missing|spent/i);
    }

    // --- R2 dual verification of the refund, recomputed from the consensus
    // UTXO set via a FRESH RPC connection (independent of the submitting
    // node; REST is used in the claim test — this path avoids the flaky
    // local route to api-tn10.kaspa.org).
    const verifyRpc = await connectRpc({ networkId: NETWORK_ID });
    try {
      let refundUtxo: { outpoint: { transactionId: string; index: number }; amount: bigint } | undefined;
      for (let i = 0; i < 20 && !refundUtxo; i++) {
        const { entries } = await verifyRpc.getUtxosByAddresses({ addresses: [senderAddress] });
        refundUtxo = (entries as unknown as Array<{ outpoint: { transactionId: string; index: number }; amount: bigint }>).find(
          (u) => u.outpoint.transactionId === refundTxid
        );
        if (!refundUtxo) await new Promise((r) => setTimeout(r, 3000));
      }
      expect(refundUtxo, "refund output must appear in the sender's UTXO set").toBeDefined();
      expect(refundUtxo!.outpoint.index).toBe(0);
      expect(BigInt(refundUtxo!.amount)).toBe(created.minRefund);
      // The covenant address must be fully drained (all-or-nothing).
      const { entries: covLeft } = await verifyRpc.getUtxosByAddresses({
        addresses: [created.p2shAddress],
      });
      expect(covLeft).toHaveLength(0);
    } finally {
      await verifyRpc.disconnect();
    }
    recordTxids("refunded", { lock: created.lockTxid, refund: refundTxid });
  });

  it("xOnlyFromAddress matches the key the recipient actually controls", () => {
    expect(xOnlyFromAddress(recipientAddress)).toBe(
      new PrivateKey(recipient.privateKey).toKeypair().xOnlyPublicKey.toString()
    );
  });
});
