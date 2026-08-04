// Spike 12: does the V3 refund floor survive LARGE amounts? (audit-2 #6)
//
// The refund branch is the only place a sompi amount becomes an ARITHMETIC
// OPERAND:  0 OpTxOutputAmount  OpTxInputIndex OpTxInputAmount
//           <allowance> OpSub  OpGreaterThanOrEqual
// Every on-chain proof so far used 0.5-3 KAS — all inside a 4-byte script
// number. 2^31-1 sompi = 21.47483647 KAS is the first magnitude needing a
// 5-byte operand. If the VM caps arithmetic operands at 4 bytes, EVERY Ask
// at or above ~21.475 KAS would be claimable by the recipient but NEVER
// refundable to the sender — Critical stranding-by-amount, and the floor
// arithmetic would need redesigning.
//
// DISCIPLINE (07c): the attack result alone is meaningless. A CONTROL Ask
// below the threshold is refunded in the SAME run, so the only variable
// between the two outcomes is the amount. If the control fails, the run is
// INCONCLUSIVE and no verdict is written.
//
// Usage: node spike/12-large-amount-floor.cjs        (TESTNET ONLY, ~26 TKAS)
const {
  kaspa,
  NETWORK_ID,
  connect,
  isChainRejection,
  loadKeys,
  buildAskRedeemScriptV3,
  assertV3VectorMatch,
  xOnlyHex,
  loadAsks,
  saveAsks,
  findP2shUtxos,
  solveSpendFee,
} = require("./lib.cjs");

const {
  addressFromScriptPublicKey,
  createTransactions,
  createTransaction,
  kaspaToSompi,
  sompiToKaspaString,
  ScriptBuilder,
} = kaspa;

const THRESHOLD = 2147483647n;            // 2^31-1 sompi = 21.47483647 KAS
const BIG = kaspaToSompi("25");           // above  -> 5-byte operands
const CONTROL = kaspaToSompi("1");        // below  -> 4-byte operands
const ALLOWANCE = 400000n;                // what the shipped solver produces
const DEADLINE_OFFSET = 600n;             // ~60s

(async () => {
  const { sender, recipient } = loadKeys();
  const senderAddress = sender.toAddress(NETWORK_ID).toString();
  const recipientXOnlyHex = xOnlyHex(recipient);

  console.log("=== Spike 12: V3 refund floor at large amounts ===");
  console.log(`threshold 2^31-1 = ${THRESHOLD} sompi (${sompiToKaspaString(THRESHOLD)} KAS)\n`);
  assertV3VectorMatch();

  const rpc = await connect();
  const out = { network: NETWORK_ID, thresholdSompi: THRESHOLD.toString(), results: {}, verdict: null };
  try {
    const dag = await rpc.getBlockDagInfo();
    const deadline = BigInt(dag.virtualDaaScore) + DEADLINE_OFFSET;

    const mk = (label, amount, askIdHex) => {
      const redeem = buildAskRedeemScriptV3({
        recipientXOnlyHex,
        senderAddress,
        deadlineDaa: deadline,
        askIdHex,
        refundAllowance: ALLOWANCE,
      });
      return {
        label,
        amount,
        redeemHex: redeem.toString(),
        p2shAddress: addressFromScriptPublicKey(
          redeem.createPayToScriptHashScript(),
          NETWORK_ID
        ).toString(),
        floor: amount - ALLOWANCE,
      };
    };
    const control = mk("CONTROL 1 KAS (under 2^31)", CONTROL, "c0".repeat(32));
    const big = mk("BIG 25 KAS (over 2^31)", BIG, "b1".repeat(32));

    for (const c of [control, big]) {
      console.log(
        `  ${c.label}: floor ${c.floor} sompi (${(c.floor > THRESHOLD ? "5" : "4")}-byte operand) -> ${c.p2shAddress}`
      );
    }

    // Fund BOTH in ONE transaction (sequential funds race on UTXO selection).
    console.log("\nfunding both covenants in one transaction...");
    const { entries } = await rpc.getUtxosByAddresses({ addresses: [senderAddress] });
    const { transactions } = await createTransactions({
      entries,
      outputs: [
        { address: control.p2shAddress, amount: control.amount },
        { address: big.p2shAddress, amount: big.amount },
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
    console.log("  lock txid:", lockTxid);
    out.lockTxid = lockTxid;

    for (const c of [control, big]) {
      for (let i = 0; i < 24 && !c.utxo; i++) {
        const u = await findP2shUtxos(rpc, c.p2shAddress);
        if (u.length) c.utxo = u[0];
        else await new Promise((r) => setTimeout(r, 5000));
      }
      if (!c.utxo) throw new Error(`${c.label}: UTXO never appeared`);
    }

    console.log("\nwaiting out the deadline...");
    for (;;) {
      const d = BigInt((await rpc.getBlockDagInfo()).virtualDaaScore);
      if (d >= deadline + 20n) break;
      await new Promise((r) => setTimeout(r, 15000));
    }

    async function refund(c) {
      const input = BigInt(c.utxo.amount);
      const sig = new ScriptBuilder()
        .addData(Buffer.from([]))
        .addData(Buffer.from(c.redeemHex, "hex"))
        .drain();
      const build = (fee) => {
        const tx = createTransaction(
          [c.utxo],
          [{ address: senderAddress, amount: input - fee }],
          0n,
          undefined,
          0
        );
        tx.lockTime = deadline;
        tx.inputs[0].sequence = 0n;
        tx.inputs[0].signatureScript = sig;
        return tx;
      };
      const { fee } = solveSpendFee({ networkId: NETWORK_ID, inputAmount: input, buildTx: build });
      const paying = input - fee;
      if (paying < c.floor) throw new Error(`${c.label}: built below floor — probe bug`);
      try {
        const { transactionId } = await rpc.submitTransaction({ transaction: build(fee) });
        console.log(`  ${c.label}: ACCEPTED ${transactionId} (paid ${sompiToKaspaString(paying)} KAS)`);
        return { outcome: "ACCEPTED", txid: transactionId, paidSompi: paying.toString() };
      } catch (e) {
        const chain = isChainRejection(e);
        const reason = String(e.message || e);
        console.log(`  ${c.label}: ${chain ? "REJECTED" : "INCONCLUSIVE"} — ${reason.slice(0, 160)}`);
        return { outcome: chain ? "REJECTED" : "INCONCLUSIVE", reason };
      }
    }

    // CONTROL FIRST — nothing after it is interpretable if it fails.
    console.log("\n--- CONTROL (must ACCEPT) ---");
    out.results.control = await refund(control);
    if (out.results.control.outcome !== "ACCEPTED") {
      out.verdict =
        "INCONCLUSIVE — the sub-threshold CONTROL refund did not succeed, so nothing about large amounts can be concluded from this run.";
      console.log("\n*** " + out.verdict);
      const a = loadAsks();
      a.largeAmountFloor = out;
      saveAsks(a);
      process.exit(1);
    }

    console.log("\n--- BIG, above 2^31 (the question) ---");
    out.results.big = await refund(big);

    // --- R2: recompute both from a FRESH connection ---
    console.log("\nR2: recomputing from the node's UTXO set (fresh connection)...");
    const rpc2 = await connect();
    try {
      for (const [key, c] of [["control", control], ["big", big]]) {
        const r = out.results[key];
        if (r.outcome !== "ACCEPTED") continue;
        let seen = null;
        for (let i = 0; i < 20 && !seen; i++) {
          const { entries: e } = await rpc2.getUtxosByAddresses({ addresses: [senderAddress] });
          const hit = e.filter(
            (u) => String(u.outpoint.transactionId).toLowerCase() === r.txid.toLowerCase()
          );
          if (hit.length) seen = hit;
          else await new Promise((x) => setTimeout(x, 5000));
        }
        const left = await findP2shUtxos(rpc2, c.p2shAddress);
        r.r2 = seen
          ? {
              outputs: seen.length,
              paidFromChainSompi: seen.reduce((a, u) => a + BigInt(u.amount), 0n).toString(),
              covenantUtxosRemaining: left.length,
            }
          : "not observed in time";
        console.log(`  ${key}: ${JSON.stringify(r.r2)}`);
      }
    } finally {
      await rpc2.disconnect();
    }

    // --- verdict ---
    const b = out.results.big;
    if (b.outcome === "ACCEPTED") {
      out.verdict =
        "REFUTED — a 25 KAS Ask (floor above 2^31 sompi, 5-byte operand) refunded successfully. The V3 floor arithmetic handles large amounts; no stranding-by-amount.";
    } else if (b.outcome === "REJECTED" && /number too big|numeric|exceeds the max allowed|operand/i.test(b.reason)) {
      out.verdict =
        "CONFIRMED CRITICAL — the large refund was rejected by an ARITHMETIC OPERAND limit while the sub-threshold control succeeded. Every Ask at or above ~21.475 KAS is claimable but NEVER refundable. The floor arithmetic must be redesigned before V3 ships.";
    } else {
      out.verdict = `INCONCLUSIVE — the large refund failed, but not for a recognisable operand-width reason: ${b.reason}`;
    }
    console.log("\n=== VERDICT ===\n" + out.verdict);

    const a = loadAsks();
    a.largeAmountFloor = out;
    saveAsks(a);
    console.log("\nrecorded to spike/.asks.json under 'largeAmountFloor'");
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("PROBE FAILED (inconclusive, not a verdict):", e);
  process.exit(1);
});
