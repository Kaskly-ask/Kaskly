// Independent re-verification of the refund fee-allowance claim (R2: one source never grades itself).
// Uses createTransaction exactly as src/lib/ask/transactions.ts:196-213 does.
const kaspa = require("C:/ask-protocol/vendor/kaspa-wasm32-sdk/nodejs/kaspa");

const ALLOWANCE = 500_000n; // REFUND_FEE_ALLOWANCE, protocol.ts:46
const SENDER = "kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6";

const wanted = ["OpTxInputCount", "OpTxInputAmount", "OpTxInputIndex", "OpTxOutputCount", "OpTxOutputAmount"];
console.log("--- opcode availability in the pinned SDK (fix feasibility) ---");
for (const w of wanted) {
  console.log(`  ${w}: ${kaspa.Opcodes[w] !== undefined ? "present (" + kaspa.Opcodes[w] + ")" : "ABSENT"}`);
}

function covUtxo(amountSompi) {
  return {
    address: SENDER,
    outpoint: { transactionId: "aa".repeat(32), index: 0 },
    amount: amountSompi,
    scriptPublicKey: kaspa.payToAddressScript(SENDER),
    blockDaaScore: 1n,
    isCoinbase: false,
  };
}

function refund(amountSompi, networkId) {
  const minRefund = amountSompi - ALLOWANCE;
  const tx = kaspa.createTransaction([covUtxo(amountSompi)], [{ address: SENDER, amount: minRefund }], 0n, undefined, 0);
  tx.lockTime = 100000n;
  tx.inputs[0].sequence = 0n;
  tx.inputs[0].signatureScript = "00".repeat(117);
  let mass, fee;
  try { mass = kaspa.calculateTransactionMass(networkId, tx); } catch (e) { mass = "err: " + e.message; }
  try { fee = kaspa.calculateTransactionFee(networkId, tx); } catch (e) { fee = "throws"; }
  return { minRefund, mass, fee };
}

for (const net of ["testnet-10", "mainnet"]) {
  console.log(`\n--- ${net}: is the fixed 500,000-sompi allowance always sufficient? ---`);
  console.log("  amount(sompi)        mass       minFee   verdict");
  for (const amt of [600_000n, 1_000_000n, 2_500_000n, 5_000_000n, 10_000_000n, 10_500_000n, 20_000_000n, 100_000_000n, 1_000_000_000n]) {
    const r = refund(amt, net);
    let verdict;
    if (typeof r.fee !== "bigint") verdict = "NO FEE EXISTS -> funds unspendable";
    else if (r.fee > ALLOWANCE) verdict = "fee > allowance -> refund IMPOSSIBLE";
    else verdict = "ok";
    console.log(`  ${String(amt).padStart(13)} ${String(r.mass).padStart(11)} ${String(r.fee).padStart(12)}   ${verdict}`);
  }
}

// What the client actually refuses today (node.ts:110): amount <= 500_000 only.
console.log("\n--- current guard vs reality ---");
console.log("  node.ts:110 rejects only amount <= 500,000 sompi (0.005 KAS).");
console.log("  Any amount above that but below the true floor is accepted and can be locked.");
