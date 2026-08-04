// Spike 11c: THE GATE for src/lib/ask/covenant-v3.ts (Q3b).
//
// covenant-v3.ts guards its CRITICAL claim branch with OpTxPayloadLen
// (196). Spike 11b proved OpTxPayloadSubstr fails closed at [0:32] — but
// V3 reads the askId at [18:50], and only the opcode's EXISTENCE in the
// SDK enum is established. Existence is not behaviour; that was the Q1
// lesson, and a guard on a Critical branch cannot itself rest on an
// unverified opcode.
//
// This spike answers:
//   CONTROL. Does the harness work? (plain key + OpCheckSig)
//   G1. Does OpTxPayloadLen BEHAVE — push the payload length as a script
//       number usable by OpGreaterThanOrEqual? Tested in ISOLATION at
//       N-1 (reject), N (accept), N+1 (accept).
//   G2. Does the REAL V3 claim-branch shape behave at the REAL offsets?
//       Payload lengths 17 and 49 must REJECT; 50 with the correct askId
//       must ACCEPT; 50 with a WRONG askId must REJECT (that last one is
//       the F22 property itself).
//
// A failure here means covenant-v3.ts must not ship. An ACCEPT where a
// REJECT is required is a security hole; a REJECT where an ACCEPT is
// required strands funds — both are gate failures.
//
// Usage: node spike/11c-payload-len-gate.cjs        (TESTNET ONLY)
const {
  kaspa,
  NETWORK_ID,
  connect,
  isChainRejection,
  loadKeys,
  xOnlyHex,
  loadAsks,
  saveAsks,
  findP2shUtxos,
  solveSpendFee,
} = require("./lib.cjs");

const PROBE_AMOUNT = "0.5";

// Must mirror src/lib/ask/covenant-v3.ts exactly.
const V3_HEADER = "ciph_msg:1:ask:r2:";
const HEADER_LEN = Buffer.from(V3_HEADER, "utf8").length; // 18
const ASK_ID_END = HEADER_LEN + 32; // 50
const ASK_ID_HEX = "11".repeat(32);
const WRONG_ASK_ID_HEX = "22".repeat(32);

const {
  addressFromScriptPublicKey,
  createTransactions,
  createTransaction,
  kaspaToSompi,
  createInputSignature,
  PrivateKey,
  ScriptBuilder,
  Opcodes,
} = kaspa;

function stripPush(sigHex) {
  const b = Buffer.from(sigHex, "hex");
  return b.length >= 2 && b[0] === b.length - 1 && b[0] <= 75 ? b.subarray(1) : b;
}

function buildSpend({ utxo, dest, outAmount, payloadHex, redeemHex, privKey }) {
  const tx = createTransaction(
    [utxo],
    [{ address: dest, amount: outAmount }],
    0n,
    payloadHex,
    1
  );
  const sig = createInputSignature(tx, 0, new PrivateKey(privKey));
  tx.inputs[0].signatureScript = new ScriptBuilder()
    .addData(stripPush(sig))
    .addData(Buffer.from(redeemHex, "hex"))
    .drain();
  return tx;
}

function buildWithSolvedFee(opts) {
  const inputAmount = BigInt(opts.utxo.amount);
  const { fee } = solveSpendFee({
    networkId: NETWORK_ID,
    inputAmount,
    buildTx: (f) => buildSpend({ ...opts, outAmount: inputAmount - f }),
  });
  return buildSpend({ ...opts, outAmount: inputAmount - fee });
}

/** Payload of exactly `len` bytes: V3 header, then askId, then filler. */
function payloadOfLength(len, askIdHex) {
  const head = Buffer.concat([
    Buffer.from(V3_HEADER, "utf8"),
    Buffer.from(askIdHex, "hex"),
  ]);
  if (len <= head.length) return head.subarray(0, len).toString("hex");
  return Buffer.concat([head, Buffer.alloc(len - head.length, 0x7b)]).toString("hex");
}

(async () => {
  const { sender } = loadKeys();
  const senderAddress = sender.toAddress(NETWORK_ID).toString();
  const senderXOnly = xOnlyHex(sender);
  const privKey = sender.privateKey.toString();
  const keyBytes = Buffer.from(senderXOnly, "hex");
  const results = { network: NETWORK_ID, control: null, g1: [], g2: [], verdict: null };
  const rpc = await connect();

  try {
    // CONTROL: plain key + OpCheckSig.
    const controlScript = new ScriptBuilder().addData(keyBytes).addOp(Opcodes.OpCheckSig);

    // G1: OpTxPayloadLen in ISOLATION.
    const lenScript = new ScriptBuilder()
      .addOp(Opcodes.OpTxPayloadLen)
      .addI64(BigInt(ASK_ID_END))
      .addOp(Opcodes.OpGreaterThanOrEqual)
      .addOp(Opcodes.OpVerify)
      .addData(keyBytes)
      .addOp(Opcodes.OpCheckSig);

    // G2: the REAL V3 claim-branch shape (no OpIf wrapper — the branch body).
    const claimScript = new ScriptBuilder()
      .addOp(Opcodes.OpTxPayloadLen)
      .addI64(BigInt(ASK_ID_END))
      .addOp(Opcodes.OpGreaterThanOrEqual)
      .addOp(Opcodes.OpVerify)
      .addI64(0n)
      .addI64(BigInt(HEADER_LEN))
      .addOp(Opcodes.OpTxPayloadSubstr)
      .addData(Buffer.from(V3_HEADER, "utf8"))
      .addOp(Opcodes.OpEqualVerify)
      .addI64(BigInt(HEADER_LEN))
      .addI64(BigInt(ASK_ID_END))
      .addOp(Opcodes.OpTxPayloadSubstr)
      .addData(Buffer.from(ASK_ID_HEX, "hex"))
      .addOp(Opcodes.OpEqualVerify)
      .addData(keyBytes)
      .addOp(Opcodes.OpCheckSig);

    const probes = [
      { key: "control", script: controlScript },
      { key: "lenGuard", script: lenScript },
      { key: "claimShape", script: claimScript },
    ].map((p) => ({
      ...p,
      redeemHex: p.script.toString(),
      p2shAddress: addressFromScriptPublicKey(
        p.script.createPayToScriptHashScript(),
        NETWORK_ID
      ).toString(),
    }));

    console.log("=== Spike 11c: OpTxPayloadLen gate for covenant-v3.ts ===");
    console.log("network:", NETWORK_ID);
    console.log(`header "${V3_HEADER}" = ${HEADER_LEN} bytes; askId ends at ${ASK_ID_END}`);
    for (const p of probes) console.log(`  ${p.key.padEnd(11)} ${p.p2shAddress}`);

    const amount = kaspaToSompi(PROBE_AMOUNT);
    const { entries } = await rpc.getUtxosByAddresses({ addresses: [senderAddress] });
    const { transactions } = await createTransactions({
      entries,
      outputs: probes.map((p) => ({ address: p.p2shAddress, amount })),
      changeAddress: senderAddress,
      priorityFee: 0n,
      networkId: NETWORK_ID,
    });
    let fundTxid;
    for (const pending of transactions) {
      await pending.sign([sender.privateKey]);
      fundTxid = await pending.submit(rpc);
    }
    console.log("\nfunding txid:", fundTxid);
    results.fundTxid = fundTxid;

    for (const p of probes) {
      for (let i = 0; i < 24 && !p.utxo; i++) {
        const u = await findP2shUtxos(rpc, p.p2shAddress);
        if (u.length) p.utxo = u[0];
        else await new Promise((r) => setTimeout(r, 5000));
      }
      if (!p.utxo) throw new Error(`probe UTXO for ${p.key} never appeared`);
    }
    const byKey = Object.fromEntries(probes.map((p) => [p.key, p]));

    async function attempt(probe, payloadHex, label) {
      const tx = buildWithSolvedFee({
        utxo: probe.utxo,
        dest: senderAddress,
        payloadHex,
        redeemHex: probe.redeemHex,
        privKey,
      });
      try {
        const { transactionId } = await rpc.submitTransaction({ transaction: tx });
        console.log(`  ${label.padEnd(34)} ACCEPTED ${transactionId}`);
        return { label, outcome: "ACCEPTED", txid: transactionId };
      } catch (e) {
        const chain = isChainRejection(e);
        console.log(
          `  ${label.padEnd(34)} ${chain ? "rejected" : "INCONCLUSIVE"}: ${String(e.message || e).slice(0, 120)}`
        );
        return { label, outcome: chain ? "rejected" : "INCONCLUSIVE", reason: String(e.message || e) };
      }
    }

    // ---- CONTROL (gate on interpretability) ----------------------------
    console.log("\n--- CONTROL ---");
    const c = await attempt(byKey.control, "", "plain key + OpCheckSig");
    results.control = c.outcome;
    if (c.outcome !== "ACCEPTED") {
      console.log("\n*** ABORTING: control failed; no result here is interpretable. ***");
      const asks = loadAsks();
      asks.payloadLenGate = results;
      saveAsks(asks);
      process.exit(1);
    }

    // ---- G1: OpTxPayloadLen in isolation -------------------------------
    // Rejections first (UTXO survives), acceptance last (consumes it).
    console.log(`\n--- G1: OpTxPayloadLen >= ${ASK_ID_END}, isolated ---`);
    results.g1.push(await attempt(byKey.lenGuard, payloadOfLength(ASK_ID_END - 1, ASK_ID_HEX), `len ${ASK_ID_END - 1} (must reject)`));
    results.g1.push(await attempt(byKey.lenGuard, payloadOfLength(ASK_ID_END + 1, ASK_ID_HEX), `len ${ASK_ID_END + 1} (must accept)`));

    // ---- G2: real V3 claim shape at real offsets ------------------------
    console.log("\n--- G2: V3 claim-branch shape at real offsets ---");
    results.g2.push(await attempt(byKey.claimShape, payloadOfLength(HEADER_LEN - 1, ASK_ID_HEX), `len ${HEADER_LEN - 1} (must reject)`));
    results.g2.push(await attempt(byKey.claimShape, payloadOfLength(ASK_ID_END - 1, ASK_ID_HEX), `len ${ASK_ID_END - 1} (must reject)`));
    results.g2.push(await attempt(byKey.claimShape, payloadOfLength(ASK_ID_END, WRONG_ASK_ID_HEX), `len ${ASK_ID_END} WRONG askId (must reject)`));
    results.g2.push(await attempt(byKey.claimShape, payloadOfLength(ASK_ID_END, ASK_ID_HEX), `len ${ASK_ID_END} correct askId (must ACCEPT)`));

    // ---- Verdict --------------------------------------------------------
    const g1Reject = results.g1[0].outcome === "rejected";
    const g1Accept = results.g1[1].outcome === "ACCEPTED";
    const g2Short1 = results.g2[0].outcome === "rejected";
    const g2Short2 = results.g2[1].outcome === "rejected";
    const g2Wrong = results.g2[2].outcome === "rejected";
    const g2Good = results.g2[3].outcome === "ACCEPTED";
    const pass = g1Reject && g1Accept && g2Short1 && g2Short2 && g2Wrong && g2Good;

    results.verdict = pass
      ? "GATE PASS — OpTxPayloadLen behaves as a script number under OpGreaterThanOrEqual; the V3 claim shape rejects short payloads and a wrong askId, and accepts a correct 50-byte payload. covenant-v3.ts may proceed to the re-proof campaign."
      : `GATE FAIL — g1(reject@${ASK_ID_END - 1})=${g1Reject} g1(accept@${ASK_ID_END + 1})=${g1Accept} ` +
        `g2(reject@${HEADER_LEN - 1})=${g2Short1} g2(reject@${ASK_ID_END - 1})=${g2Short2} ` +
        `g2(reject wrong askId)=${g2Wrong} g2(accept correct)=${g2Good}. covenant-v3.ts MUST NOT ship.`;

    console.log("\n=== VERDICT ===");
    console.log(results.verdict);

    const asks = loadAsks();
    asks.payloadLenGate = results;
    saveAsks(asks);
    console.log("\nrecorded to spike/.asks.json under 'payloadLenGate'");
    if (!pass) process.exit(1);
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("SPIKE FAILED (inconclusive, not a verdict):", e);
  process.exit(1);
});
