// Browser-side wasm initialization. The web SDK build (wasm-bindgen "web"
// target) must be init()ed before any SDK class is touched. Import specifier
// is "kaspa-wasm" so Turbopack's browser alias (next.config.ts) resolves it
// to the SAME module instance the rest of src/lib/ask uses — never import
// "kaspa-wasm-web" directly, or two wasm heaps could exist side by side.
// Node builds (tests/scripts) get the nodejs variant, which self-initializes;
// there `default` is undefined and this becomes a no-op.

let ready: Promise<void> | undefined;

export function ensureKaspaReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const mod = (await import("kaspa-wasm")) as unknown as {
        default?: (opts: { module_or_path: string }) => Promise<unknown>;
      } & Record<string, unknown>;
      if (typeof mod.default === "function") {
        await mod.default({ module_or_path: "/kaspa_bg.wasm" });
        // Production-minification guard (beta blocker B1, 2026-08-05):
        // the wasm side casts JS objects by READING constructor.name and
        // string-comparing it (observed live: "object constructor `ed`
        // does not match expected class `Resolver`"). Minifiers rename
        // classes, so restore every exported class's runtime name to its
        // export name — the export keys survive minification because the
        // namespace is consumed by name across module boundaries.
        for (const [exportName, value] of Object.entries(mod)) {
          if (
            typeof value === "function" &&
            /^[A-Z]/.test(exportName) &&
            value.name !== exportName
          ) {
            try {
              Object.defineProperty(value, "name", { value: exportName });
            } catch {
              /* non-configurable — nothing we can do for this one */
            }
          }
        }
      }
    })();
  }
  return ready;
}
