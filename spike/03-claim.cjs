// Spike 03: claim-by-reply — spend the covenant UTXO to the RECIPIENT with
// the reply carried in the tx payload. One atomic transaction (brief A3).
// Usage: node spike/03-claim.cjs <name> [replyText] [--key sender|recipient]
//   --key sender  = R3 "claim by wrong key" attack (expected: CHAIN REJECTS)
const {
  kaspa,
  NETWORK_ID,
  ASK_PREFIX,
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
const reply = args.includes("--key") ? args[1] : args[1] || "yes, let's talk!";
const wrongKey = args.includes("--key") && args[args.indexOf("--key") + 1] === "sender";
// R3 attack: claim WITHOUT the reply payload (expect chain rejection via
// the OpTxPayloadSubstr prefix check in the claim branch).
const noPayload = args.includes("--no-payload");
if (!name) {
  console.error("usage: node spike/03-claim.cjs <name> [replyText] [--key sender|recipient]");
  process.exit(2);
}

(async () => {
  const { createTransaction, createInputSignature, PrivateKey } = kaspa;
  const { sender, recipient } = loadKeys();
  const ask = loadAsks()[name];
  if (!ask) throw new Error(`unknown ask '${name}' — run 02-lock first`);

  const rpc = await connect();
  try {
    const utxos = await findP2shUtxos(rpc, ask.p2shAddress);
    if (!utxos.length) throw new Error("no UTXO at the covenant address (already spent?)");
    const utxo = utxos[0];
    console.log("spending covenant UTXO:", utxo.outpoint.transactionId, "amount:", utxo.amount);

    const payloadHex = noPayload
      ? undefined
      : Buffer.from(ASK_PREFIX + reply, "utf8").toString("hex");
    const recipientAddress = recipient.toAddress(NETWORK_ID).toString();
    const outAmount = BigInt(utxo.amount) - FEE_ALLOWANCE;
    const tx = createTransaction(
      [utxo],
      [{ address: recipientAddress, amount: outAmount }],
      0n,
      payloadHex,
      1
    );

    const signingKey = new PrivateKey(wrongKey ? sender.privateKey : recipient.privateKey);
    const sig = createInputSignature(tx, 0, signingKey);
    tx.inputs[0].signatureScript = buildSpendSignatureScript(ask.redeemScript, sig, true);

    const { transactionId } = await rpc.submitTransaction({ transaction: tx });
    if (wrongKey || noPayload) {
      console.log("UNEXPECTED: attack claim ACCEPTED:", transactionId);
      process.exit(1);
    }
    console.log("claim txid:", transactionId);
    const asks = loadAsks();
    asks[name].claimTxid = transactionId;
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
  const { isChainRejection } = require("./lib.cjs");
  if ((wrongKey || noPayload) && isChainRejection(e)) {
    const which = wrongKey ? "wrong-key claim" : "no-payload claim";
    console.log(`EXPECTED CHAIN REJECTION (${which}):`, e.message || e);
  } else {
    console.error("FAILED (not a chain rejection):", e);
    process.exit(1);
  }
});
