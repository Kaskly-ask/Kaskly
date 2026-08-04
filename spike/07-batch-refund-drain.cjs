// Spike 07: EVIDENCE SCRIPT for finding F12 (adversarial review 2026-08-04).
//
// QUESTION: the V2 covenant's refund branch pins the OUTPUT side (exactly one
// output, to the sender's SPK, >= minRefund) but says NOTHING about the INPUT
// side. Can two DIFFERENT covenant UTXOs belonging to the same sender be spent
// in ONE signature-less transaction with ONE output, so that the surplus above
// the largest minRefund is captured as miner fee instead of returned?
//
// This script does not fix anything. It answers exploitable / not exploitable
// with a chain verdict, per the human's triage instruction ("likely" is not a
// decision basis for a covenant value-loss path).
//
// PASS (finding refuted): the chain REJECTS the batched refund.
// FAIL (finding confirmed): the chain ACCEPTS it AND an independent
// recomputation from the node's UTXO set measures a positive shortfall.
//
// Usage: node spike/07-batch-refund-drain.cjs      (TESTNET ONLY, spends TKAS)
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
  spkToStackBytes,
  xOnlyHex,
  loadAsks,
  saveAsks,
  findP2shUtxos,
} = require("./lib.cjs");

const DEADLINE_OFFSET = 600n; // ~60s at 10 DAA/s

// Which covenant is under attack. V2 is the baseline that CONFIRMED the
// drain (txid ab5575a6…); V3 must REFUTE it via OpTxInputCount == 1.
// The attack code below is IDENTICAL for both — only the covenant changes.
const COVENANT_VERSION = process.env.ASK_COVENANT_VERSION === "v3" ? "v3" : "v2";

(async () => {
  const {
    addressFromScriptPublicKey,
    payToAddressScript,
    createTransactions,
    createTransaction,
    kaspaToSompi,
    sompiToKaspaString,
    ScriptBuilder,
  } = kaspa;
  const { sender, recipient } = loadKeys();
  const senderAddress = sender.toAddress(NETWORK_ID).toString();
  const rpc = await connect();
  try {
    const dag = await rpc.getBlockDagInfo();
    const deadline = BigInt(dag.virtualDaaScore) + DEADLINE_OFFSET;
    const senderSpkBytes = spkToStackBytes(payToAddressScript(senderAddress));
    const recipientXOnlyHex = xOnlyHex(recipient);

    // Two DISTINCT covenants: different amounts => different minRefund =>
    // different redeem script => different P2SH address. Same sender, same
    // deadline (the finding is about the unconstrained INPUT COUNT, not about
    // mixing deadlines).
    const specs = [
      { label: "A", amount: kaspaToSompi("1") },
      { label: "B", amount: kaspaToSompi("3") },
    ].map((s, i) => {
      const minRefund = s.amount - FEE_ALLOWANCE;
      // Per-Ask askId (V3 only) — its uniqueness is the F22 argument.
      const askIdHex = (i === 0 ? "aa" : "bb").repeat(32);
      const redeem =
        COVENANT_VERSION === "v3"
          ? buildAskRedeemScriptV3({
              recipientXOnlyHex,
              senderAddress,
              deadlineDaa: deadline,
              askIdHex,
              refundAllowance: FEE_ALLOWANCE,
            })
          : buildAskRedeemScriptV2({
              recipientXOnlyHex,
              senderSpkBytes,
              deadline,
              minRefund,
            });
      const redeemHex = redeem.toString();
      return {
        ...s,
        minRefund,
        redeemHex,
        p2shAddress: addressFromScriptPublicKey(
          redeem.createPayToScriptHashScript(),
          NETWORK_ID
        ).toString(),
      };
    });

    console.log("=== F12 batched-refund drain probe ===");
    console.log("covenant under attack:", COVENANT_VERSION.toUpperCase());
    if (COVENANT_VERSION === "v3") {
      // HARD GATE: prove the spike builder is byte-identical to the shipped
      // covenant-v3.ts before attacking anything. Throws on divergence.
      assertV3VectorMatch();
    }
    console.log("network:", NETWORK_ID, "deadline DAA:", deadline.toString());
    for (const s of specs) {
      console.log(
        `  covenant ${s.label}: ${sompiToKaspaString(s.amount)} KAS -> ${s.p2shAddress}` +
          `  (minRefund ${sompiToKaspaString(s.minRefund)})`
      );
    }
    if (specs[0].p2shAddress === specs[1].p2shAddress) {
      throw new Error("covenants collapsed to one address — probe invalid");
    }

    // --- LOCK BOTH (single funding tx, two outputs) ---
    const { entries } = await rpc.getUtxosByAddresses({ addresses: [senderAddress] });
    const { transactions } = await createTransactions({
      entries,
      outputs: specs.map((s) => ({ address: s.p2shAddress, amount: s.amount })),
      changeAddress: senderAddress,
      priorityFee: 0n,
      networkId: NETWORK_ID,
    });
    let lockTxid;
    for (const pending of transactions) {
      await pending.sign([sender.privateKey]);
      lockTxid = await pending.submit(rpc);
    }
    console.log("lock txid (funds both covenants):", lockTxid);

    // --- WAIT OUT THE DEADLINE ---
    for (;;) {
      const d = await rpc.getBlockDagInfo();
      const daa = BigInt(d.virtualDaaScore);
      console.log("  DAA", daa.toString(), "/ deadline", deadline.toString());
      if (daa >= deadline + 20n) break;
      await new Promise((r) => setTimeout(r, 15000));
    }

    // --- COLLECT BOTH COVENANT UTXOS ---
    for (const s of specs) {
      const utxos = await findP2shUtxos(rpc, s.p2shAddress);
      if (!utxos.length) throw new Error(`covenant ${s.label} UTXO not found`);
      s.utxo = utxos[0];
    }

    // --- THE PROBE: one tx, BOTH inputs, ONE output = max(minRefund) ---
    const totalIn = specs.reduce((a, s) => a + BigInt(s.utxo.amount), 0n);
    const singleOut = specs.reduce(
      (m, s) => (s.minRefund > m ? s.minRefund : m),
      0n
    );
    const surplus = totalIn - singleOut;
    console.log("\nbatched refund shape (intent, pre-broadcast):");
    console.log("  inputs      :", specs.length, "covenant UTXOs, total", sompiToKaspaString(totalIn), "KAS");
    console.log("  single out  :", sompiToKaspaString(singleOut), "KAS to sender (= max minRefund)");
    console.log("  surplus     :", sompiToKaspaString(surplus), "KAS -> miner fee if accepted");

    const tx = createTransaction(
      specs.map((s) => s.utxo),
      [{ address: senderAddress, amount: singleOut }],
      0n,
      undefined,
      0
    );
    tx.lockTime = deadline;
    specs.forEach((s, i) => {
      tx.inputs[i].sequence = 0n;
      // Each input pushes the empty branch selector + ITS OWN redeem script.
      tx.inputs[i].signatureScript = new ScriptBuilder()
        .addData(Buffer.from([]))
        .addData(Buffer.from(s.redeemHex, "hex"))
        .drain();
    });

    const record = {
      covenantVersion: COVENANT_VERSION,
      network: NETWORK_ID,
      deadline: deadline.toString(),
      lockTxid,
      covenants: specs.map((s) => ({
        label: s.label,
        p2shAddress: s.p2shAddress,
        amount: s.amount.toString(),
        minRefund: s.minRefund.toString(),
      })),
      totalInSompi: totalIn.toString(),
      singleOutSompi: singleOut.toString(),
      surplusSompi: surplus.toString(),
    };

    try {
      const { transactionId } = await rpc.submitTransaction({ transaction: tx });
      console.log("\nchain ACCEPTED the batched refund, txid:", transactionId);
      record.drainTxid = transactionId;

      // --- R2 DUAL VERIFICATION ------------------------------------------
      // submitTransaction's return is the submitting node's own word. Re-derive
      // the outcome from the UTXO index over a FRESH connection, matching
      // tests/integration/lifecycle.test.ts:399-423. Every number reported
      // below comes from the node's response, not from our local variables.
      // (The mempool-entry RPC is deliberately NOT used here: it races block
      // acceptance and returns nothing once the tx lands in a block.)
      console.log("\nR2: recomputing from the node's UTXO set (fresh connection)...");
      const rpc2 = await connect();
      let observed = null;
      try {
        for (let i = 0; i < 20 && !observed; i++) {
          const remaining = [];
          for (const s of specs) {
            const u = await findP2shUtxos(rpc2, s.p2shAddress);
            if (u.length) remaining.push(`${s.label}:${u.length}`);
          }
          const { entries: senderEntries } = await rpc2.getUtxosByAddresses({
            addresses: [senderAddress],
          });
          const fromDrain = senderEntries.filter(
            (u) =>
              String(u.outpoint.transactionId).toLowerCase() ===
              String(transactionId).toLowerCase()
          );
          console.log(
            `  attempt ${i + 1}: covenant UTXOs left=[${remaining.join(",") || "none"}]` +
              `, sender outputs from drain txid=${fromDrain.length}`
          );
          if (!remaining.length && fromDrain.length) observed = fromDrain;
          else await new Promise((r) => setTimeout(r, 5000));
        }
      } finally {
        await rpc2.disconnect();
      }

      if (!observed) {
        record.verdict = "ACCEPTED_BUT_UNVERIFIED";
        console.log("\n*** ACCEPTED, NOT INDEPENDENTLY VERIFIED — no F12 verdict ***");
        console.log("    Re-run before treating F12 as confirmed.");
      } else {
        // Every figure below is derived from node-returned UTXO entries.
        const paidFromChain = observed.reduce((a, u) => a + BigInt(u.amount), 0n);
        const honestTotal = specs.reduce((a, s) => a + s.minRefund, 0n); // 2 separate honest refunds
        const lockedTotal = specs.reduce((a, s) => a + s.amount, 0n);
        const shortfall = honestTotal - paidFromChain;
        record.r2 = {
          outputsToSenderFromDrainTx: observed.length,
          paidToSenderSompi: paidFromChain.toString(),
          honestRefundTotalSompi: honestTotal.toString(),
          lockedTotalSompi: lockedTotal.toString(),
          shortfallSompi: shortfall.toString(),
          covenantUtxosRemaining: 0,
        };
        console.log("\n--- R2 recomputation (node UTXO set) ---");
        console.log("    covenant UTXOs remaining : 0 (both consumed)");
        console.log(`    outputs to sender        : ${observed.length}`);
        console.log(`    sender received          : ${sompiToKaspaString(paidFromChain)} KAS`);
        console.log(`    locked in total          : ${sompiToKaspaString(lockedTotal)} KAS`);
        console.log(`    two honest refunds pay   : ${sompiToKaspaString(honestTotal)} KAS`);
        console.log(`    SHORTFALL vs honest      : ${sompiToKaspaString(shortfall)} KAS`);
        if (shortfall > 0n && observed.length === 1) {
          record.verdict = "CONFIRMED";
          console.log("\n*** F12 CONFIRMED — drain verified from chain state ***");
        } else {
          record.verdict = "ACCEPTED_NO_DRAIN_MEASURED";
          console.log("\n*** ACCEPTED but NO SHORTFALL measured — F12 NOT proven ***");
          console.log("    Investigate before drawing any conclusion.");
        }
      }
    } catch (e) {
      // isChainRejection matches ONLY real node rejections ("Rejected
      // transaction" / "RPC Server (remote error)"). SDK-side pre-broadcast
      // validation errors carry neither marker and re-throw to the outer
      // handler as INCONCLUSIVE — they must never read as a refutation (R6).
      if (!isChainRejection(e)) throw e;
      console.log("\n*** F12 REFUTED — CHAIN REJECTED THE BATCHED REFUND ***");
      console.log("    reason:", e.message || e);
      record.verdict = "REFUTED";
      record.rejection = String(e.message || e);
    }

    const asks = loadAsks();
    asks[COVENANT_VERSION === "v3" ? "f12probeV3" : "f12probe"] = record;
    saveAsks(asks);
    console.log(
      `\nrecorded to spike/.asks.json under '${COVENANT_VERSION === "v3" ? "f12probeV3" : "f12probe"}'`
    );
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("PROBE FAILED (inconclusive, not a verdict):", e);
  process.exit(1);
});
