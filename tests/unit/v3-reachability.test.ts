// THE REACHABILITY ASSERTION (agent C, fourth internal pass).
//
// WHY THIS FILE EXISTS SEPARATELY FROM wiring-v3.test.ts:
// `wiring-v3.test.ts` calls itself a "wiring proof" and has never proven
// wiring. It imports `prepareAskV3` DIRECTLY and asserts the V3 modules are
// internally consistent — which they were, while the shipping client could
// not reach a single one of them. Its own case 5 ("V2's path is untouched")
// was the tell. Four Criticals were recorded as FIXED on the strength of it.
//
// This file asserts the ONE property that file cannot: that the V3 covenant
// is reachable from the app's PUBLIC SURFACE and is what `sendAsk` actually
// builds.
//
// PROCESS REQUIREMENT (human, binding): these assertions MUST FAIL before
// the wiring migration and PASS after. A test written after the fact that
// merely passes proves nothing about the change — the failing-first run is
// the proof. The failing run is recorded in PROGRESS.md.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

describe("V3 reachability — the app must actually reach the hardened covenant", () => {
  it("the public surface exports the V3 creation path", async () => {
    // The barrel is what `sendAsk` imports (`await import("./ask")`), so it
    // is the boundary that decides what the client can possibly build.
    const barrel = await import("../../src/lib/ask");
    const v3Exports = Object.keys(barrel).filter((k) => k.endsWith("V3"));
    expect(
      v3Exports.length,
      "src/lib/ask/index.ts exports no *V3 symbol — the hardened covenant is unreachable from the client"
    ).toBeGreaterThan(0);
    // The specific symbols the creation path needs.
    expect(barrel).toHaveProperty("createAskV3");
    expect(barrel).toHaveProperty("prepareAskV3");
    expect(barrel).toHaveProperty("deriveAskCovenantV3");
  });

  it("sendAsk builds a V3 covenant, not a V2 one", async () => {
    // Source-level assertion on the ONE production creation path. A V3
    // covenant that exists but is never called is what this whole file is
    // guarding against, so this checks the call site rather than the module.
    const src = fs.readFileSync("src/lib/asks-client.ts", "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(
      code,
      "sendAsk must call createAskV3 — calling createAsk builds the V2 covenant with F12/F13/F21/F22 live"
    ).toMatch(/createAskV3/);
  });

  it("covenantFor can derive a V3 covenant", async () => {
    // Every money-touching read path routes through covenantFor. While it
    // is V2-only, a V3 record queries the WRONG P2SH: getCovenantUtxo
    // returns null, §4 fails, the row is filtered from both screens, and
    // maybeAutoRefund silently no-ops. Wiring creation without this would
    // strand every Ask the client creates.
    const src = fs.readFileSync("src/lib/asks-client.ts", "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(
      code,
      "covenantFor must branch on protocol version and derive V3 covenants"
    ).toMatch(/deriveAskCovenantV3|covenantForV3|protocolVersion/);
  });

  it("the cache record carries a protocol version discriminator", async () => {
    // Without it, a V2 and a V3 record are indistinguishable once cached,
    // so no read site can know which covenant to derive.
    const src = fs.readFileSync("src/lib/ask-record.ts", "utf8");
    expect(
      src,
      "AskRecordDto needs a protocolVersion field so read sites can branch"
    ).toMatch(/protocolVersion/);
  });

  it("the spender parser tries V3 as well as V2", async () => {
    // deriveStatusFromChain parsed only V2 payloads, so a genuine V3 reply
    // read as claimed_unreadable with the reply never surfaced.
    const src = fs.readFileSync("src/lib/asks-client.ts", "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(
      code,
      "the spender parser must try parseAskPayloadV3"
    ).toMatch(/parseAskPayloadV3/);
  });

  it("V2 remains readable — in-flight Asks must not be orphaned", async () => {
    // The migration must be additive on the READ side. This assertion is
    // expected to pass BOTH before and after the wiring; it is here so that
    // a later change which drops V2 support fails loudly.
    const barrel = await import("../../src/lib/ask");
    expect(barrel).toHaveProperty("createAsk");
    expect(barrel).toHaveProperty("deriveAskCovenant");
    const src = fs.readFileSync("src/lib/asks-client.ts", "utf8");
    expect(src).toMatch(/parseAskPayload\b/);
  });
});
