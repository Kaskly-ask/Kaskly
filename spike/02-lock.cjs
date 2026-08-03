// Spike 02: lock KAS under the two-path ASK covenant (P2SH).
// Usage: node spike/02-lock.cjs <name> <deadlineDaaOffset> [amountKas]
//   e.g. node spike/02-lock.cjs claimtest 500000    (deadline far future)
//        node spike/02-lock.cjs refundtest 900      (deadline ~90s at 10 bps)
const {
  kaspa,
  NETWORK_ID,
  connect,
  loadKeys,
  buildAskRedeemScript,
  xOnlyHex,
  loadAsks,
  saveAsks,
} = require("./lib.cjs");

const [name, offsetArg, amountArg] = process.argv.slice(2);
if (!name || !offsetArg) {
  console.error("usage: node spike/02-lock.cjs <name> <deadlineDaaOffset> [amountKas]");
  process.exit(2);
}

(async () => {
  const { addressFromScriptPublicKey, createTransactions, kaspaToSompi } = kaspa;
  const { sender, recipient } = loadKeys();
  const rpc = await connect();
  try {
    const dag = await rpc.getBlockDagInfo();
    const currentDaa = BigInt(dag.virtualDaaScore);
    const deadline = currentDaa + BigInt(offsetArg);
    console.log("current virtual DAA score:", currentDaa.toString());
    console.log("deadline DAA score:", deadline.toString());

    const redeem = buildAskRedeemScript({
      recipientXOnlyHex: xOnlyHex(recipient),
      senderXOnlyHex: xOnlyHex(sender),
      deadline,
    });
    const redeemHex = redeem.toString();
    const p2shSpk = redeem.createPayToScriptHashScript();
    const p2shAddress = addressFromScriptPublicKey(p2shSpk, NETWORK_ID).toString();
    console.log("redeem script:", redeemHex);
    console.log("P2SH address:", p2shAddress);

    const senderAddress = sender.toAddress(NETWORK_ID).toString();
    const { entries } = await rpc.getUtxosByAddresses({ addresses: [senderAddress] });
    if (!entries.length) {
      console.error(`sender has no UTXOs — fund ${senderAddress} from the TN10 faucet first`);
      process.exit(1);
    }

    const amount = kaspaToSompi(amountArg || "1");
    const { transactions, summary } = await createTransactions({
      entries,
      outputs: [{ address: p2shAddress, amount }],
      changeAddress: senderAddress,
      priorityFee: 0n,
      networkId: NETWORK_ID,
    });
    for (const pending of transactions) {
      await pending.sign([sender.privateKey]);
      const txid = await pending.submit(rpc);
      console.log("lock txid:", txid);
      const asks = loadAsks();
      asks[name] = {
        redeemScript: redeemHex,
        p2shAddress,
        deadline: deadline.toString(),
        amount: amount.toString(),
        lockTxid: txid,
        network: NETWORK_ID,
        createdDaa: currentDaa.toString(),
      };
      saveAsks(asks);
    }
    console.log("summary fees:", summary.fees);
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
