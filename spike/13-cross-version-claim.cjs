// Spike 13: the V2+V3 CROSS-VERSION claim (second audit, finding 1) and
// the fix for it.
//
// THE DEFECT: V2's claim branch checks only payload[0:15] ==
// "ciph_msg:1:ask:", and the V3 reply header "ciph_msg:1:ask:r2:" BEGINS
// with those same 15 bytes. So one V3-shaped payload satisfied a V2
// covenant as well as a V3 one. A recipient holding one V2 Ask and one V3
// Ask could spend BOTH in a single transaction with a single reply — the
// V2 sender losing their Ask to a reply encrypted to somebody else. V2 is
// deployed and immutable, so the fix lives in V3: OpTxInputCount == 1 on
// the claim branch.
//
// THREE results, 07c discipline — the attack alone proves nothing:
//   (a) ATTACK   mixed V2+V3 inputs, one V3 payload      -> must REJECT
//   (b) CONTROL  the V2 Ask claimed alone                -> must ACCEPT
//   (c) CONTROL  the V3 Ask claimed alone                -> must ACCEPT
// Without (b) and (c), a rejection is indistinguishable from "nothing
// claims any more".
//
// Usage: node spike/13-cross-version-claim.cjs        (TESTNET ONLY)
const {
  kaspa,
  NETWORK_ID,
  FEE_ALLOWANCE,
  connect,
  isChainRejection,
  loadKeys,
  buildAskRedeemScriptV2,
  buildAskRedeemScriptV3,
  assertV3VectorMatch,
  buildSpendSignatureScript,
  spkToStackBytes,
  xOnlyHex,
  loadAsks,
  saveAsks,
  findP2shUtxos,
  ASK_V3_REPLY_HEADER,
} = require("./lib.cjs");

const {
  addressFromScriptPublicKey,
  payToAddressScript,
  createTransactions,
  createTransaction,
  createInputSignature,
  calculateTransactionFee,
  kaspaToSompi,
  sompiToKaspaString,
  PrivateKey,
} = kaspa;

const AMOUNT = kaspaToSompi("1");
const ALLOWANCE = 400000n;
const DEADLINE_OFFSET = 200000n; // far out — claims must not race a refund
const ASK_ID = "d1".repeat(32);

/** One payload, V3-shaped: header ‖ askId ‖ JSON. This is the payload that
 * used to satisfy BOTH covenants. */
function v3Payload() {
  return Buffer.concat([
    Buffer.from(ASK_V3_REPLY_HEADER, "utf8"),
    Buffer.from(ASK_ID, "hex"),
    Buffer.from('{"v":2,"ref":"' + "00".repeat(32) + '","msgEnc":"kasia1","message":"' + "ab".repeat(80) + '"}', "utf8"),
  ]).toString("hex");
}

(async () => {
  const { sender, recipient } = loadKeys();
  const senderAddress = sender.toAddress(NETWORK_ID).toString();
  const recipientAddress = recipient.toAddress(NETWORK_ID).toString();
  const recipientXOnlyHex = xOnlyHex(recipient);

  console.log("=== Spike 13: V2+V3 cross-version claim ===");
  console.log(`V3 header "${ASK_V3_REPLY_HEADER}" starts with V2's prefix: ` +
    `${ASK_V3_REPLY_HEADER.startsWith("ciph_msg:1:ask:")}\n`);
  assertV3VectorMatch();

  const rpc = await connect();
  const out = { network: NETWORK_ID, results: {}, verdict: null };
  try {
    const deadline = BigInt((await rpc.getBlockDagInfo()).virtualDaaScore) + DEADLINE_OFFSET;
    const senderSpkBytes = spkToStackBytes(payToAddressScript(senderAddress));

    // --- a V2 covenant and a V3 covenant, same recipient ---------------
    const v2Redeem = buildAskRedeemScriptV2({
      recipientXOnlyHex,
      senderSpkBytes,
      deadline,
      minRefund: AMOUNT - FEE_ALLOWANCE,
    });
    const v2 = {
      label: "V2",
      redeemHex: v2Redeem.toString(),
      p2shAddress: addressFromScriptPublicKey(v2Redeem.createPayToScriptHashScript(), NETWORK_ID).toString(),
    };
    const v3Redeem = buildAskRedeemScriptV3({
      recipientXOnlyHex,
      senderAddress,
      deadlineDaa: deadline,
      askIdHex: ASK_ID,
      refundAllowance: ALLOWANCE,
    });
    const v3 = {
      label: "V3",
      redeemHex: v3Redeem.toString(),
      p2shAddress: addressFromScriptPublicKey(v3Redeem.createPayToScriptHashScript(), NETWORK_ID).toString(),
    };
    console.log(`  V2 covenant: ${v2.p2shAddress}`);
    console.log(`  V3 covenant: ${v3.p2shAddress}`);

    // Fund BOTH in ONE transaction (sequential funding races on selection).
    const { entries } = await rpc.getUtxosByAddresses({ addresses: [senderAddress] });
    const { transactions } = await createTransactions({
      entries,
      outputs: [
        { address: v2.p2shAddress, amount: AMOUNT },
        { address: v3.p2shAddress, amount: AMOUNT },
      ],
      changeAddress: senderAddress,
      priorityFee: 0n,
      networkId: NETWORK_ID,
    });
    let lockTxid;
    for (const p of transactions) {
      await p.sign([sender.privateKey]);
      lockTxid = await p.submit(rpc);
    }
    console.log(`\n  funded both, lock txid: ${lockTxid}`);
    out.lockTxid = lockTxid;

    for (const c of [v2, v3]) {
      for (let i = 0; i < 24 && !c.utxo; i++) {
        const u = await findP2shUtxos(rpc, c.p2shAddress);
        if (u.length) c.utxo = u[0];
        else await new Promise((r) => setTimeout(r, 5000));
      }
      if (!c.utxo) throw new Error(`${c.label} UTXO never appeared`);
    }

    const payloadHex = v3Payload();

    /** Build a claim over `parts` (each {utxo, redeemHex}) with ONE payload. */
    function buildClaim(parts) {
      const total = parts.reduce((a, p) => a + BigInt(p.utxo.amount), 0n);
      let fee = 200000n;
      for (let i = 0; i < 10; i++) {
        const tx = createTransaction(
          parts.map((p) => p.utxo),
          [{ address: recipientAddress, amount: total - fee }],
          0n,
          payloadHex,
          1
        );
        parts.forEach((p, idx) => {
          const sig = createInputSignature(tx, idx, new PrivateKey(recipient.privateKey));
          tx.inputs[idx].signatureScript = buildSpendSignatureScript(p.redeemHex, sig, true);
        });
        const req = calculateTransactionFee(NETWORK_ID, tx);
        if (req === undefined) throw new Error("no valid fee");
        if (req <= fee) return tx;
        fee = req;
      }
      throw new Error("claim fee did not converge");
    }

    async function submit(tx, label) {
      try {
        const { transactionId } = await rpc.submitTransaction({ transaction: tx });
        console.log(`  ${label.padEnd(42)} ACCEPTED ${transactionId}`);
        return { outcome: "ACCEPTED", txid: transactionId };
      } catch (e) {
        const chain = isChainRejection(e);
        const reason = String(e.message || e);
        console.log(`  ${label.padEnd(42)} ${chain ? "rejected" : "INCONCLUSIVE"} — ${reason.slice(0, 130)}`);
        return { outcome: chain ? "rejected" : "INCONCLUSIVE", reason };
      }
    }

    // --- (a) THE ATTACK: mixed V2 + V3 inputs, one V3 payload ----------
    console.log("\n--- (a) ATTACK: mixed V2+V3 inputs, ONE V3 payload ---");
    out.results.mixed = await submit(
      buildClaim([v3, v2]),
      "V3+V2 with one V3 payload (must reject)"
    );

    // --- (b)(c) CONTROLS: each claimed alone --------------------------
    console.log("\n--- (b) CONTROL: the V2 Ask claimed alone ---");
    out.results.v2Alone = await submit(buildClaim([v2]), "V2 alone (must ACCEPT)");

    console.log("\n--- (c) CONTROL: the V3 Ask claimed alone ---");
    out.results.v3Alone = await submit(buildClaim([v3]), "V3 alone (must ACCEPT)");

    // --- R2: recompute from a FRESH connection ------------------------
    console.log("\nR2: recomputing from the node's UTXO set (fresh connection)...");
    const rpc2 = await connect();
    try {
      for (const key of ["v2Alone", "v3Alone"]) {
        const r = out.results[key];
        if (r.outcome !== "ACCEPTED") continue;
        let seen = null;
        for (let i = 0; i < 20 && !seen; i++) {
          const { entries: e } = await rpc2.getUtxosByAddresses({ addresses: [recipientAddress] });
          const hit = e.filter((u) => String(u.outpoint.transactionId).toLowerCase() === r.txid.toLowerCase());
          if (hit.length) seen = hit;
          else await new Promise((x) => setTimeout(x, 5000));
        }
        r.r2 = seen
          ? { outputs: seen.length, paidSompi: seen.reduce((a, u) => a + BigInt(u.amount), 0n).toString() }
          : "not observed in time";
        console.log(`  ${key}: ${JSON.stringify(r.r2)}`);
      }
      out.covenantsDrained = {
        v2: (await findP2shUtxos(rpc2, v2.p2shAddress)).length,
        v3: (await findP2shUtxos(rpc2, v3.p2shAddress)).length,
      };
      console.log(`  covenant UTXOs remaining: ${JSON.stringify(out.covenantsDrained)}`);
    } finally {
      await rpc2.disconnect();
    }

    const attackRejected = out.results.mixed.outcome === "rejected";
    const controlsOk =
      out.results.v2Alone.outcome === "ACCEPTED" && out.results.v3Alone.outcome === "ACCEPTED";

    if (attackRejected && controlsOk) {
      out.verdict =
        "CROSS-VERSION CLAIM CLOSED — a mixed V2+V3 input set carrying one V3 payload is rejected, while each Ask still claims correctly on its own. The rejection is attributable to the V3 claim branch's OpTxInputCount == 1, since the identical payload and signatures succeed single-input.";
    } else if (!controlsOk) {
      out.verdict =
        "INCONCLUSIVE — a control failed, so the attack rejection proves nothing (it may mean nothing claims at all).";
    } else {
      out.verdict = `NOT CLOSED — the mixed claim was ${out.results.mixed.outcome}.`;
    }
    console.log("\n=== VERDICT ===\n" + out.verdict);

    const a = loadAsks();
    a.crossVersionClaim = out;
    saveAsks(a);
    console.log("\nrecorded to spike/.asks.json under 'crossVersionClaim'");
    if (!(attackRejected && controlsOk)) process.exit(1);
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("PROBE FAILED (inconclusive, not a verdict):", e);
  process.exit(1);
});
