// Spike 01: generate persistent TESTNET keypairs for sender (S) and
// recipient (R). Idempotent: keeps existing keys if the file exists.
const fs = require("fs");
const { kaspa, NETWORK_ID, KEYS_FILE } = require("./lib.cjs");

const { Keypair } = kaspa;

let raw;
if (fs.existsSync(KEYS_FILE)) {
  raw = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  console.log("using existing spike/.keys.json");
} else {
  const s = Keypair.random();
  const r = Keypair.random();
  raw = { senderPrivateKey: s.privateKey, recipientPrivateKey: r.privateKey };
  fs.writeFileSync(KEYS_FILE, JSON.stringify(raw, null, 2));
  console.log("generated new spike/.keys.json (TESTNET ONLY, gitignored)");
}

const { PrivateKey } = kaspa;
const sender = Keypair.fromPrivateKey(new PrivateKey(raw.senderPrivateKey));
const recipient = Keypair.fromPrivateKey(
  new PrivateKey(raw.recipientPrivateKey)
);

console.log("network:", NETWORK_ID);
console.log("SENDER   (fund this one):", sender.toAddress(NETWORK_ID).toString());
console.log("RECIPIENT (no funds needed yet):", recipient.toAddress(NETWORK_ID).toString());
