// F28 — the import check must be able to FAIL.
//
// The removed "ownership proof" signed with a key and verified against
// that same key's pubkey, so it passed for every key that parsed (PoC:
// 500/500) while the UI rendered "✓ key ownership verified by signature".
// No test asserted it, which is how a check that could not fail survived
// being marked `verified` in TRACE.
//
// These tests exist so the replacement cannot rot the same way: the
// negative case is asserted FIRST, and a check that stopped rejecting
// would fail the suite.
import { describe, it, expect } from "vitest";
import { Keypair } from "kaspa-wasm";
import { addressesMatch } from "../../src/lib/wallet";

const NETWORK_ID = "testnet-10";

describe("F28 — address confirmation on import", () => {
  it("REJECTS a valid key that opens a different address", () => {
    // The realistic import error: a mistyped key is still a VALID key. It
    // does not error — it silently opens someone else's wallet. Only an
    // externally-supplied address catches it.
    const typed = Keypair.random();
    const intended = Keypair.random();
    const typedAddr = typed.toAddress(NETWORK_ID).toString();
    const intendedAddr = intended.toAddress(NETWORK_ID).toString();

    expect(typedAddr).not.toBe(intendedAddr);
    expect(addressesMatch(typedAddr, intendedAddr)).toBe(false);
  });

  it("accepts the key that opens the expected address", () => {
    const kp = Keypair.random();
    const addr = kp.toAddress(NETWORK_ID).toString();
    expect(addressesMatch(addr, addr)).toBe(true);
  });

  it("tolerates the ways users actually paste an address", () => {
    const addr = Keypair.random().toAddress(NETWORK_ID).toString();
    expect(addressesMatch(addr, `  ${addr}  `)).toBe(true);
    expect(addressesMatch(addr, addr.toUpperCase())).toBe(true);
    expect(addressesMatch(addr, `${addr}\n`)).toBe(true);
  });

  it("does not match a truncated or altered address", () => {
    const addr = Keypair.random().toAddress(NETWORK_ID).toString();
    expect(addressesMatch(addr, addr.slice(0, -1))).toBe(false);
    expect(addressesMatch(addr, addr.slice(0, -1) + "x")).toBe(false);
    expect(addressesMatch(addr, "")).toBe(false);
  });

  it("the self-verifying ceremony is gone from the CODE", async () => {
    // Asserts on the mechanism, not on prose: the file still DISCUSSES
    // proofOk in the comment explaining why it was removed, and that
    // explanation is worth keeping. What must not come back is the
    // sign-then-verify-against-your-own-key call pair.
    const raw = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/wallet.tsx", "utf8")
    );
    // Strip block and line comments so the assertion sees CODE only. The
    // comment deliberately quotes the removed `if (!proofOk) throw`, and
    // that explanation should survive.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code, "verifyMessage must not be called in wallet.tsx").not.toMatch(
      /verifyMessage\s*\(/
    );
    expect(code, "signMessage must not be called in wallet.tsx").not.toMatch(
      /signMessage\s*\(/
    );
    expect(code, "no proofOk property should be set or read").not.toMatch(
      /proofOk/
    );
  });
});
