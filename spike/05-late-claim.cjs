// Spike 05: R3 "claim after deadline" attack, in two honest variants.
//
// Variant A (post-refund): the ask was already refunded (04). Rebuild a
//   claim tx against the now-SPENT outpoint and submit. Expected: CHAIN
//   REJECTS (outpoint no longer in the UTXO set / double-spend).
//
// Variant B (pre-refund race): the deadline has passed but no refund was
//   broadcast yet. Attempt a claim. Per the VERIFIED opcode semantics there
//   is NO script primitive that lets the claim branch observe current DAA
//   score, so the claim is EXPECTED TO SUCCEED — this documents the
//   deadline-race window honestly (brief D9/R6). Run against a dedicated
//   'racetest' ask whose funds we sacrifice to the recipient.
//
// Usage: node spike/05-late-claim.cjs <name>   (variant chosen automatically)
const {
  kaspa,
  NETWORK_ID,
  ASK_PREFIX,
  FEE_ALLOWANCE,
  connect,
  loadKeys,
  buildAskRedeemScript,
  buildSpendSignatureScript,
  xOnlyHex,
  loadAsks,
  findP2shUtxos,
} = require("./lib.cjs");

const name = process.argv[2];
if (!name) {
  console.error("usage: node spike/05-late-claim.cjs <name>");
  process.exit(2);
}

(async () => {
  const { createTransaction, createInputSignature, PrivateKey, ScriptBuilder } = kaspa;
  const { sender, recipient } = loadKeys();
  const ask = loadAsks()[name];
  if (!ask) throw new Error(`unknown ask '${name}'`);
  const deadline = BigInt(ask.deadline);

  const rpc = await connect();
  try {
    const dag = await rpc.getBlockDagInfo();
    const currentDaa = BigInt(dag.virtualDaaScore);
    if (currentDaa < deadline) {
      throw new Error(`deadline not passed yet (${currentDaa} < ${deadline}) — this attack is about POST-deadline claims`);
    }

    const live = await findP2shUtxos(rpc, ask.p2shAddress);
    let utxo;
    let variant;
    if (live.length) {
      variant = "B (pre-refund race window)";
      utxo = live[0];
    } else {
      variant = "A (post-refund double-spend)";
      if (!ask.spentOutpoint) throw new Error("no live UTXO and no recorded spent outpoint");
      // Reconstruct the spent UTXO entry; SPK derives from the redeem script.
      const spk = ScriptBuilder.fromScript(ask.redeemScript).createPayToScriptHashScript();
      utxo = {
        outpoint: {
          transactionId: ask.spentOutpoint.transactionId,
          index: ask.spentOutpoint.index,
        },
        amount: BigInt(ask.spentOutpoint.amount),
        scriptPublicKey: spk,
        blockDaaScore: BigInt(ask.spentOutpoint.blockDaaScore),
        isCoinbase: false,
      };
    }
    console.log("variant:", variant);

    const payloadHex = Buffer.from(ASK_PREFIX + "sorry, late reply", "utf8").toString("hex");
    const recipientAddress = recipient.toAddress(NETWORK_ID).toString();
    const tx = createTransaction(
      [utxo],
      [{ address: recipientAddress, amount: BigInt(utxo.amount) - FEE_ALLOWANCE }],
      0n,
      payloadHex,
      1
    );
    const sig = createInputSignature(tx, 0, new PrivateKey(recipient.privateKey));
    tx.inputs[0].signatureScript = buildSpendSignatureScript(ask.redeemScript, sig, true);

    try {
      const { transactionId } = await rpc.submitTransaction({ transaction: tx });
      console.log(`late claim ACCEPTED by chain (txid ${transactionId})`);
      console.log(variant.startsWith("B")
        ? "FINDING: confirms the pre-refund race window — late claims are NOT chain-rejected until the refund spends the UTXO."
        : "UNEXPECTED for variant A — investigate!");
      if (variant.startsWith("A")) process.exit(1);
    } catch (e) {
      console.log("late claim REJECTED by chain:", e.message || e);
      console.log(variant.startsWith("A")
        ? "EXPECTED for variant A: refund already consumed the UTXO — chain enforces no-claim-after-refund."
        : "UNEXPECTED for variant B — a rejection here would mean the chain CAN expire claims; investigate what rejected it!");
    }
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
