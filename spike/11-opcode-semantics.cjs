// Spike 11: VERIFICATION SPIKE for the V3 covenant design (hard gate).
//
// Settles, empirically, three things the SDK enum cannot tell us:
//   Q1. Do introspection opcodes pop an input index (OpTxInputIndex
//       OpOutpointTxId) or act on the current input implicitly?
//   Q2. What BYTE ORDER does OpOutpointTxId push, relative to a txid as
//       displayed by RPC/explorers?
//   Q3. Does OpTxPayloadSubstr fail or push-short when the payload is
//       shorter than the requested range?
//
// WHY THIS IS A GATE: mechanism M2 compares a payload field against
// OpOutpointTxId. A wrong-endian compare would make 100% of V3 Asks
// permanently unclaimable — an F13-class stranding bug introduced by the
// F22 fix. No V3 script may be authored until this reports a verdict.
//
// CIRCULARITY NOTE: we cannot bake the expected txid into the script,
// because the script's P2SH address must exist before the funding tx that
// creates the txid. So the comparison is done the way M2 would really do
// it: the script compares the SPEND transaction's PAYLOAD against
// OpOutpointTxId. At spend time the funding txid is known, so we put it in
// the payload — first as displayed, then byte-reversed. Exactly one order
// should be accepted, and that answers Q2.
//
// This spike authors NO V3 covenant. It builds throwaway probe scripts.
// Usage: node spike/11-opcode-semantics.cjs        (TESTNET ONLY)
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
} = require("./lib.cjs");

const PROBE_AMOUNT = "0.5"; // clear of the F13 fragile band (~0.105-0.15)

// Probe script: assert payload[0..32] == <this input's outpoint txid>,
// then require a signature so only we can sweep it back.
//   indexForm=true  ->  OpTxInputIndex OpOutpointTxId   (opcode pops index)
//   indexForm=false ->  OpOutpointTxId                  (implicit current input)
function buildProbeScript({ senderXOnlyHex, indexForm }) {
  const { ScriptBuilder, Opcodes } = kaspa;
  const b = new ScriptBuilder()
    .addI64(0n)
    .addI64(32n)
    .addOp(Opcodes.OpTxPayloadSubstr);
  if (indexForm) b.addOp(Opcodes.OpTxInputIndex);
  b.addOp(Opcodes.OpOutpointTxId)
    .addOp(Opcodes.OpEqualVerify)
    .addData(Buffer.from(senderXOnlyHex, "hex"))
    .addOp(Opcodes.OpCheckSig);
  return b;
}

(async () => {
  const {
    addressFromScriptPublicKey,
    createTransactions,
    createTransaction,
    kaspaToSompi,
    createInputSignature,
    PrivateKey,
    ScriptBuilder,
  } = kaspa;
  const { sender } = loadKeys();
  const senderAddress = sender.toAddress(NETWORK_ID).toString();
  const senderXOnly = xOnlyHex(sender);
  const rpc = await connect();
  const results = { network: NETWORK_ID, q1: null, q2: null, q3: null, attempts: [] };

  try {
    // Two variants, so Q1 is answered even if one form is simply invalid.
    const variants = [
      { label: "index-form", indexForm: true },
      { label: "implicit-form", indexForm: false },
    ].map((v) => {
      const script = buildProbeScript({ senderXOnlyHex: senderXOnly, indexForm: v.indexForm });
      const redeemHex = script.toString();
      return {
        ...v,
        redeemHex,
        p2shAddress: addressFromScriptPublicKey(
          script.createPayToScriptHashScript(),
          NETWORK_ID
        ).toString(),
      };
    });

    console.log("=== Spike 11: OpOutpointTxId semantics (V3 design gate) ===");
    console.log("network:", NETWORK_ID);
    for (const v of variants) console.log(`  ${v.label}: ${v.p2shAddress}`);

    // --- FUND both probe scripts in one transaction ---
    const amount = kaspaToSompi(PROBE_AMOUNT);
    const { entries } = await rpc.getUtxosByAddresses({ addresses: [senderAddress] });
    const { transactions } = await createTransactions({
      entries,
      outputs: variants.map((v) => ({ address: v.p2shAddress, amount })),
      changeAddress: senderAddress,
      priorityFee: 0n,
      networkId: NETWORK_ID,
    });
    let fundTxid;
    for (const pending of transactions) {
      await pending.sign([sender.privateKey]);
      fundTxid = await pending.submit(rpc);
    }
    console.log("\nfunding txid (as reported by RPC):", fundTxid);
    results.fundTxid = fundTxid;

    // Wait for the probe UTXOs to appear.
    for (const v of variants) {
      for (let i = 0; i < 20 && !v.utxo; i++) {
        const u = await findP2shUtxos(rpc, v.p2shAddress);
        if (u.length) v.utxo = u[0];
        else await new Promise((r) => setTimeout(r, 5000));
      }
      if (!v.utxo) throw new Error(`probe UTXO for ${v.label} never appeared`);
      console.log(
        `  ${v.label} utxo outpoint txid (RPC view): ${v.utxo.outpoint.transactionId}`
      );
    }

    // Byte orders under test: as-displayed, and reversed.
    const asDisplayed = Buffer.from(fundTxid, "hex");
    const reversed = Buffer.from([...asDisplayed].reverse());
    const orders = [
      { label: "as-displayed", bytes: asDisplayed },
      { label: "byte-reversed", bytes: reversed },
    ];

    // Try each (variant x byte order): spend back to sender with the txid
    // in the payload. Acceptance identifies BOTH the calling form and the
    // byte order.
    for (const v of variants) {
      for (const o of orders) {
        const payloadHex = o.bytes.toString("hex") + "00".repeat(8); // 32 + padding
        const fee = 100000n;
        const tx = createTransaction(
          [v.utxo],
          [{ address: senderAddress, amount: BigInt(v.utxo.amount) - fee }],
          0n,
          payloadHex,
          1
        );
        const sig = createInputSignature(tx, 0, new PrivateKey(sender.privateKey.toString()));
        const rawSig = Buffer.from(sig, "hex");
        const stripped =
          rawSig.length >= 2 && rawSig[0] === rawSig.length - 1 && rawSig[0] <= 75
            ? rawSig.subarray(1)
            : rawSig;
        tx.inputs[0].signatureScript = new ScriptBuilder()
          .addData(stripped)
          .addData(Buffer.from(v.redeemHex, "hex"))
          .drain();

        const attempt = { variant: v.label, byteOrder: o.label };
        try {
          const { transactionId } = await rpc.submitTransaction({ transaction: tx });
          attempt.result = "ACCEPTED";
          attempt.txid = transactionId;
          console.log(`\n*** ACCEPTED: ${v.label} + ${o.label} -> ${transactionId}`);
          results.q1 = v.indexForm
            ? "introspection opcodes POP an input index (OpTxInputIndex OpOutpointTxId)"
            : "OpOutpointTxId acts on the CURRENT input implicitly";
          results.q2 = `OpOutpointTxId pushes the txid ${o.label} relative to the RPC/explorer form`;
          v.spent = true;
        } catch (e) {
          if (!isChainRejection(e)) {
            attempt.result = "INCONCLUSIVE (not a chain rejection)";
            attempt.error = String(e.message || e);
            console.log(`  INCONCLUSIVE: ${v.label} + ${o.label}: ${attempt.error}`);
          } else {
            attempt.result = "chain-rejected";
            attempt.rejection = String(e.message || e);
            console.log(`  rejected: ${v.label} + ${o.label}`);
          }
        }
        results.attempts.push(attempt);
        if (v.spent) break; // UTXO consumed; don't retry this variant
      }
    }

    // --- Q3: short-payload behaviour, on whichever variant still has funds ---
    const leftover = variants.find((v) => !v.spent);
    if (leftover) {
      const fee = 100000n;
      const tx = createTransaction(
        [leftover.utxo],
        [{ address: senderAddress, amount: BigInt(leftover.utxo.amount) - fee }],
        0n,
        "aabb", // 2 bytes — far shorter than the requested 0..32 range
        1
      );
      const sig = createInputSignature(tx, 0, new PrivateKey(sender.privateKey.toString()));
      const rawSig = Buffer.from(sig, "hex");
      const stripped =
        rawSig.length >= 2 && rawSig[0] === rawSig.length - 1 && rawSig[0] <= 75
          ? rawSig.subarray(1)
          : rawSig;
      tx.inputs[0].signatureScript = new ScriptBuilder()
        .addData(stripped)
        .addData(Buffer.from(leftover.redeemHex, "hex"))
        .drain();
      try {
        const { transactionId } = await rpc.submitTransaction({ transaction: tx });
        results.q3 = `SHORT PAYLOAD ACCEPTED on ${leftover.label} (${transactionId}) — OpTxPayloadSubstr does NOT hard-fail on short payloads; V3 MUST length-check explicitly`;
        console.log("\n*** " + results.q3);
      } catch (e) {
        if (!isChainRejection(e)) {
          results.q3 = `INCONCLUSIVE: ${String(e.message || e)}`;
        } else {
          results.q3 = "short payload chain-rejected — OpTxPayloadSubstr fails closed on out-of-range";
        }
        console.log("\nQ3: " + results.q3);
      }
    } else {
      results.q3 = "not tested (both probe UTXOs consumed by accepted spends)";
    }

    console.log("\n=== VERDICT ===");
    console.log("Q1 (calling form):", results.q1 || "UNRESOLVED — no variant accepted");
    console.log("Q2 (byte order)  :", results.q2 || "UNRESOLVED — no variant accepted");
    console.log("Q3 (short payload):", results.q3 || "not tested");
    if (!results.q1 || !results.q2) {
      console.log(
        "\nNo combination was accepted. That does NOT confirm M1 by itself —\n" +
          "it means OpOutpointTxId's usage differs from both forms tried, or the\n" +
          "probe script is wrong. Investigate before concluding anything about M2."
      );
    }

    const asks = loadAsks();
    asks.opcodeSemantics = results;
    saveAsks(asks);
    console.log("\nrecorded to spike/.asks.json under 'opcodeSemantics'");
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("SPIKE FAILED (inconclusive, not a verdict):", e);
  process.exit(1);
});
