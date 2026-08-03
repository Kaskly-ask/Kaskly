// Spike 00: prove wRPC connectivity to the covenant testnet and record what
// the node reports. Read-only; no funds involved.
const { connect, NETWORK_ID } = require("./lib.cjs");

(async () => {
  console.log("global WebSocket available:", typeof WebSocket !== "undefined");
  console.log("target network:", NETWORK_ID);
  const rpc = await connect();
  try {
    console.log("connected to:", rpc.url);
    const info = await rpc.getServerInfo();
    console.log("serverVersion:", info.serverVersion);
    console.log("networkId:", info.networkId);
    console.log("isSynced:", info.isSynced);
    console.log("hasUtxoIndex:", info.hasUtxoIndex);
    console.log("virtualDaaScore:", info.virtualDaaScore);
    const dag = await rpc.getBlockDagInfo();
    console.log("virtualDaaScore (dag):", dag.virtualDaaScore);
  } finally {
    await rpc.disconnect();
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
