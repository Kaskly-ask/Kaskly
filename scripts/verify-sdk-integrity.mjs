// F27 — build-time integrity check for the vendored Kaspa SDK.
//
// WHY THIS EXISTS: the two `file:` dependencies (kaspa-wasm, kaspa-wasm-web)
// are the ONLY dependencies npm cannot verify — every registry package
// carries a sha512 in package-lock.json, these carry nothing. And they are
// the ones that matter most: `Keypair.random()`, signing and address
// derivation all live in that WASM. A swapped binary makes every generated
// wallet attacker-derivable, and the ownership proof still passes, because
// the key is real — merely predictable.
//
// The SHA256 recorded in PROGRESS.md's ground truth is of the RELEASE ZIP,
// which is gitignored and absent from the repo, so a cloner had nothing to
// check the committed files against. These are per-file pins of the actual
// committed artifacts, independently recomputed 2026-08-05 and matching the
// third audit's byte-comparison against the official upstream release.
//
// Runs in `prebuild`. A mismatch FAILS THE BUILD LOUDLY — it must never be
// a warning, because the whole point is that a silent swap is invisible.
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** path -> expected sha256. Update ONLY when deliberately upgrading the
 * SDK, and only alongside a re-verification against the upstream release. */
const PINS = {
  // A6 (fourth audit): pinning only the code files was bypassable. An
  // attacker with write access to vendor/ — exactly the capability this
  // check exists to defend against — dropped an UNPINNED entry module and
  // repointed package.json's "main"/"module" at it. The pinned files were
  // untouched, every hash matched, and the build printed green while
  // Keypair.random() was backdoored. The file that decides WHICH file
  // loads must be pinned too.
  "vendor/kaspa-wasm32-sdk/web/kaspa/package.json":
    "5edd2e0a69732e00946d10482e86f35b386a22b87d00059bc9ef97eeb5196709",
  "vendor/kaspa-wasm32-sdk/nodejs/kaspa/package.json":
    "f200a3dcc702735e41a70b72af2f6cc99dd970579d198cc9f1fdb2e532d0c479",
  "vendor/kaspa-wasm32-sdk/web/kaspa/kaspa_bg.wasm":
    "5f90736c80721027ecea1a51509005ebb37a434857fb4882ff03b20b24b923a9",
  "vendor/kaspa-wasm32-sdk/nodejs/kaspa/kaspa_bg.wasm":
    "9427733cb0cb1c78cc3f2cc9f77f4153426636925ced0256c5c30e4edc199eaa",
  "vendor/kaspa-wasm32-sdk/web/kaspa/kaspa.js":
    "82202df28a83b6da08a4fa4a9184b9ad4ef0185d9d9df333544cf7c17013daca",
  "vendor/kaspa-wasm32-sdk/nodejs/kaspa/kaspa.js":
    "1e0ad892861bf3e0a63ba8ed51366efc2b812c5a34c6895385ee2f9d026d2fc1",
};

/** The browser is served a COPY at public/kaspa_bg.wasm. Verifying only the
 * vendor source would leave the actually-shipped file unchecked. */
const COPY_OF = {
  "public/kaspa_bg.wasm": "vendor/kaspa-wasm32-sdk/web/kaspa/kaspa_bg.wasm",
};

/** A6: pinning is necessary but not sufficient — an attacker can ADD a
 * file rather than modify one. Each SDK directory must contain EXACTLY
 * these entries; anything unexpected fails the build. */
const EXPECTED_DIR_CONTENTS = {
  "vendor/kaspa-wasm32-sdk/web/kaspa": [
    "LICENSE", "README.md", "kaspa.d.ts", "kaspa.js",
    "kaspa_bg.wasm", "kaspa_bg.wasm.d.ts", "package.json",
  ],
  "vendor/kaspa-wasm32-sdk/nodejs/kaspa": [
    "LICENSE", "README.md", "kaspa.d.ts", "kaspa.js",
    "kaspa_bg.wasm", "kaspa_bg.wasm.d.ts", "package.json",
  ],
};

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

let failed = false;
const report = [];

for (const [rel, expected] of Object.entries(PINS)) {
  const file = path.resolve(process.cwd(), rel);
  if (!existsSync(file)) {
    failed = true;
    report.push(`  MISSING  ${rel}`);
    continue;
  }
  const actual = sha256(file);
  if (actual !== expected) {
    failed = true;
    report.push(`  MISMATCH ${rel}\n    expected ${expected}\n    actual   ${actual}`);
  } else {
    report.push(`  ok       ${rel}`);
  }
}

for (const [rel, sourceRel] of Object.entries(COPY_OF)) {
  const file = path.resolve(process.cwd(), rel);
  if (!existsSync(file)) {
    // Not an error: prebuild runs copy-wasm after this, so on a clean tree
    // the copy may not exist yet. It is verified on every subsequent build.
    report.push(`  skipped  ${rel} (not yet copied)`);
    continue;
  }
  const actual = sha256(file);
  const expected = PINS[sourceRel];
  if (actual !== expected) {
    failed = true;
    report.push(
      `  MISMATCH ${rel} (served copy differs from ${sourceRel})\n    expected ${expected}\n    actual   ${actual}`
    );
  } else {
    report.push(`  ok       ${rel} (matches ${sourceRel})`);
  }
}

// A6: no-unexpected-files rule.
for (const [dir, expected] of Object.entries(EXPECTED_DIR_CONTENTS)) {
  const abs = path.resolve(process.cwd(), dir);
  if (!existsSync(abs)) {
    failed = true;
    report.push(`  MISSING  ${dir}/ (directory)`);
    continue;
  }
  const actual = readdirSync(abs).sort();
  const want = [...expected].sort();
  const extra = actual.filter((f) => !want.includes(f));
  const missing = want.filter((f) => !actual.includes(f));
  if (extra.length || missing.length) {
    failed = true;
    if (extra.length) report.push(`  UNEXPECTED FILES in ${dir}/: ${extra.join(", ")}`);
    if (missing.length) report.push(`  MISSING FILES in ${dir}/: ${missing.join(", ")}`);
  } else {
    report.push(`  ok       ${dir}/ (${actual.length} files, none unexpected)`);
  }
}

console.log("SDK integrity check (F27 + A6):");
console.log(report.join("\n"));

if (failed) {
  console.error(
    "\n*** BUILD ABORTED — vendored Kaspa SDK does not match its pinned hashes. ***\n" +
      "This binary generates private keys and signs transactions. A mismatch means\n" +
      "either a deliberate SDK upgrade (update the pins in this file, after\n" +
      "re-verifying against the official upstream release) or tampering.\n" +
      "Do not bypass this check.\n"
  );
  process.exit(1);
}
console.log("  all pinned SDK artifacts verified\n");
