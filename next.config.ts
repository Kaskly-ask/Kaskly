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

  // F25 — the app holds private keys in localStorage and had NO framing
  // protection, so it could be embedded cross-origin and its buttons
  // driven by clickjacking. Two framed clicks reached "Disconnect", which
  // erased the only copy of the key. A frame cannot READ the key
  // (same-origin policy), but it could destroy it.
  //
  // frame-ancestors 'none' is the load-bearing header and cannot be set
  // via a meta tag, so it must live here. X-Frame-Options repeats it for
  // any client that predates CSP level 2.
  //
  // NOTE (F19, still open): this is NOT a full Content-Security-Policy. A
  // script-src policy is the real defence-in-depth for key exfiltration
  // and needs a nonce strategy compatible with Next's inline bootstrap —
  // deliberately not attempted here rather than shipped half-configured
  // and reported as done.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
