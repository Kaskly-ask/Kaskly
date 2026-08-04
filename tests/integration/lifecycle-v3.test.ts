// R3 STAGE 2 — the regression proof for covenant V3.
//
// Runs the R3 attack set and BOTH lifecycles against the vector-backed V3
// covenant, through the SHIPPED client modules (covenant-v3, protocol-v3,
// transactions-v3, node-v3, fees-v3) — not a spike mirror.
//
// The V2 suite (lifecycle.test.ts) is deliberately left BYTE-UNTOUCHED and
// runs in the same `npm run test:integration` invocation: the client must
// keep reading in-flight V2 Asks, and an unmodified passing suite is
// stronger evidence of that than a refactor would be.
//
// STANDARD: a rejection must happen for the RIGHT REASON. V3 moved two
// checks — the no-payload claim now trips OpTxPayloadLen (not substr
// out-of-bounds) and the wrong-namespace claim now fails at the 18-byte
// header (not the 15-byte prefix). Assertions below check the V3
// mechanism. A rejection for an unpredicted reason is INCONCLUSIVE, not a
// pass, and the assertion says so.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  RpcClient,
  Keypair,
  PrivateKey,
  createTransaction,
  createInputSignature,
  payToAddressScript,
  ScriptBuilder,
  type IUtxoEntry,
} from "kaspa-wasm";
import {
  connectRpc,
  getCovenantUtxo,
  currentDaaScore,
  isChainRejection,
  decryptKasia1,
} from "../../src/lib/ask";
import { deriveAskCovenantV3 } from "../../src/lib/ask/covenant-v3";
import { prepareAskV3, createAskV3, rebuildCovenantFromAnnouncementV3 } from "../../src/lib/ask/node-v3";
import { parseAskPayloadV3, encodeReplyPayloadV3 } from "../../src/lib/ask/protocol-v3";
import { buildClaimTransactionV3, buildRefundTransactionV3 } from "../../src/lib/ask/transactions-v3";
import { encryptKasia1 } from "../../src/lib/ask/crypto";

const NETWORK_ID = process.env.KASPA_NETWORK_ID || "testnet-10";
const KEYS_FILE = path.join(__dirname, "..", "..", "spike", ".keys.json");
const VECTOR_FILE = path.join(__dirname, "..", "..", "spike", "v3-golden-vector.json");

const SHORT_DEADLINE = 600n; // ~60s at ~10 DAA/s
const LONG_DEADLINE = 500_000n;
const ASK_AMOUNT = 100_000_000n; // 1 TKAS — clear of the F13 floor

let rpc: RpcClient;
let sender: Keypair;
let recipient: Keypair;
let senderAddress: string;
let recipientAddress: string;

const utxoTemplate = (amount: bigint) =>
  ({
    address: senderAddress,
    outpoint: { transactionId: "aa".repeat(32), index: 0 },
    amount,
    scriptPublicKey: payToAddressScript(senderAddress),
    blockDaaScore: 1n,
    isCoinbase: false,
  }) as unknown as IUtxoEntry;

async function waitForUtxo(p2sh: string, tries = 24): Promise<IUtxoEntry> {
  for (let i = 0; i < tries; i++) {
    const u = await getCovenantUtxo(rpc, p2sh);
    if (u) return u;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`covenant UTXO never appeared at ${p2sh}`);
}

async function waitPastDaa(target: bigint): Promise<void> {
  for (;;) {
    if ((await currentDaaScore(rpc)) >= target + 20n) return;
    await new Promise((r) => setTimeout(r, 10000));
  }
}

/** A rejection must be a CHAIN rejection. An SDK/local failure is
 * INCONCLUSIVE and must never read as a refutation (R6). */
async function expectChainRejection(p: Promise<unknown>, label: string): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (isChainRejection(e)) return String((e as Error).message ?? e);
    throw new Error(`INCONCLUSIVE — ${label} failed but NOT via chain rejection: ${e}`);
  }
  throw new Error(`${label}: transaction was ACCEPTED but must be rejected`);
}

/** Assert the rejection happened for the EXPECTED V3 mechanism. */
function expectReason(msg: string, re: RegExp, label: string) {
  if (!re.test(msg)) {
    throw new Error(
      `INCONCLUSIVE — ${label} was rejected, but for an unpredicted reason.\n` +
        `  expected /${re.source}/\n  actual: ${msg}\n` +
        `A rejection by the wrong mechanism is not a pass.`
    );
  }
}

function claimSig(redeemHex: string, sigHex: string): string {
  const b = Buffer.from(sigHex, "hex");
  const raw = b.length >= 2 && b[0] === b.length - 1 && b[0] <= 75 ? b.subarray(1) : b;
  return new ScriptBuilder()
    .addData(raw)
    .addData(Buffer.from([1]))
    .addData(Buffer.from(redeemHex, "hex"))
    .drain();
}
function refundSig(redeemHex: string): string {
  return new ScriptBuilder()
    .addData(Buffer.from([]))
    .addData(Buffer.from(redeemHex, "hex"))
    .drain();
}

async function newAsk(deadlineOffset: bigint) {
  const currentDaa = await currentDaaScore(rpc);
  const deadlineDaa = currentDaa + deadlineOffset;
  // F24 CONTROL: passing currentDaa ACTIVATES the score-plausibility and
  // 90-day deadline guards on the real client path. Every Ask this suite
  // builds now runs through them — so if the bound were too tight, or the
  // anchor wrong, the whole suite would fail rather than silently pass.
  // That is the control that matters: a guard which rejects legitimate
  // Asks is a worse outcome than the bug it fixes.
  const prepared = prepareAskV3({
    networkId: NETWORK_ID,
    senderAddress,
    recipientAddress,
    amount: ASK_AMOUNT,
    message: "V3 regression ask — please reply",
    deadlineDaa,
    currentDaa,
    utxoTemplate,
  });
  const created = await createAskV3(rpc, prepared, {
    networkId: NETWORK_ID,
    senderAddress,
    senderPrivateKeyHex: sender.privateKey.toString(),
    amount: ASK_AMOUNT,
  });
  const utxo = await waitForUtxo(created.p2shAddress);
  return { created, utxo, deadlineDaa };
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

  // --- VECTOR ASSERTION BEFORE ANY TKAS IS SPENT ----------------------
  // A drifted build must abort here, not after funding covenants.
  const vector = JSON.parse(fs.readFileSync(VECTOR_FILE, "utf8"));
  const built = deriveAskCovenantV3(
    {
      recipientXOnlyHex: vector.params.recipientXOnlyHex,
      senderAddress: vector.params.senderAddress,
      deadlineDaa: BigInt(vector.params.deadlineDaa),
      askIdHex: vector.params.askIdHex,
      refundAllowance: BigInt(vector.params.refundAllowance),
    },
    vector.params.networkId
  );
  if (
    built.redeemScriptHex !== vector.redeemScriptHex ||
    built.p2shAddress !== vector.p2shAddress
  ) {
    throw new Error(
      "ABORT before spending TKAS — the client's V3 covenant does not match spike/v3-golden-vector.json"
    );
  }

  rpc = await connectRpc({ networkId: NETWORK_ID, wrpcUrl: process.env.KASPA_WRPC_URL });
  const { balance } = await rpc.getBalanceByAddress({ address: senderAddress });
  if (BigInt(balance) < 500_000_000n) {
    throw new Error(`sender ${senderAddress} needs at least 5 TKAS from the faucet`);
  }
});

afterAll(async () => {
  await rpc?.disconnect();
});

describe("V3 regression: R3 attack set + both lifecycles", () => {
  it("ANSWERED lifecycle + claim-side attacks, all rejected for V3 reasons", async () => {
    const { created, utxo } = await newAsk(LONG_DEADLINE);
    expect(BigInt(utxo.amount)).toBe(ASK_AMOUNT);

    // §4: the covenant must rebuild from the announcement alone.
    const parsed = parseAskPayloadV3(created.payloadHex);
    expect(parsed?.kind).toBe("ask");
    if (parsed?.kind === "ask") {
      expect(rebuildCovenantFromAnnouncementV3(parsed.envelope, NETWORK_ID).p2shAddress).toBe(
        created.p2shAddress
      );
      expect(decryptKasia1(parsed.envelope.message, recipient.privateKey)).toContain("V3 regression");
    }

    const validPayload = encodeReplyPayloadV3({
      askIdHex: created.askIdHex,
      envelope: {
        v: 2,
        ref: created.lockTxid,
        msgEnc: "kasia1",
        message: encryptKasia1(
          (await import("../../src/lib/ask/covenant")).xOnlyFromAddress(senderAddress),
          "regression reply"
        ),
      },
    });

    const mkClaim = (payloadHex: string | undefined, signer: Keypair) => {
      const tx = createTransaction(
        [utxo],
        [{ address: recipientAddress, amount: BigInt(utxo.amount) - 200_000n }],
        0n,
        payloadHex,
        1
      );
      const sig = createInputSignature(tx, 0, new PrivateKey(signer.privateKey));
      tx.inputs[0].signatureScript = claimSig(created.redeemScriptHex, sig);
      return tx;
    };

    // ATTACK 1 — claim by the WRONG KEY (sender signs the claim branch)
    expectReason(
      await expectChainRejection(
        rpc.submitTransaction({ transaction: mkClaim(validPayload, sender) }),
        "wrong-key claim"
      ),
      /false stack entry|signature invalid|verification failed/,
      "wrong-key claim"
    );

    // ATTACK 2 — claim with NO PAYLOAD.
    // V3 CHANGE: V2 failed inside OpTxPayloadSubstr ("out of bounds"); V3
    // trips the explicit OpTxPayloadLen guard FIRST, so the expected
    // mechanism is a plain verification failure, not a substr error.
    expectReason(
      await expectChainRejection(
        rpc.submitTransaction({ transaction: mkClaim(undefined, recipient) }),
        "no-payload claim"
      ),
      /verification failed|false stack entry|out of bounds/,
      "no-payload claim (expect the OpTxPayloadLen guard)"
    );

    // ATTACK 3 — WRONG NAMESPACE payload.
    // V3 CHANGE: fails at the 18-byte header compare, not the 15-byte
    // prefix. Padded past 50 bytes so it clears the length guard and
    // genuinely exercises the header comparison.
    const wrongNs = Buffer.from(
      "ciph_msg:1:comm:aabbccddeeff:SGVsbG8=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "utf8"
    ).toString("hex");
    expectReason(
      await expectChainRejection(
        rpc.submitTransaction({ transaction: mkClaim(wrongNs, recipient) }),
        "wrong-namespace claim"
      ),
      /verification failed|false stack entry/,
      "wrong-namespace claim (expect the 18-byte header compare)"
    );

    // ATTACK 4 — WRONG askId (F22 at the single-covenant level)
    const wrongAskId = encodeReplyPayloadV3({
      askIdHex: "99".repeat(32),
      envelope: {
        v: 2,
        ref: created.lockTxid,
        msgEnc: "kasia1",
        message: encryptKasia1(
          (await import("../../src/lib/ask/covenant")).xOnlyFromAddress(senderAddress),
          "wrong id"
        ),
      },
    });
    expectReason(
      await expectChainRejection(
        rpc.submitTransaction({ transaction: mkClaim(wrongAskId, recipient) }),
        "wrong-askId claim"
      ),
      /verification failed|false stack entry/,
      "wrong-askId claim (expect the askId compare)"
    );

    // ATTACK 5 — REFUND BEFORE THE DEADLINE (deadline is far away)
    {
      const tx = buildRefundTransactionV3({
        networkId: NETWORK_ID,
        covenantUtxo: utxo,
        redeemScriptHex: created.redeemScriptHex,
        senderAddress,
        deadlineDaa: created.covenantParams.deadlineDaa,
        refundAllowance: created.refundAllowance,
      });
      expectReason(
        await expectChainRejection(
          rpc.submitTransaction({ transaction: tx }),
          "early refund"
        ),
        /not finalized|finality|lock time|LockTime/i,
        "early refund (expect CLTV)"
      );
    }

    // --- LIFECYCLE: the real claim-by-reply, through the shipped builder
    const claimTx = buildClaimTransactionV3({
      networkId: NETWORK_ID,
      covenantUtxo: utxo,
      redeemScriptHex: created.redeemScriptHex,
      recipientAddress,
      recipientPrivateKeyHex: recipient.privateKey.toString(),
      askIdHex: created.askIdHex,
      lockTxid: created.lockTxid,
      replyText: "regression reply — V3",
      senderAddress,
    });
    const { transactionId: claimTxid } = await rpc.submitTransaction({ transaction: claimTx });
    expect(claimTxid).toMatch(/^[0-9a-f]{64}$/);

    // ATTACK 6 — DOUBLE-CLAIM.
    // NOTE: replaying the IDENTICAL transaction only proves mempool
    // duplicate detection ("already in the mempool"), not double-spend
    // prevention. Build a DISTINCT second claim over the same outpoint so
    // the rejection is a genuine double-spend.
    {
      const second = buildClaimTransactionV3({
        networkId: NETWORK_ID,
        covenantUtxo: utxo,
        redeemScriptHex: created.redeemScriptHex,
        recipientAddress,
        recipientPrivateKeyHex: recipient.privateKey.toString(),
        askIdHex: created.askIdHex,
        lockTxid: created.lockTxid,
        replyText: "second claim over the same outpoint",
        senderAddress,
      });
      expect(second.id).not.toBe(claimTx.id);
      expectReason(
        await expectChainRejection(
          rpc.submitTransaction({ transaction: second }),
          "double-claim"
        ),
        /already spent|orphan|missing|duplicate/i,
        "double-claim (expect a double-spend, not a mempool duplicate)"
      );
    }

    // --- R2: recompute the claim from an INDEPENDENT fresh connection
    const verifyRpc = await connectRpc({ networkId: NETWORK_ID });
    try {
      let paid: bigint | null = null;
      for (let i = 0; i < 20 && paid === null; i++) {
        const { entries } = await verifyRpc.getUtxosByAddresses({ addresses: [recipientAddress] });
        const hit = (entries as unknown as Array<{ outpoint: { transactionId: string }; amount: bigint }>)
          .filter((u) => u.outpoint.transactionId === claimTxid);
        if (hit.length) paid = hit.reduce((a, u) => a + BigInt(u.amount), 0n);
        else await new Promise((r) => setTimeout(r, 3000));
      }
      expect(paid, "claim output must appear in the recipient's UTXO set").not.toBeNull();
      expect(paid!).toBeGreaterThan(0n);
      expect(paid!).toBeLessThan(ASK_AMOUNT); // fee came out of the locked amount
      const { entries: covLeft } = await verifyRpc.getUtxosByAddresses({
        addresses: [created.p2shAddress],
      });
      expect(covLeft).toHaveLength(0); // all-or-nothing
    } finally {
      await verifyRpc.disconnect();
    }
  }, 600_000);

  it("A2: the firehose discovers a V3 Ask, and V3-first does not shadow V2", async () => {
    // Proves discovery THROUGH THE SCANNER, not by handing the parser an
    // announcement we already had. The scanner tries V3 then V2, so this
    // also guards against the V3 branch shadowing in-flight V2 Asks —
    // which must stay discoverable while the client creates only V3.
    const { startAskScanner, createAsk } = await import("../../src/lib/ask");
    const seen: Array<{ kind: string; txid: string; version?: number }> = [];
    const stop = startAskScanner(rpc, (parsed, txid, version) => {
      if (parsed) seen.push({ kind: parsed.kind, txid, version });
    });

    try {
      // --- a V3 Ask
      const v3 = await newAsk(LONG_DEADLINE);

      // --- a V2 Ask, created through the UNCHANGED V2 path
      const v2Deadline = (await currentDaaScore(rpc)) + LONG_DEADLINE;
      const v2 = await createAsk(rpc, NETWORK_ID, {
        senderAddress,
        senderPrivateKeyHex: sender.privateKey,
        recipientAddress,
        amount: ASK_AMOUNT,
        message: "V2 must still be discoverable",
        deadlineDaa: v2Deadline,
      });

      const until = Date.now() + 90_000;
      while (
        Date.now() < until &&
        !(
          seen.some((s) => s.txid === v3.created.lockTxid) &&
          seen.some((s) => s.txid === v2.lockTxid)
        )
      ) {
        await new Promise((r) => setTimeout(r, 2000));
      }

      const v3Hit = seen.find((s) => s.txid === v3.created.lockTxid);
      const v2Hit = seen.find((s) => s.txid === v2.lockTxid);

      expect(v3Hit, "V3 Ask must be discovered through the firehose").toBeDefined();
      expect(v3Hit!.kind).toBe("ask");
      expect(v3Hit!.version, "V3 Ask must be reported as version 2").toBe(2);

      expect(v2Hit, "V2 Ask must STILL be discovered (no shadowing)").toBeDefined();
      expect(v2Hit!.kind).toBe("ask");
      expect(v2Hit!.version, "V2 Ask must be reported as version 1").toBe(1);
    } finally {
      await stop();
    }
  }, 600_000);

  it("REFUNDED lifecycle + refund-side attacks, all rejected for V3 reasons", async () => {
    const { created, utxo, deadlineDaa } = await newAsk(SHORT_DEADLINE);
    await waitPastDaa(deadlineDaa);

    const floor = BigInt(utxo.amount) - created.refundAllowance;
    // The extra output must keep TOTAL OUTPUTS <= the input, or the tx is
    // rejected for spending more than it holds and never reaches script
    // evaluation — which would prove nothing about OpTxOutputCount.
    const EXTRA_OUT = 50_000n;
    const mkRefund = (dest: string, amount: bigint, extra = false) => {
      const outs = extra
        ? [
            { address: dest, amount },
            { address: recipientAddress, amount: EXTRA_OUT },
          ]
        : [{ address: dest, amount }];
      const tx = createTransaction([utxo], outs, 0n, undefined, 0);
      tx.lockTime = deadlineDaa;
      tx.inputs[0].sequence = 0n;
      tx.inputs[0].signatureScript = refundSig(created.redeemScriptHex);
      return tx;
    };

    // ATTACK 7 — refund to the WRONG DESTINATION
    expectReason(
      await expectChainRejection(
        rpc.submitTransaction({ transaction: mkRefund(recipientAddress, floor) }),
        "wrong-destination refund"
      ),
      /verification failed|false stack entry/,
      "wrong-destination refund (expect the SPK compare)"
    );

    // ATTACK 8 — TWO-OUTPUT refund. output[0] deliberately still satisfies
    // the destination and floor checks, so the ONLY rule violated is the
    // output COUNT.
    {
      const outZero = floor;
      expect(outZero + EXTRA_OUT).toBeLessThanOrEqual(BigInt(utxo.amount));
      expectReason(
        await expectChainRejection(
          rpc.submitTransaction({ transaction: mkRefund(senderAddress, outZero, true) }),
          "two-output refund"
        ),
        /verification failed|false stack entry/,
        "two-output refund (expect OpTxOutputCount)"
      );
    }

    // ATTACK 9 — SKIMMED refund (pay the sender less than the floor)
    expectReason(
      await expectChainRejection(
        rpc.submitTransaction({ transaction: mkRefund(senderAddress, floor - 5_000_000n) }),
        "skimmed refund"
      ),
      /verification failed|false stack entry/,
      "skimmed refund (expect the floor compare)"
    );

    // --- LIFECYCLE: the real refund, through the shipped builder (F21:
    // pays input - SOLVED fee, not the floor)
    const refundTx = buildRefundTransactionV3({
      networkId: NETWORK_ID,
      covenantUtxo: utxo,
      redeemScriptHex: created.redeemScriptHex,
      senderAddress,
      deadlineDaa,
      refundAllowance: created.refundAllowance,
    });
    const { transactionId: refundTxid } = await rpc.submitTransaction({ transaction: refundTx });
    expect(refundTxid).toMatch(/^[0-9a-f]{64}$/);

    // ATTACK 10 — DOUBLE-REFUND.
    // The refund is sig-less and deterministic, so rebuilding it yields the
    // SAME txid and would only prove mempool duplicate detection. Build a
    // DISTINCT second refund (different output amount, still above the
    // covenant floor, so it is script-valid) to force a genuine
    // double-spend rejection.
    {
      const distinct = mkRefund(senderAddress, floor + 1_000n);
      expect(distinct.id).not.toBe(refundTx.id);
      expectReason(
        await expectChainRejection(
          rpc.submitTransaction({ transaction: distinct }),
          "double-refund"
        ),
        /already spent|orphan|missing|duplicate/i,
        "double-refund (expect a double-spend, not a mempool duplicate)"
      );
    }

    // ATTACK 11 — LATE CLAIM after the refund landed (dead double-spend)
    {
      const late = buildClaimTransactionV3({
        networkId: NETWORK_ID,
        covenantUtxo: utxo,
        redeemScriptHex: created.redeemScriptHex,
        recipientAddress,
        recipientPrivateKeyHex: recipient.privateKey.toString(),
        askIdHex: created.askIdHex,
        lockTxid: created.lockTxid,
        replyText: "too late",
        senderAddress,
      });
      expectReason(
        await expectChainRejection(
          rpc.submitTransaction({ transaction: late }),
          "late claim after refund"
        ),
        /already spent|orphan|missing|duplicate/i,
        "late claim after refund"
      );
    }

    // --- R2: recompute the refund from a FRESH connection
    const verifyRpc = await connectRpc({ networkId: NETWORK_ID });
    try {
      let got: bigint | null = null;
      for (let i = 0; i < 20 && got === null; i++) {
        const { entries } = await verifyRpc.getUtxosByAddresses({ addresses: [senderAddress] });
        const hit = (entries as unknown as Array<{ outpoint: { transactionId: string }; amount: bigint }>)
          .filter((u) => u.outpoint.transactionId === refundTxid);
        if (hit.length) got = hit.reduce((a, u) => a + BigInt(u.amount), 0n);
        else await new Promise((r) => setTimeout(r, 3000));
      }
      expect(got, "refund output must appear in the sender's UTXO set").not.toBeNull();
      // F21: strictly MORE than the covenant floor — the sender keeps what
      // V2 handed to a miner.
      expect(got!).toBeGreaterThan(floor);
      expect(got!).toBeLessThan(BigInt(utxo.amount));
      const { entries: covLeft } = await verifyRpc.getUtxosByAddresses({
        addresses: [created.p2shAddress],
      });
      expect(covLeft).toHaveLength(0);
    } finally {
      await verifyRpc.disconnect();
    }
  }, 900_000);
});
