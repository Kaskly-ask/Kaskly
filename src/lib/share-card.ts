// Share-card renderer (pre-beta feature, promoted from IDEAS 2026-08-05,
// scoped to wallet-only). Client-side canvas → PNG sized for X (1200×675).
// The card reproduces the app's visual system — near-black ground, teal
// glows, the covenant-hex texture, a clear-glass panel — so it is
// unmistakably Kaskly. The QR encodes an ASK LINK (kaskly.app/ask?to=…),
// never a raw address; the truncated address appears only as visual
// confirmation. TESTNET tag is solid and opaque — honesty never goes
// translucent, same rule as the app.
import QRCode from "qrcode";
import { NETWORK_ID, shortAddress } from "./config";

const W = 1200;
const H = 675;
const TEAL = "#49eacb";

// The same escrow bytes the app's background drifts — set dressing that is
// literally the product.
const HEX_ROWS = [
  "63 00 0f b8 63 69 70 68 5f 6d 73 67",
  "3a 31 3a 61 73 6b 3a 88 20 ac",
  "64 b0 c2 51 9c 00 c3 88",
  "00 c4 a2 68 63 69 70 68",
  "5f 6d 73 67 3a 31 3a 61 73 6b",
  "63 00 0f b8 5f 6d 73 67",
];

function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(73,234,203,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function appFont(weight: number, sizePx: number, mono = false): string {
  const varName = mono ? "--font-geist-mono" : "--font-geist-sans";
  const fam =
    getComputedStyle(document.documentElement)
      .getPropertyValue(varName)
      .trim() || (mono ? "ui-monospace, monospace" : "system-ui, sans-serif");
  return `${weight} ${sizePx}px ${fam}`;
}

export async function renderShareCard(
  address: string,
  askUrl: string
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  // Ground + ambient glows
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);
  glow(ctx, W * 0.85, -40, 520, "rgba(73,234,203,0.20)");
  glow(ctx, 40, H + 60, 560, "rgba(73,234,203,0.12)");

  // Covenant-hex texture
  ctx.font = "15px ui-monospace, monospace";
  ctx.fillStyle = "rgba(73,234,203,0.07)";
  for (let i = 0; i < 14; i++) {
    const row = HEX_ROWS[i % HEX_ROWS.length];
    ctx.fillText(row, (i * 173) % (W - 220), 40 + i * 48);
  }

  // Clear-glass panel
  const P = { x: 70, y: 90, w: W - 140, h: H - 180, r: 26 };
  roundRectPath(ctx, P.x, P.y, P.w, P.h, P.r);
  const fill = ctx.createLinearGradient(0, P.y, 0, P.y + P.h);
  fill.addColorStop(0, "rgba(255,255,255,0.055)");
  fill.addColorStop(1, "rgba(255,255,255,0.025)");
  ctx.fillStyle = fill;
  ctx.fill();
  const rim = ctx.createLinearGradient(0, P.y, 0, P.y + P.h);
  rim.addColorStop(0, "rgba(255,255,255,0.30)");
  rim.addColorStop(1, "rgba(255,255,255,0.07)");
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Text block (left)
  const LX = P.x + 56;
  ctx.fillStyle = TEAL;
  ctx.font = appFont(700, 64);
  ctx.fillText("Kaskly", LX, P.y + 110);
  ctx.fillStyle = "rgba(154,160,162,0.9)";
  ctx.font = appFont(400, 26);
  ctx.fillText("Just Ask Me", LX + 220, P.y + 108);

  ctx.fillStyle = "#e8eaea";
  ctx.font = appFont(600, 34);
  ctx.fillText("Scan to send me a question", LX, P.y + 205);
  ctx.fillText("with KAS attached.", LX, P.y + 251);

  ctx.fillStyle = "rgba(154,160,162,0.85)";
  ctx.font = appFont(400, 24);
  ctx.fillText("They reply, they earn it. Silence refunds you.", LX, P.y + 305);
  ctx.fillText("Enforced on-chain. No fees, ever.", LX, P.y + 337);

  ctx.fillStyle = "rgba(107,112,114,1)";
  ctx.font = appFont(400, 24, true);
  ctx.fillText(shortAddress(address), LX, P.y + P.h - 56);

  // TESTNET tag — solid, opaque, top-right of the panel
  if (NETWORK_ID.startsWith("testnet")) {
    const tag = "TESTNET";
    ctx.font = appFont(700, 20);
    const tw = ctx.measureText(tag).width;
    const tx = P.x + P.w - tw - 76;
    const ty = P.y + 34;
    roundRectPath(ctx, tx - 12, ty - 6, tw + 24, 36, 6);
    ctx.fillStyle = "#0a0a0a";
    ctx.fill();
    ctx.strokeStyle = "rgba(232,194,104,0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#e8c268";
    ctx.fillText(tag, tx, ty + 20);
  }

  // QR tile (right) — dark modules on a white tile for scanner reliability
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, askUrl, {
    width: 300,
    margin: 1,
    color: { dark: "#0a0a0aff", light: "#ffffffff" },
  });
  const tile = { s: 356, r: 20 };
  const qx = P.x + P.w - tile.s - 56;
  const qy = P.y + (P.h - tile.s) / 2 + 14;
  roundRectPath(ctx, qx, qy, tile.s, tile.s, tile.r);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.drawImage(qrCanvas, qx + (tile.s - 300) / 2, qy + (tile.s - 300) / 2);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG export failed"))),
      "image/png"
    )
  );
}
