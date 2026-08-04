// Generates PWA placeholder icons in the brand direction (near-black,
// teal rounded-square bubble outline, bold reversed-K glyph) until the
// final external brand assets land (public/brand/README.md). Re-run:
//   node scripts/gen-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

function svg({ inset, glyphSize }) {
  // Rounded-square speech-bubble outline + centered ĸ. The maskable
  // variant uses a bigger inset so OS masks never clip the mark.
  const s = 512;
  const box = s - inset * 2;
  const r = Math.round(box * 0.25);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">
  <rect width="${s}" height="${s}" fill="#0a0a0a"/>
  <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${r}"
        fill="none" stroke="#49eacb" stroke-width="${Math.round(box * 0.085)}"/>
  <text x="50%" y="50%" dy="${Math.round(glyphSize * 0.34)}"
        text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-weight="bold" font-size="${glyphSize}" fill="#49eacb">ĸ</text>
</svg>`);
}

const regular = svg({ inset: 64, glyphSize: 236 });
const maskable = svg({ inset: 112, glyphSize: 190 });

await sharp(regular).resize(512, 512).png().toFile(join(outDir, "icon-512.png"));
await sharp(regular).resize(192, 192).png().toFile(join(outDir, "icon-192.png"));
await sharp(maskable).resize(512, 512).png().toFile(join(outDir, "icon-maskable-512.png"));
await sharp(regular).resize(180, 180).png().toFile(join(outDir, "apple-touch-icon.png"));
console.log("icons written to public/icons/");
