/**
 * Generates public/tilesets/dungeon_basic.png — minimal programmer-art tileset.
 * Pure Node.js (built-ins only: zlib, fs, path, crypto).
 *
 * Layout: 8 columns × 2 rows, 32px tiles → 256×64 px RGB PNG
 *
 * Row 0 (floor tiles, localId 0-7):
 *   0: dark stone floor   1: medium stone floor  2: light stone
 *   3: dirt               4: cracked stone       5: mossy stone
 *   6: wood plank         7: grass
 *
 * Row 1 (wall/obstacle tiles, localId 8-15):
 *   8: solid wall dark    9: solid wall medium  10: pillar
 *  11: water             12: lava               13: crate
 *  14: barrel            15: rubble
 *
 * Run: node scripts/gen_placeholder_tileset.mjs
 */

import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = `${__dirname}/../public/tilesets/dungeon_basic.png`;

const TILE  = 32;
const COLS  = 8;
const ROWS  = 2;
const W     = TILE * COLS; // 256
const H     = TILE * ROWS; // 64

// Tile fill colours as [R, G, B] — row 0 = floors, row 1 = walls
const FILL = [
  [0x2a, 0x2a, 0x3e], // 0  dark stone floor
  [0x3c, 0x3c, 0x5a], // 1  medium stone floor
  [0x55, 0x55, 0x72], // 2  light stone floor
  [0x5a, 0x42, 0x2e], // 3  dirt
  [0x38, 0x36, 0x50], // 4  cracked stone
  [0x2e, 0x4a, 0x36], // 5  mossy stone
  [0x6a, 0x4e, 0x30], // 6  wood plank
  [0x3a, 0x5c, 0x2e], // 7  grass
  [0x18, 0x18, 0x28], // 8  solid wall dark
  [0x28, 0x28, 0x40], // 9  solid wall medium
  [0x50, 0x48, 0x60], // 10 pillar
  [0x1e, 0x3e, 0x72], // 11 water
  [0xaa, 0x42, 0x10], // 12 lava
  [0x6e, 0x52, 0x30], // 13 crate
  [0x5c, 0x40, 0x24], // 14 barrel
  [0x4a, 0x44, 0x3e], // 15 rubble
];

// ---------------------------------------------------------------------------
// Build raw pixel buffer (RGB, row-major)
// ---------------------------------------------------------------------------

const pixels = new Uint8Array(W * H * 3);

for (let tileRow = 0; tileRow < ROWS; tileRow++) {
  for (let tileCol = 0; tileCol < COLS; tileCol++) {
    const idx = tileRow * COLS + tileCol;
    const [fr, fg, fb] = FILL[idx];
    // Border colour = fill darkened by 30
    const br = Math.max(0, fr - 30);
    const bg = Math.max(0, fg - 30);
    const bb = Math.max(0, fb - 30);

    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const gx = tileCol * TILE + px;
        const gy = tileRow * TILE + py;
        const offset = (gy * W + gx) * 3;

        const isBorder = px === 0 || py === 0 || px === TILE - 1 || py === TILE - 1;
        if (isBorder) {
          pixels[offset]     = br;
          pixels[offset + 1] = bg;
          pixels[offset + 2] = bb;
        } else {
          pixels[offset]     = fr;
          pixels[offset + 1] = fg;
          pixels[offset + 2] = fb;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Encode as PNG (spec: http://www.libpng.org/pub/png/spec/1.2/PNG-Contents.html)
// ---------------------------------------------------------------------------

function crc32(buf) {
  let crc = 0xffffffff;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const lenBuf    = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput  = Buffer.concat([typeBytes, data]);
  const crcBuf    = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

// IHDR: width, height, bit-depth=8, color-type=2 (RGB), compress=0, filter=0, interlace=0
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8]  = 8;  // bit depth
ihdr[9]  = 2;  // color type: RGB
ihdr[10] = 0;  // compression
ihdr[11] = 0;  // filter
ihdr[12] = 0;  // interlace: none

// Raw image data with filter byte 0 (None) before each scanline
const scanlines = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  scanlines[y * (1 + W * 3)] = 0; // filter type: None
  pixels.copy
    ? Buffer.from(pixels).copy(scanlines, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3)
    : scanlines.set(pixels.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
}

const compressed = deflateSync(scanlines, { level: 6 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
  chunk("IHDR", ihdr),
  chunk("IDAT", compressed),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, png);
console.log(`Written: ${OUT_PATH} (${W}×${H}px, ${png.length} bytes)`);
