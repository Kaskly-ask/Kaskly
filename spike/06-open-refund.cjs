// Spike 06: hardened "anyone-can-trigger" refund covenant (Phase 2 design
// goal from the Phase 1 gate). Refund branch requires NO signature; instead
// the covenant pins: exactly 1 output, paying >= minRefund to the SENDER's
// SPK. Lock, wait out the deadline, run two attacks (wrong destination,
// skimmed amount), then the legitimate sig-less refund.
// Usage: node spike/06-open-refund.cjs
const {
  kaspa,
  NETWORK_ID,
  FEE_ALLOWANCE,
  connect,
  isChainRejection,
  loadKeys,
  buildAskRedeemScriptV2,
  spkToStackBytes,
  xOnlyHex,
  loadAsks,
  saveAsks,
  findP2shUtxos,
} = require("./lib.cjs");

const DEADLINE_OFFSET = 600n; // ~60s at 10 DAA/s

(async () => {
  const {
    addressFromScriptPublicKey,
    payToAddressScript,
    createTransactions,
    createTransaction,
    kaspaToSompi,
    ScriptBuilder,
  } = kaspa;
  const { sender, recipient } = loadKeys();
  const senderAddress = sender.toAddress(NETWORK_ID).toString();
  const recipientAddress = recipient.toAddress(NETWORK_ID).toString();
  const rpc = await connect();
  try {
    // --- LOCK ---
    const dag = await rpc.getBlockDagInfo();
    const deadline = BigInt(dag.virtualDaaScore) + DEADLINE_OFFSET;
    const amount = kaspaToSompi("1");
    const minRefund = amount - FEE_ALLOWANCE;
    const senderSpkBytes = spkToStackBytes(payToAddressScript(senderAddress));
    console.log("sender SPK stack bytes:", senderSpkBytes.toString("hex"));

    const redeem = buildAskRedeemScriptV2({
      recipientXOnlyHex: xOnlyHex(recipient),
      senderSpkBytes,
      deadline,
      minRefund,
    });
    const redeemHex = redeem.toString();
    const p2shAddress = addressFromScriptPublicKey(
      redeem.createPayToScriptHashScript(),
      NETWORK_ID
    ).toString();
    console.log("V2 P2SH address:", p2shAddress, "deadline:", deadline.toString());

    const { entries } = await rpc.getUtxosByAddresses({ addresses: [senderAddress] });
    const { transactions } = await createTransactions({
      entries,
      outputs: [{ address: p2shAddress, amount }],
      changeAddress: senderAddress,
      priorityFee: 0n,
      networkId: NETWORK_ID,
    });
    let lockTxid;
    for (const pending of transactions) {
      await pending.sign([sender.privateKey]);
      lockTxid = await pending.submit(rpc);
    }
    console.log("V2 lock txid:", lockTxid);
    const asks = loadAsks();
    asks.openrefund = {
      redeemScript: redeemHex,
      p2shAddress,
      deadline: deadline.toString(),
      amount: amount.toString(),
      lockTxid,
      network: NETWORK_ID,
      variant: "v2-open-refund",
    };
    saveAsks(asks);

    // --- WAIT OUT THE DEADLINE ---
    for (;;) {
      const d = await rpc.getBlockDagInfo();
      const daa = BigInt(d.virtualDaaScore);
      console.log("DAA", daa.toString(), "/ deadline", deadline.toString());
      if (daa >= deadline + 20n) break;
      await new Promise((r) => setTimeout(r, 15000));
    }

    const utxos = await findP2shUtxos(rpc, p2shAddress);
    if (!utxos.length) throw new Error("V2 lock UTXO not found");
    const utxo = utxos[0];

    // Sig-less refund trigger: sigscript = push(<empty selector>) push(redeem)
    const openSigScript = new ScriptBuilder()
      .addData(Buffer.from([]))
      .addData(Buffer.from(redeemHex, "hex"))
      .drain();
    const makeRefundTx = (destAddress, outAmount) => {
      const tx = createTransaction(
        [utxo],
        [{ address: destAddress, amount: outAmount }],
        0n,
        undefined,
        0
      );
      tx.lockTime = deadline;
      tx.inputs[0].sequence = 0n;
      tx.inputs[0].signatureScript = openSigScript;
      return tx;
    };

    // --- ATTACK 1: refund to the WRONG destination (recipient) ---
    try {
      const { transactionId } = await rpc.submitTransaction({
        transaction: makeRefundTx(recipientAddress, minRefund),
      });
      console.log("UNEXPECTED: wrong-destination refund ACCEPTED:", transactionId);
      process.exit(1);
    } catch (e) {
      if (!isChainRejection(e)) throw e;
      console.log("EXPECTED CHAIN REJECTION (wrong destination):", e.message || e);
    }

    // --- ATTACK 2: skim — pay sender less than minRefund (rest to fees) ---
    try {
      const { transactionId } = await rpc.submitTransaction({
        transaction: makeRefundTx(senderAddress, minRefund - 100000n),
      });
      console.log("UNEXPECTED: skimmed refund ACCEPTED:", transactionId);
      process.exit(1);
    } catch (e) {
      if (!isChainRejection(e)) throw e;
      console.log("EXPECTED CHAIN REJECTION (skimmed amount):", e.message || e);
    }

    // --- LEGITIMATE: sig-less refund, full amount minus fee, to sender ---
    const { transactionId } = await rpc.submitTransaction({
      transaction: makeRefundTx(senderAddress, minRefund),
    });
    console.log("SIG-LESS OPEN REFUND ACCEPTED, txid:", transactionId);
    const asks2 = loadAsks();
    asks2.openrefund.refundTxid = transactionId;
    saveAsks(asks2);
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
