// ASK protocol library — public surface. See ASKSPEC.md.
//
// V2 (protocol v1) and V3 (protocol v2) are BOTH exported. The client
// CREATES only V3; it must keep READING V2, because in-flight V2 Asks
// exist on chain and orphaning them would strand real funds.
//
// Until 2026-08-06 this barrel exported V2 only, so every V3 module was
// unreachable from the app and four Criticals (F12/F13/F21/F22) were live
// in production while the audit ledger recorded them as fixed. The
// reachability assertion in tests/unit/v3-reachability.test.ts exists to
// stop that recurring.
export * from "./protocol";
export * from "./covenant";
export * from "./crypto";
export * from "./transactions";
export * from "./node";

// --- V3 (protocol v2): the hardened covenant the client now creates ---
export * from "./covenant-v3";
export * from "./protocol-v3";
export * from "./transactions-v3";
export * from "./node-v3";
export * from "./fees-v3";
export * from "./daa-guard";
