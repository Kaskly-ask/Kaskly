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
  const pinned = process.env.KASPA_WRPC_URL || "";
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    // Try the pinned URL first (if any), then fall back to resolver picks.
    const usePinned = pinned && attempt === 0;
    const rpc = usePinned
      ? new RpcClient({ url: pinned, encoding: Encoding.Borsh, networkId: NETWORK_ID })
      : new RpcClient({
          resolver: new Resolver(),
          encoding: Encoding.Borsh,
          networkId: NETWORK_ID,
        });
    try {
      await rpc.connect({
        strategy: kaspa.ConnectStrategy.Fallback,
        timeoutDuration: 15000,
      });
      const info = await rpc.getServerInfo();
      if (!info.isSynced || !info.hasUtxoIndex) {
        throw new Error(`node unusable (synced=${info.isSynced}, utxoindex=${info.hasUtxoIndex})`);
      }
      return rpc;
    } catch (e) {
      lastErr = e;
      try { await rpc.disconnect(); } catch {}
      console.error(`connect attempt ${attempt + 1} failed: ${e.message || e}`);
    }
  }
  throw lastErr;
}

// True only for a real node-side transaction rejection — connection
// failures and local errors must NOT be mistaken for chain rejections (R6).
function isChainRejection(e) {
  const msg = String((e && e.message) || e);
  return msg.includes("Rejected transaction") || msg.includes("RPC Server (remote error)");
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

// Serialize a ScriptPublicKey the way OpTxOutputSpk pushes it on the stack:
// 2-byte BIG-ENDIAN version || script bytes. VERIFIED from rusty-kaspa
// v2.0.1 crypto/txscript/src/lib.rs (SpkEncoding::to_bytes:
// `self.version.to_be_bytes() ... chain(self.script())`).
function spkToStackBytes(spk) {
  const version = typeof spk.version === "number" ? spk.version : 0;
  const scriptHex = typeof spk.script === "string" ? spk.script : Buffer.from(spk.script).toString("hex");
  const out = Buffer.alloc(2 + scriptHex.length / 2);
  out.writeUInt16BE(version, 0);
  Buffer.from(scriptHex, "hex").copy(out, 2);
  return out;
}

// V2 covenant: claim branch unchanged; refund branch requires NO signature —
// instead the covenant pins the refund shape via introspection (Phase 2
// design goal from the Phase 1 gate): exactly one output, paying >= minRefund
// to the sender's SPK. Anyone can trigger it after the deadline; funds can
// only go to the sender.
function buildAskRedeemScriptV2({ recipientXOnlyHex, senderSpkBytes, deadline, minRefund }) {
  const { ScriptBuilder, Opcodes } = kaspa;
  const prefixBytes = Buffer.from(ASK_PREFIX, "utf8");
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
    .addOp(Opcodes.OpTxOutputCount)
    .addI64(1n)
    .addOp(Opcodes.OpNumEqualVerify)
    .addI64(0n)
    .addOp(Opcodes.OpTxOutputSpk)
    .addData(senderSpkBytes)
    .addOp(Opcodes.OpEqualVerify)
    .addI64(0n)
    .addOp(Opcodes.OpTxOutputAmount)
    .addI64(minRefund)
    .addOp(Opcodes.OpGreaterThanOrEqual)
    .addOp(Opcodes.OpEndIf);
}

// ---------------------------------------------------------------------
// V3 covenant (COVENANT-V3-DESIGN.md). The AUTHORITATIVE definition is
// src/lib/ask/covenant-v3.ts. This CJS builder exists only because spikes
// cannot import TypeScript — and it is NOT trusted: assertV3VectorMatch()
// below byte-compares it against the golden vector generated FROM the
// TypeScript source before any probe runs. If they ever differ, probes
// abort loudly rather than silently attacking a mirror.
const V3_VECTOR_FILE = path.join(__dirname, "v3-golden-vector.json");
const ASK_V3_REPLY_HEADER = "ciph_msg:1:ask:r2:";
const ASK_V3_HEADER_BYTES = Buffer.from(ASK_V3_REPLY_HEADER, "utf8");
const ASK_ID_OFFSET = ASK_V3_HEADER_BYTES.length; // 18
const ASK_ID_END = ASK_ID_OFFSET + 32; // 50
const MIN_CLAIM_PAYLOAD_LEN = ASK_ID_END;

function buildAskRedeemScriptV3({
  recipientXOnlyHex,
  senderAddress,
  deadlineDaa,
  askIdHex,
  refundAllowance,
}) {
  const { ScriptBuilder, Opcodes, payToAddressScript } = kaspa;
  const senderSpkBytes = spkToStackBytes(payToAddressScript(senderAddress));
  return new ScriptBuilder()
    .addOp(Opcodes.OpIf)
    // Claim branch pins ONE input (2026-08-04): a V3 payload also satisfies
    // V2's 15-byte prefix check, so a mixed V2+V3 input set could be
    // claimed with one payload. Mirrors src/lib/ask/covenant-v3.ts.
    .addOp(Opcodes.OpTxInputCount)
    .addI64(1n)
    .addOp(Opcodes.OpNumEqualVerify)
    .addOp(Opcodes.OpTxPayloadLen)
    .addI64(BigInt(MIN_CLAIM_PAYLOAD_LEN))
    .addOp(Opcodes.OpGreaterThanOrEqual)
    .addOp(Opcodes.OpVerify)
    .addI64(0n)
    .addI64(BigInt(ASK_ID_OFFSET))
    .addOp(Opcodes.OpTxPayloadSubstr)
    .addData(ASK_V3_HEADER_BYTES)
    .addOp(Opcodes.OpEqualVerify)
    .addI64(BigInt(ASK_ID_OFFSET))
    .addI64(BigInt(ASK_ID_END))
    .addOp(Opcodes.OpTxPayloadSubstr)
    .addData(Buffer.from(askIdHex, "hex"))
    .addOp(Opcodes.OpEqualVerify)
    .addData(Buffer.from(recipientXOnlyHex, "hex"))
    .addOp(Opcodes.OpCheckSig)
    .addOp(Opcodes.OpElse)
    .addOp(Opcodes.OpTxInputCount)
    .addI64(1n)
    .addOp(Opcodes.OpNumEqualVerify)
    .addLockTime(deadlineDaa)
    .addOp(Opcodes.OpCheckLockTimeVerify)
    .addOp(Opcodes.OpTxOutputCount)
    .addI64(1n)
    .addOp(Opcodes.OpNumEqualVerify)
    .addI64(0n)
    .addOp(Opcodes.OpTxOutputSpk)
    .addData(senderSpkBytes)
    .addOp(Opcodes.OpEqualVerify)
    .addI64(0n)
    .addOp(Opcodes.OpTxOutputAmount)
    .addOp(Opcodes.OpTxInputIndex)
    .addOp(Opcodes.OpTxInputAmount)
    .addI64(refundAllowance)
    .addOp(Opcodes.OpSub)
    .addOp(Opcodes.OpGreaterThanOrEqual)
    .addOp(Opcodes.OpEndIf);
}

/** HARD GATE for every V3 probe. Rebuilds the canonical covenant with this
 * CJS builder and byte-compares script AND address against the vector
 * generated from src/lib/ask/covenant-v3.ts. Throws on any difference so a
 * probe can never attack a diverged mirror. Returns the vector. */
function assertV3VectorMatch({ quiet } = {}) {
  if (!fs.existsSync(V3_VECTOR_FILE)) {
    throw new Error(
      "spike/v3-golden-vector.json missing — run `npm test` to regenerate it from the TypeScript source"
    );
  }
  const vector = JSON.parse(fs.readFileSync(V3_VECTOR_FILE, "utf8"));
  const p = vector.params;
  const { addressFromScriptPublicKey } = kaspa;
  const redeem = buildAskRedeemScriptV3({
    recipientXOnlyHex: p.recipientXOnlyHex,
    senderAddress: p.senderAddress,
    deadlineDaa: BigInt(p.deadlineDaa),
    askIdHex: p.askIdHex,
    refundAllowance: BigInt(p.refundAllowance),
  });
  const scriptHex = redeem.toString();
  const p2sh = addressFromScriptPublicKey(
    redeem.createPayToScriptHashScript(),
    p.networkId
  ).toString();

  if (scriptHex !== vector.redeemScriptHex || p2sh !== vector.p2shAddress) {
    throw new Error(
      "V3 VECTOR MISMATCH — the spike builder and src/lib/ask/covenant-v3.ts have DIVERGED.\n" +
        `  vector script : ${vector.redeemScriptHex}\n` +
        `  spike  script : ${scriptHex}\n` +
        `  vector p2sh   : ${vector.p2shAddress}\n` +
        `  spike  p2sh   : ${p2sh}\n` +
        "Refusing to run: a probe against a diverged mirror proves nothing."
    );
  }
  if (
    vector.layout.header !== ASK_V3_REPLY_HEADER ||
    vector.layout.askIdOffset !== ASK_ID_OFFSET ||
    vector.layout.askIdEnd !== ASK_ID_END
  ) {
    throw new Error("V3 VECTOR MISMATCH — payload layout constants differ");
  }
  if (!quiet) {
    console.log("V3 vector check: MATCH (spike builder === covenant-v3.ts)");
    console.log(`  script hex : ${scriptHex}`);
    console.log(`  p2sh       : ${p2sh}`);
  }
  return vector;
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
// NOTE (verified empirically): createInputSignature returns a PUSH-ENCODED
// signature-script fragment (e.g. 0x41 + 65 bytes of sig||hashtype), not a
// raw signature — strip the push prefix before re-pushing via addData.
function buildSpendSignatureScript(redeemScript, signatureHex, claimBranch) {
  const { ScriptBuilder } = kaspa;
  const sigBytes = Buffer.from(signatureHex, "hex");
  let rawSig = sigBytes;
  if (sigBytes.length >= 2 && sigBytes[0] === sigBytes.length - 1 && sigBytes[0] <= 75) {
    rawSig = sigBytes.subarray(1); // strip canonical small-data push prefix
  }
  const b = new ScriptBuilder()
    .addData(rawSig)
    .addData(claimBranch ? Buffer.from([1]) : Buffer.from([]))
    .addData(Buffer.from(redeemScript.drain ? redeemScript.drain() : redeemScript, "hex"));
  return b.drain();
}

// ---------------------------------------------------------------------
// Mass-derived fee solving (F13/F21). SHARED so the fee/mass bug that
// voided spike 11's attempt 1 cannot live in two places.
//
// The required fee depends on the output value (KIP-9 storage mass scales
// INVERSELY with it), and the output value depends on the fee — so this is
// a fixed point, not a formula. HARD RULE (V3 design, human-approved):
// non-convergence MUST refuse the amount. Never fall back to the last
// iterate: that produces an unbroadcastable transaction and strands funds.
//
// PARITY REQUIREMENT: the V3 client implements the same algorithm in
// TypeScript. It cannot literally import this CJS helper, so the two MUST
// be kept in step by a shared golden-vector test (amount -> solved fee)
// asserted on both sides. Recorded in COVENANT-V3-DESIGN.md.
const FEE_SOLVE_MAX_ITERS = 12;

/** Solve the fee for a single-input spend paying (inputAmount - fee) to
 * one destination. `buildTx(fee)` must return a fully-formed Transaction
 * (signature script included) for the given fee.
 * Returns { fee } or throws — throwing IS the refusal. */
function solveSpendFee({ networkId, inputAmount, buildTx }) {
  let guess = 100000n;
  const trace = [];
  for (let i = 0; i < FEE_SOLVE_MAX_ITERS; i++) {
    if (guess >= inputAmount) {
      throw new Error(`fee solve refused: fee ${guess} >= input ${inputAmount} (amount too small)`);
    }
    const tx = buildTx(guess);
    const required = kaspa.calculateTransactionFee(networkId, tx);
    trace.push(`${guess}->${required === undefined ? "none" : required}`);
    if (required === undefined) {
      throw new Error(`fee solve refused: no valid fee exists (mass over limit) [${trace.join(" ")}]`);
    }
    if (required <= guess) return { fee: guess, iters: i + 1, trace };
    guess = required;
  }
  throw new Error(
    `fee solve refused: no convergence in ${FEE_SOLVE_MAX_ITERS} iterations [${trace.join(" ")}]`
  );
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
  isChainRejection,
  loadKeys,
  buildAskRedeemScript,
  buildAskRedeemScriptV2,
  buildSpendSignatureScript,
  spkToStackBytes,
  xOnlyHex,
  loadAsks,
  saveAsks,
  findP2shUtxos,
  solveSpendFee,
  buildAskRedeemScriptV3,
  assertV3VectorMatch,
  ASK_V3_REPLY_HEADER,
  ASK_ID_OFFSET,
  ASK_ID_END,
  MIN_CLAIM_PAYLOAD_LEN,
};
