// Spike 07c: THE CONTROL for probe 07's V3 run.
//
// Probe 07 against V3 reported REFUTED — the chain rejected the batched
// refund. That result is worthless on its own: if V3 rejected EVERY
// refund, the probe would look identical while the covenant was actually
// stranding funds forever (the F13-class failure the whole campaign
// exists to avoid). This control settles which it is.
//
// It rebuilds the SAME two covenants probe 07 just funded (their UTXOs
// survived the rejected batch) and refunds each one INDIVIDUALLY. Both
// must be ACCEPTED, R2-verified from the node's UTXO set. That isolates
// the batched rejection to OpTxInputCount == 1 rather than a blanket
// failure, and recovers the probe funds.
//
// It also exercises the F21 fix: the refund pays (input - SOLVED fee)
// rather than the floor, so the sender gets back more than minRefund.
//
// Usage: node spike/07c-v3-refund-control.cjs        (TESTNET ONLY)
const {
  kaspa,
  NETWORK_ID,
  FEE_ALLOWANCE,
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

const { createTransaction, ScriptBuilder, sompiToKaspaString, addressFromScriptPublicKey } = kaspa;

(async () => {
  const asks = loadAsks();
  const probe = asks.f12probeV3;
  if (!probe) throw new Error("no f12probeV3 record — run probe 07 with ASK_COVENANT_VERSION=v3 first");
  if (probe.verdict !== "REFUTED") {
    throw new Error(`expected probe 07 V3 verdict REFUTED, found ${probe.verdict}`);
  }

  const { sender, recipient } = loadKeys();
  const senderAddress = sender.toAddress(NETWORK_ID).toString();
  const recipientXOnlyHex = xOnlyHex(recipient);
  const deadline = BigInt(probe.deadline);

  console.log("=== 07c: V3 single-input refund CONTROL ===");
  console.log("(does V3 reject ALL refunds, or only batched ones?)\n");
  assertV3VectorMatch();

  // Rebuild each covenant exactly as probe 07 built it.
  const specs = probe.covenants.map((c, i) => {
    const askIdHex = (i === 0 ? "aa" : "bb").repeat(32);
    const redeem = buildAskRedeemScriptV3({
      recipientXOnlyHex,
      senderAddress,
      deadlineDaa: deadline,
      askIdHex,
      refundAllowance: FEE_ALLOWANCE,
    });
    const p2sh = addressFromScriptPublicKey(
      redeem.createPayToScriptHashScript(),
      NETWORK_ID
    ).toString();
    if (p2sh !== c.p2shAddress) {
      throw new Error(
        `rebuild mismatch for covenant ${c.label}: rebuilt ${p2sh}, recorded ${c.p2shAddress}`
      );
    }
    return { ...c, redeemHex: redeem.toString(), p2shAddress: p2sh };
  });
  console.log("\nrebuilt both covenant addresses — match probe 07's records");

  const rpc = await connect();
  const results = [];
  try {
    for (const s of specs) {
      const utxos = await findP2shUtxos(rpc, s.p2shAddress);
      if (!utxos.length) {
        console.log(`  ${s.label}: no UTXO (already spent?) — skipping`);
        continue;
      }
      const utxo = utxos[0];
      const inputAmount = BigInt(utxo.amount);
      const floor = inputAmount - FEE_ALLOWANCE;

      const sigScript = new ScriptBuilder()
        .addData(Buffer.from([]))
        .addData(Buffer.from(s.redeemHex, "hex"))
        .drain();
      const build = (fee) => {
        const tx = createTransaction(
          [utxo],
          [{ address: senderAddress, amount: inputAmount - fee }],
          0n,
          undefined,
          0
        );
        tx.lockTime = deadline;
        tx.inputs[0].sequence = 0n;
        tx.inputs[0].signatureScript = sigScript;
        return tx;
      };

      // F21: pay the SOLVED fee, not the whole allowance.
      const { fee } = solveSpendFee({ networkId: NETWORK_ID, inputAmount, buildTx: build });
      const out = inputAmount - fee;
      console.log(
        `\n  ${s.label}: input ${sompiToKaspaString(inputAmount)} KAS, solved fee ${fee} sompi, ` +
          `paying ${sompiToKaspaString(out)} (floor ${sompiToKaspaString(floor)})`
      );
      if (out < floor) throw new Error("built refund below the covenant floor — aborting");

      try {
        const { transactionId } = await rpc.submitTransaction({ transaction: build(fee) });
        console.log(`  ${s.label}: ACCEPTED ${transactionId}`);
        results.push({
          label: s.label,
          outcome: "ACCEPTED",
          txid: transactionId,
          inputSompi: inputAmount.toString(),
          paidSompi: out.toString(),
          feeSompi: fee.toString(),
          floorSompi: floor.toString(),
          overFloorSompi: (out - floor).toString(),
        });
      } catch (e) {
        console.log(
          `  ${s.label}: ${isChainRejection(e) ? "REJECTED" : "INCONCLUSIVE"} ${String(e.message || e).slice(0, 140)}`
        );
        results.push({
          label: s.label,
          outcome: isChainRejection(e) ? "REJECTED" : "INCONCLUSIVE",
          reason: String(e.message || e),
        });
      }
    }

    // ---- R2: recompute from the node's UTXO set, fresh connection ------
    const accepted = results.filter((r) => r.outcome === "ACCEPTED");
    if (accepted.length) {
      console.log("\nR2: recomputing from the node's UTXO set (fresh connection)...");
      const rpc2 = await connect();
      try {
        for (const r of accepted) {
          let seen = null;
          for (let i = 0; i < 20 && !seen; i++) {
            const { entries } = await rpc2.getUtxosByAddresses({ addresses: [senderAddress] });
            const hit = entries.filter(
              (u) => String(u.outpoint.transactionId).toLowerCase() === r.txid.toLowerCase()
            );
            if (hit.length) seen = hit;
            else await new Promise((x) => setTimeout(x, 5000));
          }
          if (!seen) {
            r.r2 = "NOT OBSERVED in time";
            console.log(`  ${r.label}: refund output not observed — re-check before trusting`);
          } else {
            const paid = seen.reduce((a, u) => a + BigInt(u.amount), 0n);
            r.r2 = {
              outputs: seen.length,
              paidFromChainSompi: paid.toString(),
              matchesBuilt: paid.toString() === r.paidSompi,
            };
            console.log(
              `  ${r.label}: node shows ${seen.length} output(s), ${sompiToKaspaString(paid)} KAS ` +
                `(matches built amount: ${r.r2.matchesBuilt})`
            );
          }
        }
      } finally {
        await rpc2.disconnect();
      }
    }

    const allAccepted = results.length > 0 && results.every((r) => r.outcome === "ACCEPTED");
    const verdict = allAccepted
      ? "CONTROL PASS — V3 accepts single-input refunds. Probe 07's REFUTED verdict is therefore attributable to OpTxInputCount == 1 (the F12 fix), NOT to V3 rejecting refunds wholesale."
      : "CONTROL FAIL — V3 did not accept a single-input refund. The F12 'fix' may be stranding funds; probe 07's REFUTED verdict is NOT evidence the drain is closed.";
    console.log("\n=== VERDICT ===\n" + verdict);

    const a2 = loadAsks();
    a2.f12controlV3 = { network: NETWORK_ID, deadline: probe.deadline, results, verdict };
    saveAsks(a2);
    console.log("\nrecorded to spike/.asks.json under 'f12controlV3'");
    if (!allAccepted) process.exit(1);
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("CONTROL FAILED (inconclusive, not a verdict):", e);
  process.exit(1);
});
