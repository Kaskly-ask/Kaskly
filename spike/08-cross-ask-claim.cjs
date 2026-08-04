// Spike 08: F22 — can ONE reply payload claim SEVERAL senders' Asks?
//
// Under V2 the claim branch checked only a 15-byte prefix, so one payload
// satisfied every covenant it was spent against. V3 (mechanism M1) binds
// each claim to a per-Ask random askId at payload[18:50], so two covenants
// with different askIds impose contradictory demands on the same bytes.
//
// THREE results, in the 07c discipline — the attack alone would be
// indistinguishable from "V3 rejects all claims":
//   (a) ATTACK  one payload claiming two DIFFERENT SENDERS' Asks  -> REJECT
//   (b) ATTACK  same-lock-tx variant: two Asks funded by ONE transaction,
//       so they share an outpoint txid — the case that would have broken
//       mechanism M2 — still different askIds                     -> REJECT
//   (c) CONTROL each Ask claimed on its own with its own askId    -> ACCEPT
// Without (c), (a) and (b) prove nothing.
//
// F22 is specifically about one recipient claiming MULTIPLE SENDERS' Asks,
// so (a) funds a genuinely separate second sender rather than reusing one
// wallet — a same-sender test would not exercise the real attack.
//
// Usage: node spike/08-cross-ask-claim.cjs         (TESTNET ONLY)
const {
  kaspa,
  NETWORK_ID,
  FEE_ALLOWANCE,
  connect,
  isChainRejection,
  loadKeys,
  buildAskRedeemScriptV3,
  assertV3VectorMatch,
  buildSpendSignatureScript,
  xOnlyHex,
  loadAsks,
  saveAsks,
  findP2shUtxos,
  ASK_V3_REPLY_HEADER,
} = require("./lib.cjs");

const {
  addressFromScriptPublicKey,
  createTransaction,
  createTransactions,
  createInputSignature,
  calculateTransactionFee,
  kaspaToSompi,
  sompiToKaspaString,
  Keypair,
  PrivateKey,
} = kaspa;

const ASK_AMOUNT = kaspaToSompi("1");
const SENDER2_FUNDING = kaspaToSompi("2");
// Far enough out that claims never race a refund (the probe runs in ~2
// min), close enough that funds left behind by an aborted run become
// refundable in ~30 minutes rather than hours.
const DEADLINE_OFFSET = 18000n; // ~30 min at 10 DAA/s

/** V3 claim payload: header ‖ 32-byte askId ‖ JSON-ish remainder. Only the
 * first 50 bytes are chain-enforced; the rest is client-validated. */
function claimPayloadHex(askIdHex) {
  return Buffer.concat([
    Buffer.from(ASK_V3_REPLY_HEADER, "utf8"),
    Buffer.from(askIdHex, "hex"),
    Buffer.from('{"v":2,"msgEnc":"kasia1","message":"0011223344556677"}', "utf8"),
  ]).toString("hex");
}

/** Build a claim spending `utxos` (each with its own redeem script), paying
 * the recipient, carrying ONE payload. Signs every input with the
 * recipient key. Iterates to a mass-derived fee. */
function buildClaim({ utxos, redeemHexes, recipientAddress, recipientPrivHex, payloadHex }) {
  const total = utxos.reduce((a, u) => a + BigInt(u.amount), 0n);
  let fee = 150000n;
  let tx = null;
  for (let i = 0; i < 10; i++) {
    tx = createTransaction(
      utxos,
      [{ address: recipientAddress, amount: total - fee }],
      0n,
      payloadHex,
      1
    );
    utxos.forEach((_, idx) => {
      const sig = createInputSignature(tx, idx, new PrivateKey(recipientPrivHex));
      tx.inputs[idx].signatureScript = buildSpendSignatureScript(
        redeemHexes[idx],
        sig,
        true // claim branch selector
      );
    });
    const required = calculateTransactionFee(NETWORK_ID, tx);
    if (required === undefined) throw new Error("no valid fee (mass over limit)");
    if (required <= fee) return tx;
    fee = required;
  }
  throw new Error("claim fee did not converge");
}

(async () => {
  const { sender, recipient } = loadKeys();
  const sender1Address = sender.toAddress(NETWORK_ID).toString();
  const recipientAddress = recipient.toAddress(NETWORK_ID).toString();
  const recipientXOnlyHex = xOnlyHex(recipient);
  const recipientPrivHex = recipient.privateKey.toString();

  console.log("=== Spike 08: F22 cross-Ask claim ===");
  assertV3VectorMatch();

  const rpc = await connect();
  const out = { network: NETWORK_ID, attacks: [], controls: [], verdict: null };
  try {
    const dag = await rpc.getBlockDagInfo();
    const deadline = BigInt(dag.virtualDaaScore) + DEADLINE_OFFSET;

    // --- a genuinely separate second sender --------------------------
    const asksFile = loadAsks();
    let sender2Priv = asksFile.f22sender2;
    if (!sender2Priv) {
      sender2Priv = Keypair.random().privateKey.toString();
      const a = loadAsks();
      a.f22sender2 = sender2Priv;
      saveAsks(a);
    }
    const sender2 = Keypair.fromPrivateKey(new PrivateKey(sender2Priv));
    const sender2Address = sender2.toAddress(NETWORK_ID).toString();
    console.log(`\nsender1: ${sender1Address}`);
    console.log(`sender2: ${sender2Address}  (separate wallet — F22 is about MULTIPLE SENDERS)`);

    const { entries: s2Existing } = await rpc.getUtxosByAddresses({ addresses: [sender2Address] });
    const s2Balance = s2Existing.reduce((a, u) => a + BigInt(u.amount), 0n);
    // Top up on BALANCE, not merely emptiness: a previous run may have left
    // sender2 with a non-zero amount that is still too small for an Ask.
    if (s2Balance < ASK_AMOUNT + 1000000n) {
      console.log(`\nfunding sender2 from sender1 (has ${sompiToKaspaString(s2Balance)} KAS)...`);
      const { entries } = await rpc.getUtxosByAddresses({ addresses: [sender1Address] });
      const { transactions } = await createTransactions({
        entries,
        outputs: [{ address: sender2Address, amount: SENDER2_FUNDING }],
        changeAddress: sender1Address,
        priorityFee: 0n,
        networkId: NETWORK_ID,
      });
      for (const p of transactions) {
        await p.sign([sender.privateKey]);
        console.log("  sender2 funded by", await p.submit(rpc));
      }
      for (let i = 0; i < 24; i++) {
        const { entries: e } = await rpc.getUtxosByAddresses({ addresses: [sender2Address] });
        const bal = e.reduce((a, u) => a + BigInt(u.amount), 0n);
        if (bal >= ASK_AMOUNT + 1000000n) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
    } else {
      console.log(`\nsender2 already funded (${sompiToKaspaString(s2Balance)} KAS)`);
    }

    // --- build four covenants ----------------------------------------
    const mk = (label, senderAddress, askIdHex) => {
      const redeem = buildAskRedeemScriptV3({
        recipientXOnlyHex,
        senderAddress,
        deadlineDaa: deadline,
        askIdHex,
        refundAllowance: FEE_ALLOWANCE,
      });
      return {
        label,
        senderAddress,
        askIdHex,
        redeemHex: redeem.toString(),
        p2shAddress: addressFromScriptPublicKey(
          redeem.createPayToScriptHashScript(),
          NETWORK_ID
        ).toString(),
      };
    };
    const A = mk("A(sender1)", sender1Address, "aa".repeat(32));
    const B = mk("B(sender2)", sender2Address, "bb".repeat(32));
    const C = mk("C(same-tx)", sender1Address, "cc".repeat(32));
    const D = mk("D(same-tx)", sender1Address, "dd".repeat(32));
    for (const c of [A, B, C, D]) console.log(`  ${c.label}: ${c.p2shAddress}`);

    // A from sender1; B from sender2; C+D in ONE tx from sender1.
    // Waits for spendable UTXOs before building: immediately after a prior
    // spend the wallet's confirmed set can be momentarily empty while the
    // change output settles, which surfaces as "Insufficient funds".
    async function fund(fromKeypair, fromAddress, outputs) {
      const need = outputs.reduce((a, o) => a + BigInt(o.amount), 0n) + 1000000n;
      let lastErr;
      for (let attempt = 0; attempt < 12; attempt++) {
        const { entries } = await rpc.getUtxosByAddresses({ addresses: [fromAddress] });
        const have = entries.reduce((a, u) => a + BigInt(u.amount), 0n);
        if (have >= need) {
          try {
            const { transactions } = await createTransactions({
              entries,
              outputs,
              changeAddress: fromAddress,
              priorityFee: 0n,
              networkId: NETWORK_ID,
            });
            let txid;
            for (const p of transactions) {
              await p.sign([fromKeypair.privateKey]);
              txid = await p.submit(rpc);
            }
            return txid;
          } catch (e) {
            lastErr = e;
            // Stale selection (outpoint already spent in mempool) — back off.
            console.log(`    funding retry ${attempt + 1}: ${String(e.message || e).slice(0, 90)}`);
          }
        } else {
          console.log(
            `    waiting for funds on ${fromAddress.slice(0, 22)}… have ${sompiToKaspaString(have)}, need ${sompiToKaspaString(need)}`
          );
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
      throw lastErr || new Error(`funding never became possible for ${fromAddress}`);
    }

    // Sender1's three covenants go in ONE transaction: two sequential
    // fundings from the same wallet race on UTXO selection (the F11 class
    // of bug — the second tx picks an outpoint the first already spent in
    // the mempool). C and D sharing this tx is exactly what variant (b)
    // needs; A sharing it too is harmless, since (a) pairs A with B, whose
    // funding comes from a different wallet entirely.
    console.log("\nfunding covenants...");
    const txACD = await fund(sender, sender1Address, [
      { address: A.p2shAddress, amount: ASK_AMOUNT },
      { address: C.p2shAddress, amount: ASK_AMOUNT },
      { address: D.p2shAddress, amount: ASK_AMOUNT },
    ]);
    const txB = await fund(sender2, sender2Address, [{ address: B.p2shAddress, amount: ASK_AMOUNT }]);
    console.log(`  A+C+D (ONE tx from sender1 — C,D share an outpoint txid): ${txACD}`);
    console.log(`  B     (separate tx from sender2): ${txB}`);
    out.funding = { ACD: txACD, B: txB };

    for (const c of [A, B, C, D]) {
      for (let i = 0; i < 24 && !c.utxo; i++) {
        const u = await findP2shUtxos(rpc, c.p2shAddress);
        if (u.length) c.utxo = u[0];
        else await new Promise((r) => setTimeout(r, 5000));
      }
      if (!c.utxo) throw new Error(`covenant ${c.label} UTXO never appeared`);
    }

    async function trySubmit(tx, label) {
      try {
        const { transactionId } = await rpc.submitTransaction({ transaction: tx });
        console.log(`  ${label.padEnd(46)} ACCEPTED ${transactionId}`);
        return { label, outcome: "ACCEPTED", txid: transactionId };
      } catch (e) {
        const chain = isChainRejection(e);
        console.log(`  ${label.padEnd(46)} ${chain ? "rejected" : "INCONCLUSIVE"}`);
        return { label, outcome: chain ? "rejected" : "INCONCLUSIVE", reason: String(e.message || e) };
      }
    }

    // --- (a) ATTACK: two senders, one payload -------------------------
    console.log("\n--- (a) ATTACK: one payload claiming TWO SENDERS' Asks ---");
    out.attacks.push(
      await trySubmit(
        buildClaim({
          utxos: [A.utxo, B.utxo],
          redeemHexes: [A.redeemHex, B.redeemHex],
          recipientAddress,
          recipientPrivHex,
          payloadHex: claimPayloadHex(A.askIdHex),
        }),
        "A+B with A's askId (must reject)"
      )
    );

    // --- (b) ATTACK: same funding tx (shared outpoint txid) -----------
    console.log("\n--- (b) ATTACK: same-lock-tx variant (would have broken M2) ---");
    out.attacks.push(
      await trySubmit(
        buildClaim({
          utxos: [C.utxo, D.utxo],
          redeemHexes: [C.redeemHex, D.redeemHex],
          recipientAddress,
          recipientPrivHex,
          payloadHex: claimPayloadHex(C.askIdHex),
        }),
        "C+D with C's askId (must reject)"
      )
    );

    // --- (c) CONTROL: each claimed with its own askId -----------------
    console.log("\n--- (c) CONTROL: each Ask claimed on its own ---");
    for (const c of [A, B, C, D]) {
      out.controls.push(
        await trySubmit(
          buildClaim({
            utxos: [c.utxo],
            redeemHexes: [c.redeemHex],
            recipientAddress,
            recipientPrivHex,
            payloadHex: claimPayloadHex(c.askIdHex),
          }),
          `${c.label} with its own askId (must ACCEPT)`
        )
      );
    }

    // --- R2: recompute the accepted claims from the node --------------
    const accepted = out.controls.filter((r) => r.outcome === "ACCEPTED");
    if (accepted.length) {
      console.log("\nR2: recomputing from the node's UTXO set (fresh connection)...");
      const rpc2 = await connect();
      try {
        const { entries } = await rpc2.getUtxosByAddresses({ addresses: [recipientAddress] });
        for (const r of accepted) {
          const hit = entries.filter(
            (u) => String(u.outpoint.transactionId).toLowerCase() === r.txid.toLowerCase()
          );
          r.r2 = hit.length
            ? { outputs: hit.length, paidSompi: hit.reduce((a, u) => a + BigInt(u.amount), 0n).toString() }
            : "not yet observed";
          console.log(
            `  ${r.label}: ${typeof r.r2 === "string" ? r.r2 : `${r.r2.outputs} output(s), ${sompiToKaspaString(BigInt(r.r2.paidSompi))} KAS to recipient`}`
          );
        }
      } finally {
        await rpc2.disconnect();
      }
    }

    const attacksRejected = out.attacks.every((a) => a.outcome === "rejected");
    const controlsAccepted = out.controls.length === 4 && out.controls.every((c) => c.outcome === "ACCEPTED");
    out.verdict = attacksRejected && controlsAccepted
      ? "F22 CLOSED ON V3 — one payload cannot claim two senders' Asks, nor two Asks sharing a lock txid; and every Ask still claims correctly with its own askId (control)."
      : `F22 NOT PROVEN — attacksRejected=${attacksRejected} controlsAccepted=${controlsAccepted}. ` +
        (!controlsAccepted
          ? "Controls failed: V3 may be rejecting legitimate claims, which would strand funds. Do NOT read the attack rejections as a fix."
          : "An attack was not rejected.");
    console.log("\n=== VERDICT ===\n" + out.verdict);

    const a2 = loadAsks();
    a2.f22probe = out;
    saveAsks(a2);
    console.log("\nrecorded to spike/.asks.json under 'f22probe'");
    if (!(attacksRejected && controlsAccepted)) process.exit(1);
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("PROBE FAILED (inconclusive, not a verdict):", e);
  process.exit(1);
});
