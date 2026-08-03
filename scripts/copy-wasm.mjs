// Copies the browser wasm binary from the vendored SDK into public/ so the
// client can init it from a stable URL (/kaspa_bg.wasm). Runs via predev /
// prebuild; the copy is gitignored — vendor/ stays the single source.
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "vendor", "kaspa-wasm32-sdk", "web", "kaspa", "kaspa_bg.wasm");
const dst = join(root, "public", "kaspa_bg.wasm");

const srcStat = statSync(src);
let needsCopy = true;
try {
  const dstStat = statSync(dst);
  needsCopy = dstStat.size !== srcStat.size || dstStat.mtimeMs < srcStat.mtimeMs;
} catch {
  /* missing — copy */
}
if (needsCopy) {
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`copied kaspa_bg.wasm (${srcStat.size} bytes) -> public/`);
}
