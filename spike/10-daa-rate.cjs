// Spike 10: measure the REAL DAA rate (finding F20).
//
// src/lib/config.ts pins DAA_PER_SECOND = 10n, measured on TN10 and baked
// into every deadline: deadlineDaa = currentDaa + seconds * 10. Once
// written into the redeem script that deadline is immutable, so a wrong
// rate silently rescales every Ask's deadline — and the countdown lies for
// the whole period. The constant has never been checked against mainnet.
//
// This measures the observed rate over a sampling window and reports the
// error against the pinned constant. It does NOT spend TKAS.
//
// Usage: node spike/10-daa-rate.cjs [windowSeconds]
const { connect, NETWORK_ID } = require("./lib.cjs");

const WINDOW_S = Number(process.argv[2] || 90);
const PINNED = 10; // config.ts DAA_PER_SECOND

(async () => {
  const rpc = await connect();
  try {
    console.log(`=== Spike 10: DAA rate on ${NETWORK_ID} ===`);
    console.log(`sampling ${WINDOW_S}s (pinned constant: ${PINNED} DAA/s)\n`);

    const t0 = Date.now();
    const d0 = BigInt((await rpc.getBlockDagInfo()).virtualDaaScore);
    const samples = [];
    let last = { t: t0, d: d0 };

    while ((Date.now() - t0) / 1000 < WINDOW_S) {
      await new Promise((r) => setTimeout(r, 15000));
      const t = Date.now();
      const d = BigInt((await rpc.getBlockDagInfo()).virtualDaaScore);
      const dt = (t - last.t) / 1000;
      const rate = Number(d - last.d) / dt;
      samples.push(rate);
      console.log(
        `  +${((t - t0) / 1000).toFixed(0).padStart(3)}s  DAA ${d}  interval rate ${rate.toFixed(3)} /s`
      );
      last = { t, d };
    }

    const totalS = (Date.now() - t0) / 1000;
    const totalDaa = Number(last.d - d0);
    const overall = totalDaa / totalS;
    const errPct = ((overall - PINNED) / PINNED) * 100;

    console.log("\n--- result ---");
    console.log(`  window        : ${totalS.toFixed(1)}s, ${totalDaa} DAA`);
    console.log(`  measured rate : ${overall.toFixed(4)} DAA/s`);
    console.log(`  pinned        : ${PINNED} DAA/s`);
    console.log(`  error         : ${errPct >= 0 ? "+" : ""}${errPct.toFixed(2)}%`);

    // What the error means for a real deadline the user picked.
    for (const [label, secs] of [["7 days", 604800], ["24 hours", 86400]]) {
      const intendedDaa = secs * PINNED;
      const realSeconds = intendedDaa / overall;
      const driftMin = (realSeconds - secs) / 60;
      console.log(
        `  a "${label}" deadline actually lasts ${(realSeconds / 3600).toFixed(2)}h ` +
          `(${driftMin >= 0 ? "+" : ""}${driftMin.toFixed(1)} min vs intended)`
      );
    }

    const withinTolerance = Math.abs(errPct) <= 5;
    console.log(
      `\nVERDICT: ${withinTolerance ? "PINNED CONSTANT OK on this network (within 5%)" : "PINNED CONSTANT IS OFF — deadlines are rescaled; measure at compose time (F20 fix)"}`
    );
    console.log(
      "NOTE: this is testnet-10 only. The mainnet rate remains UNMEASURED and" +
        "\n      must be checked before any mainnet validation (F20)."
    );
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("PROBE FAILED (inconclusive, not a verdict):", e);
  process.exit(1);
});
