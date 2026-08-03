// Spike 04: timeout refund — after the deadline, spend the covenant UTXO
// back to the SENDER via the CLTV branch (brief A4).
// Usage: node spike/04-refund.cjs <name> [--force-early]
//   --force-early = R3 "refund before deadline" attack (expected: CHAIN REJECTS)
const {
  kaspa,
  NETWORK_ID,
  FEE_ALLOWANCE,
  connect,
  loadKeys,
  buildSpendSignatureScript,
  loadAsks,
  saveAsks,
  findP2shUtxos,
} = require("./lib.cjs");

const args = process.argv.slice(2);
const name = args[0];
const forceEarly = args.includes("--force-early");
if (!name) {
  console.error("usage: node spike/04-refund.cjs <name> [--force-early]");
  process.exit(2);
}

(async () => {
  const { createTransaction, createInputSignature, PrivateKey } = kaspa;
  const { sender } = loadKeys();
  const ask = loadAsks()[name];
  if (!ask) throw new Error(`unknown ask '${name}' — run 02-lock first`);
  const deadline = BigInt(ask.deadline);

  const rpc = await connect();
  try {
    const dag = await rpc.getBlockDagInfo();
    const currentDaa = BigInt(dag.virtualDaaScore);
    console.log(`current DAA ${currentDaa}, deadline ${deadline}, past: ${currentDaa >= deadline}`);
    if (currentDaa < deadline && !forceEarly) {
      throw new Error("deadline not reached — use --force-early to run the R3 early-refund attack");
    }

    const utxos = await findP2shUtxos(rpc, ask.p2shAddress);
    if (!utxos.length) throw new Error("no UTXO at the covenant address (already spent?)");
    const utxo = utxos[0];

    const senderAddress = sender.toAddress(NETWORK_ID).toString();
    const outAmount = BigInt(utxo.amount) - FEE_ALLOWANCE;
    const tx = createTransaction(
      [utxo],
      [{ address: senderAddress, amount: outAmount }],
      0n,
      undefined,
      1
    );
    // CLTV requirements (verified from v2.0.1 opcodes/mod.rs): tx.lockTime >=
    // stack deadline, same threshold class, input sequence != MAX. Set these
    // BEFORE signing — the sighash commits to them.
    tx.lockTime = deadline;
    tx.inputs[0].sequence = 0n;

    const sig = createInputSignature(tx, 0, new PrivateKey(sender.privateKey));
    tx.inputs[0].signatureScript = buildSpendSignatureScript(ask.redeemScript, sig, false);

    const { transactionId } = await rpc.submitTransaction({ transaction: tx });
    console.log(forceEarly ? "UNEXPECTED: early refund ACCEPTED:" : "refund txid:", transactionId);
    if (forceEarly) process.exit(1);
    const asks = loadAsks();
    asks[name].refundTxid = transactionId;
    asks[name].spentOutpoint = {
      transactionId: utxo.outpoint.transactionId,
      index: utxo.outpoint.index,
      amount: utxo.amount.toString(),
      blockDaaScore: utxo.blockDaaScore.toString(),
    };
    saveAsks(asks);
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  if (forceEarly) {
    console.log("EXPECTED REJECTION (early refund):", e.message || e);
  } else {
    console.error("FAILED:", e);
    process.exit(1);
  }
});
