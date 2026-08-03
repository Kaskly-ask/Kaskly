// Shared helpers for the Phase 1 spike scripts. Throwaway quality.
const fs = require("fs");
const path = require("path");

// Node >= 22 provides a W3C-compatible global WebSocket (verified in
// 00-connect.cjs output); the SDK README's `websocket` shim is only needed
// on older Node versions.
const kaspa = require("kaspa-wasm");

const NETWORK_ID = process.env.KASPA_NETWORK_ID || "testnet-10";
const KEYS_FILE = path.join(__dirname, ".keys.json");

async function connect() {
  const { RpcClient, Resolver, Encoding } = kaspa;
  const url = process.env.KASPA_WRPC_URL || "";
  const rpc = url
    ? new RpcClient({ url, encoding: Encoding.Borsh, networkId: NETWORK_ID })
    : new RpcClient({
        resolver: new Resolver(),
        encoding: Encoding.Borsh,
        networkId: NETWORK_ID,
      });
  await rpc.connect({
    strategy: kaspa.ConnectStrategy.Fallback,
    timeoutDuration: 30000,
  });
  return rpc;
}

function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) {
    throw new Error("spike/.keys.json missing — run: node spike/01-keys.cjs");
  }
  const raw = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  const { PrivateKey, Keypair } = kaspa;
  const sender = Keypair.fromPrivateKey(new PrivateKey(raw.senderPrivateKey));
  const recipient = Keypair.fromPrivateKey(
    new PrivateKey(raw.recipientPrivateKey)
  );
  return { sender, recipient };
}

// Candidate ASK namespace prefix (final name is human decision Q3).
const ASK_PREFIX = "ciph_msg:1:ask:";
// Fee allowance for claim/refund txs, in sompi (generous; TN10 min fee rate
// is 100 sompi/gram post-Toccata).
const FEE_ALLOWANCE = 500000n;
const ASKS_FILE = path.join(__dirname, ".asks.json");

// The two-path ASK covenant, from VERIFIED v2.0.1 opcode semantics
// (rusty-kaspa crypto/txscript/src/opcodes/mod.rs, tag v2.0.1):
//  - OpTxPayloadSubstr pops [start, end], pushes payload[start..end]
//  - OpCheckLockTimeVerify POPS its arg (unlike Bitcoin — no OpDrop after),
//    requires stack value <= tx.lockTime, same threshold class, and input
//    sequence != MAX
// Claim branch (selector TRUE):  payload starts with ASK_PREFIX + sig by R
// Refund branch (selector FALSE): CLTV(deadline) + sig by S
function buildAskRedeemScript({ recipientXOnlyHex, senderXOnlyHex, deadline }) {
  const { ScriptBuilder, Opcodes } = kaspa;
  const prefixBytes = Buffer.from(ASK_PREFIX, "utf8");
  if (!/^[0-9a-f]{64}$/i.test(recipientXOnlyHex) || !/^[0-9a-f]{64}$/i.test(senderXOnlyHex)) {
    throw new Error("x-only pubkeys must be 32-byte hex");
  }
  return new ScriptBuilder()
    .addOp(Opcodes.OpIf)
    .addI64(0n)
    .addI64(BigInt(prefixBytes.length))
    .addOp(Opcodes.OpTxPayloadSubstr)
    .addData(prefixBytes)
    .addOp(Opcodes.OpEqualVerify)
    .addData(Buffer.from(recipientXOnlyHex, "hex"))
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpElse)
    .addLockTime(deadline)
    .addOp(Opcodes.OpCheckLockTimeVerify)
    .addData(Buffer.from(senderXOnlyHex, "hex"))
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpEndIf);
}

function xOnlyHex(keypair) {
  const { PublicKey } = kaspa;
  const hex = new PublicKey(keypair.publicKey).toXOnlyPublicKey().toString();
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(`unexpected x-only pubkey format: ${hex}`);
  }
  return hex;
}

// Signature script for spending the P2SH: push sig, push branch selector,
// push redeem script (last push is the redeem script per Kaspa P2SH rules).
function buildSpendSignatureScript(redeemScript, signatureHex, claimBranch) {
  const { ScriptBuilder } = kaspa;
  const b = new ScriptBuilder()
    .addData(Buffer.from(signatureHex, "hex"))
    .addData(claimBranch ? Buffer.from([1]) : Buffer.from([]))
    .addData(Buffer.from(redeemScript.drain ? redeemScript.drain() : redeemScript, "hex"));
  return b.drain();
}

function loadAsks() {
  return fs.existsSync(ASKS_FILE)
    ? JSON.parse(fs.readFileSync(ASKS_FILE, "utf8"))
    : {};
}

function saveAsks(asks) {
  fs.writeFileSync(ASKS_FILE, JSON.stringify(asks, null, 2));
}

async function findP2shUtxos(rpc, p2shAddress) {
  const { entries } = await rpc.getUtxosByAddresses({ addresses: [p2shAddress] });
  return entries;
}

module.exports = {
  kaspa,
  NETWORK_ID,
  KEYS_FILE,
  ASK_PREFIX,
  FEE_ALLOWANCE,
  connect,
  loadKeys,
  buildAskRedeemScript,
  buildSpendSignatureScript,
  xOnlyHex,
  loadAsks,
  saveAsks,
  findP2shUtxos,
};
