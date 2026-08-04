// Spike 11b: opcode-semantics verification, WITH A POSITIVE CONTROL.
//
// Why 11b exists: spike 11 produced four rejections, but two were caused by
// a hardcoded fee (my bug) and one was unattributable between OpEqualVerify
// and OpCheckSig. Only Q1 survived, because its error message was
// self-identifying. Without a control that MUST pass, "rejected" is
// indistinguishable from "my probe is broken".
//
// ORDER MATTERS. Step 0 is the control. If it fails, everything after it is
// uninterpretable, so this script ABORTS rather than reporting verdicts.
//
// Questions:
//   CONTROL. Does a plain <key> OpCheckSig P2SH spend through this exact
//            signing code? (Exonerates OpCheckSig + sigscript construction,
//            making any later "verification failed" attributable to the
//            comparison under test.)
//   Q1'. Corroborate spike 11's finding that introspection opcodes POP an
//        input index (currently source-inferred from a self-identifying
//        "Number too big" error, not confirmed against rusty-kaspa source).
//   Q2.  Byte order OpOutpointTxId pushes, vs the RPC/explorer form.
//   Q3.  OpTxPayloadSubstr behaviour when the payload is shorter than the
//        requested range (gates M1's payload handling).
//   Q4.  F12 floor arithmetic: does OpTxInputAmount return sompi usable as
//        a script number, does OpTxInputIndex work in arithmetic position,
//        and does OpSub handle those magnitudes — i.e. does the floor
//        comparison actually COMPUTE, not merely assemble.
//
// All fees are mass-derived via the shared solveSpendFee helper. No V3
// covenant is authored here.
// Usage: node spike/11b-opcode-semantics.cjs        (TESTNET ONLY)
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

const PROBE_AMOUNT = "0.5"; // clear of the F13 fragile band (~0.105-0.15)
const TEST_ALLOWANCE = 300000n; // stand-in allowance for the Q4 floor test

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

function p2shAddressOf(script) {
  return addressFromScriptPublicKey(
    script.createPayToScriptHashScript(),
    NETWORK_ID
  ).toString();
}

// createInputSignature returns a PUSH-ENCODED fragment; strip the prefix
// before re-pushing (verified empirically, see lib.cjs).
function stripPush(sigHex) {
  const b = Buffer.from(sigHex, "hex");
  return b.length >= 2 && b[0] === b.length - 1 && b[0] <= 75 ? b.subarray(1) : b;
}

/** Build a signed spend of `utxo` paying `outAmount` to `dest`, with the
 * given payload, redeeming `redeemHex`. */
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

/** Solve the fee for such a spend, then return the final signed tx. */
function buildSpendWithSolvedFee(opts) {
  const inputAmount = BigInt(opts.utxo.amount);
  const { fee, trace } = solveSpendFee({
    networkId: NETWORK_ID,
    inputAmount,
    buildTx: (f) => buildSpend({ ...opts, outAmount: inputAmount - f }),
  });
  return {
    tx: buildSpend({ ...opts, outAmount: inputAmount - fee }),
    fee,
    trace,
    outAmount: inputAmount - fee,
  };
}

(async () => {
  const { sender } = loadKeys();
  const senderAddress = sender.toAddress(NETWORK_ID).toString();
  const senderXOnly = xOnlyHex(sender);
  const privKey = sender.privateKey.toString();
  const results = { network: NETWORK_ID, control: null, q1: null, q2: null, q3: null, q4: null };
  const rpc = await connect();

  try {
    // ---- Script definitions -------------------------------------------
    // CONTROL: plain key + OpCheckSig.
    const controlScript = new ScriptBuilder()
      .addData(Buffer.from(senderXOnly, "hex"))
      .addOp(Opcodes.OpCheckSig);

    // Q2/Q3: payload[0..32] == <this input's outpoint txid>, then signature.
    const outpointScript = new ScriptBuilder()
      .addI64(0n)
      .addI64(32n)
      .addOp(Opcodes.OpTxPayloadSubstr)
      .addOp(Opcodes.OpTxInputIndex)
      .addOp(Opcodes.OpOutpointTxId)
      .addOp(Opcodes.OpEqualVerify)
      .addData(Buffer.from(senderXOnly, "hex"))
      .addOp(Opcodes.OpCheckSig);

    // Q4: the F12 floor arithmetic, isolated —
    //   output[0].amount >= (thisInput.amount - allowance)
    // then a signature so the probe funds stay recoverable.
    const floorScript = new ScriptBuilder()
      .addI64(0n)
      .addOp(Opcodes.OpTxOutputAmount)
      .addOp(Opcodes.OpTxInputIndex)
      .addOp(Opcodes.OpTxInputAmount)
      .addI64(TEST_ALLOWANCE)
      .addOp(Opcodes.OpSub)
      .addOp(Opcodes.OpGreaterThanOrEqual)
      .addOp(Opcodes.OpVerify)
      .addData(Buffer.from(senderXOnly, "hex"))
      .addOp(Opcodes.OpCheckSig);

    const probes = [
      { key: "control", script: controlScript },
      { key: "outpoint", script: outpointScript },
      { key: "floor", script: floorScript },
    ].map((p) => ({
      ...p,
      redeemHex: p.script.toString(),
      p2shAddress: p2shAddressOf(p.script),
    }));

    console.log("=== Spike 11b: opcode semantics WITH positive control ===");
    console.log("network:", NETWORK_ID, "\n");
    for (const p of probes) console.log(`  ${p.key.padEnd(9)} ${p.p2shAddress}`);

    // ---- Fund all three ------------------------------------------------
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
    console.log("\nfunding txid (RPC view):", fundTxid);
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

    // Submit helper: returns {ok, txid} or {ok:false, chain, reason}.
    async function submit(tx) {
      try {
        const { transactionId } = await rpc.submitTransaction({ transaction: tx });
        return { ok: true, txid: transactionId };
      } catch (e) {
        return {
          ok: false,
          chain: isChainRejection(e),
          reason: String(e.message || e),
        };
      }
    }

    // ---- STEP 0: POSITIVE CONTROL (gate) -------------------------------
    console.log("\n--- STEP 0: positive control (plain key + OpCheckSig) ---");
    {
      const c = byKey.control;
      const built = buildSpendWithSolvedFee({
        utxo: c.utxo,
        dest: senderAddress,
        payloadHex: "",
        redeemHex: c.redeemHex,
        privKey,
      });
      console.log(`  solved fee: ${built.fee} sompi (trace ${built.trace.join(" ")})`);
      const r = await submit(built.tx);
      results.control = r.ok
        ? `PASS — control spent (${r.txid}); OpCheckSig + sigscript construction + fee solving all sound`
        : `FAIL — ${r.reason}`;
      console.log("  " + results.control);
      if (!r.ok) {
        console.log(
          "\n*** ABORTING: the control failed, so no opcode result from this run\n" +
            "    would be interpretable. Fix the harness before drawing any\n" +
            "    conclusion about OpOutpointTxId, OpTxPayloadSubstr, or the\n" +
            "    F12 floor arithmetic. This is NOT evidence about Kaspa."
        );
        const asks = loadAsks();
        asks.opcodeSemantics11b = results;
        saveAsks(asks);
        process.exit(1);
      }
    }

    // ---- STEP 1: Q2 byte order (+ Q1' corroboration) -------------------
    console.log("\n--- STEP 1: Q2 OpOutpointTxId byte order ---");
    {
      const p = byKey.outpoint;
      const asDisplayed = Buffer.from(fundTxid, "hex");
      const orders = [
        { label: "as-displayed", bytes: asDisplayed },
        { label: "byte-reversed", bytes: Buffer.from([...asDisplayed].reverse()) },
      ];
      for (const o of orders) {
        const built = buildSpendWithSolvedFee({
          utxo: p.utxo,
          dest: senderAddress,
          payloadHex: o.bytes.toString("hex"),
          redeemHex: p.redeemHex,
          privKey,
        });
        const r = await submit(built.tx);
        console.log(
          `  ${o.label.padEnd(14)} fee=${built.fee} -> ${r.ok ? "ACCEPTED " + r.txid : r.reason}`
        );
        if (r.ok) {
          results.q2 = `OpOutpointTxId pushes the txid ${o.label} relative to the RPC/explorer form (accepted ${r.txid})`;
          results.q1 =
            "CORROBORATED: the index form (OpTxInputIndex OpOutpointTxId) executes and compares — introspection opcodes pop an input index";
          p.spent = true;
          break;
        }
      }
      if (!results.q2) {
        results.q2 =
          "UNRESOLVED — both byte orders rejected DESPITE a passing control. That now points at OpOutpointTxId semantics, not the harness. Investigate the calling form before authoring M2.";
      }
      console.log("  => " + results.q2);
    }

    // ---- STEP 2: Q3 substr bounds --------------------------------------
    console.log("\n--- STEP 2: Q3 OpTxPayloadSubstr short-payload bounds ---");
    {
      const p = byKey.outpoint;
      if (p.spent) {
        results.q3 =
          "NOT TESTED — the outpoint probe UTXO was consumed by the Q2 success. Re-run with a dedicated UTXO to settle bounds behaviour.";
      } else {
        const built = buildSpendWithSolvedFee({
          utxo: p.utxo,
          dest: senderAddress,
          payloadHex: "aabb", // 2 bytes, far short of the requested 0..32
          redeemHex: p.redeemHex,
          privKey,
        });
        const r = await submit(built.tx);
        results.q3 = r.ok
          ? `SHORT PAYLOAD ACCEPTED (${r.txid}) — OpTxPayloadSubstr does NOT fail closed; M1's V3 script MUST length-check before the askId compare`
          : `short payload rejected (${r.reason}) — consistent with fail-closed, and now attributable because the control passed`;
      }
      console.log("  => " + results.q3);
    }

    // ---- STEP 3: Q4 F12 floor arithmetic -------------------------------
    console.log("\n--- STEP 3: Q4 floor arithmetic (output >= input - allowance) ---");
    {
      const p = byKey.floor;
      const inputAmount = BigInt(p.utxo.amount);
      // 3a. NEGATIVE: pay BELOW the floor. Must be rejected, or the
      //     comparison is not actually constraining anything.
      const belowOut = inputAmount - TEST_ALLOWANCE - 50000n;
      const belowTx = buildSpend({
        utxo: p.utxo,
        dest: senderAddress,
        outAmount: belowOut,
        payloadHex: "",
        redeemHex: p.redeemHex,
        privKey,
      });
      const rBelow = await submit(belowTx);
      console.log(
        `  below-floor  out=${belowOut} -> ${rBelow.ok ? "ACCEPTED (BAD) " + rBelow.txid : "rejected"}`
      );

      // 3b. POSITIVE: pay AT/ABOVE the floor with a solved fee.
      const built = buildSpendWithSolvedFee({
        utxo: p.utxo,
        dest: senderAddress,
        payloadHex: "",
        redeemHex: p.redeemHex,
        privKey,
      });
      const withinFloor = built.outAmount >= inputAmount - TEST_ALLOWANCE;
      const rAbove = await submit(built.tx);
      console.log(
        `  above-floor  out=${built.outAmount} (fee ${built.fee}, within floor: ${withinFloor}) -> ` +
          `${rAbove.ok ? "ACCEPTED " + rAbove.txid : rAbove.reason}`
      );

      if (rAbove.ok && !rBelow.ok) {
        results.q4 =
          `CONFIRMED — the floor comparison computes and constrains: OpTxInputAmount returns usable sompi, ` +
          `OpTxInputIndex works in arithmetic position, OpSub handles the magnitudes. ` +
          `Below-floor rejected, above-floor accepted (${rAbove.txid}).`;
      } else if (rBelow.ok) {
        results.q4 =
          "FAILED — a below-floor spend was ACCEPTED. The comparison does not constrain; the F12 fix as designed would not hold. Do not author V3.";
      } else {
        results.q4 = `UNRESOLVED — above-floor spend also rejected (${rAbove.reason}). With the control passing this points at the arithmetic, not the harness.`;
      }
      console.log("  => " + results.q4);
    }

    console.log("\n=== VERDICTS ===");
    console.log("CONTROL:", results.control);
    console.log("Q1':", results.q1 || "not corroborated this run");
    console.log("Q2 :", results.q2);
    console.log("Q3 :", results.q3);
    console.log("Q4 :", results.q4);

    const asks = loadAsks();
    asks.opcodeSemantics11b = results;
    saveAsks(asks);
    console.log("\nrecorded to spike/.asks.json under 'opcodeSemantics11b'");
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("SPIKE FAILED (inconclusive, not a verdict):", e);
  process.exit(1);
});
