import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Browser bundles get the web build of the pinned SDK (wasm-bindgen "web"
  // target, explicit init); Node code (tests, scripts) keeps the nodejs
  // variant. Same version, same zip, same API surface (see PROGRESS.md
  // Phase 3 architecture decision).
  turbopack: {
    resolveAlias: {
      "kaspa-wasm": { browser: "kaspa-wasm-web" },
    },
    // The web SDK build carries wasm-bindgen's Node-detection shims —
    // dynamic `require(string)` calls that never execute in a browser but
    // trip Turbopack's static resolution (kaspa.js:14709-14720).
    ignoreIssue: [{ path: "**/vendor/**" }],
  },
};

export default nextConfig;
