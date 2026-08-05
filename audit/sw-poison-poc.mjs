// F27 PoC — does a corrected redeploy evict a POISONED cached wasm?
//
// Drives the real public/sw.js fetch handler in a mock Service Worker
// environment: a poisoned entry is pre-seeded into the cache, then the
// "network" serves a corrected binary, and we check which one is returned
// and what ends up cached.
//
// The OLD behaviour (cache-first, no revalidation) must fail this; the NEW
// behaviour (network-first with cache fallback) must pass. Both are run.
import { readFileSync } from "node:fs";

const SW_SRC = readFileSync("C:/ask-protocol/public/sw.js", "utf8");
const POISONED = "POISONED-WASM-BYTES";
const CORRECTED = "CORRECTED-WASM-BYTES";

function makeEnv({ networkBody, networkFails = false, seedCache }) {
  const store = new Map();
  if (seedCache !== undefined) store.set("/kaspa_bg.wasm", seedCache);

  const cache = {
    match: async (req) => {
      const v = store.get(new URL(req.url).pathname);
      return v === undefined ? undefined : { body: v, ok: true, clone: () => ({ body: v }) };
    },
    put: async (req, res) => {
      store.set(new URL(req.url).pathname, res.body);
    },
    addAll: async () => {},
  };

  const listeners = {};
  const self = {
    addEventListener: (name, fn) => {
      (listeners[name] ||= []).push(fn);
    },
    location: { origin: "https://kaskly.app" },
    skipWaiting: () => {},
    clients: { claim: () => {} },
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
    },
  };
  const fetchFn = async () => {
    if (networkFails) throw new Error("offline");
    return { ok: true, body: networkBody, clone: () => ({ body: networkBody }) };
  };
  return { self, listeners, fetchFn, store };
}

async function run(swSource, opts) {
  const env = makeEnv(opts);
  const fn = new Function("self", "caches", "fetch", "URL", swSource + "\nreturn self;");
  fn(env.self, env.self.caches, env.fetchFn, URL);

  const handler = env.listeners.fetch?.[0];
  if (!handler) throw new Error("no fetch listener registered");

  let responded;
  const event = {
    request: { method: "GET", url: "https://kaskly.app/kaspa_bg.wasm", mode: "no-cors" },
    respondWith: (p) => {
      responded = p;
    },
  };
  handler(event);
  if (!responded) return { served: "(handler did not respond)", cached: env.store.get("/kaspa_bg.wasm") };
  const res = await responded;
  return { served: res.body, cached: env.store.get("/kaspa_bg.wasm") };
}

// The OLD handler, reconstructed exactly as it was before this fix.
const OLD_SW = SW_SRC.replace(
  /\/\/ F27 — the WASM is NOT treated as immutable\.[\s\S]*?\n  \/\/ Immutable assets: cache-first \(build-ID URLs make these self-healing\)\.\n  if \(\n    url\.pathname\.startsWith\("\/_next\/static\/"\) \|\|\n    url\.pathname\.startsWith\("\/icons\/"\)\n  \) \{/,
  `if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/kaspa_bg.wasm" ||
    url.pathname.startsWith("/icons/")
  ) {`
);
if (OLD_SW === SW_SRC) {
  console.error("could not reconstruct the OLD handler — PoC would be meaningless");
  process.exit(1);
}

console.log("=== F27 SW PoC: poisoned wasm cached, then a corrected redeploy ===\n");

const oldRes = await run(OLD_SW, { seedCache: POISONED, networkBody: CORRECTED });
console.log("OLD (cache-first, no revalidation):");
console.log("  served :", oldRes.served);
console.log("  cached :", oldRes.cached);
console.log(
  "  verdict:",
  oldRes.served === POISONED
    ? "POISON PERSISTS — corrected redeploy did NOT evict it"
    : "unexpected"
);

const newRes = await run(SW_SRC, { seedCache: POISONED, networkBody: CORRECTED });
console.log("\nNEW (network-first, cache fallback):");
console.log("  served :", newRes.served);
console.log("  cached :", newRes.cached);
console.log(
  "  verdict:",
  newRes.served === CORRECTED && newRes.cached === CORRECTED
    ? "POISON EVICTED — corrected wasm served AND written over the cached copy"
    : "FAILED — the fix does not evict"
);

const offline = await run(SW_SRC, { seedCache: POISONED, networkFails: true });
console.log("\nNEW, offline (cache fallback must still work):");
console.log("  served :", offline.served);
console.log(
  "  verdict:",
  offline.served === POISONED
    ? "falls back to cache — offline use preserved (this is the accepted trade)"
    : "FAILED — offline broken"
);

const pass =
  oldRes.served === POISONED && newRes.served === CORRECTED && newRes.cached === CORRECTED;
console.log("\n" + (pass ? "PoC PASS: the old behaviour is reproduced as broken, and the fix fires." : "PoC FAIL"));
process.exit(pass ? 0 : 1);
