/**
 * Generates Tiled/temple_ruins.png — self-contained programmer-art tileset
 * for the ruined-temple feature-showcase map. Pure Node built-ins (zlib, fs).
 *
 * Layout: 8 columns × 3 rows × 32px tiles → 256×96 px RGB PNG.
 *
 * Glyph overlay marks tiles with game-mechanical properties so the rendered
 * map is readable without consulting the property table:
 *   hatch / dense-hatch → moveCost ≥ 2   (rubble)
 *   square / dbl-square → coverGrade 1/2 (pillars, altar)
 *   X                   → blocked        (walls, deep water, pit, statue)
 *   chevron / dbl-chev. → elevation 1/2  (stairs, dais)
 *
 * Run: node Tiled/gen_tileset.mjs
 */

import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH  = `${__dirname}/temple_ruins.png`;

const TILE = 32;
const COLS = 8;
const ROWS = 3;
const W    = TILE * COLS; // 256
const H    = TILE * ROWS; // 96

// ---------------------------------------------------------------------------
// Tile palette. `glyphs` is a list of overlay marks drawn after the flat fill.
// ---------------------------------------------------------------------------

/** @typedef {"hatch"|"dense_hatch"|"square"|"dbl_square"|"cross"|"chevron"|"dbl_chevron"} Glyph */

/** @type {{ name: string, fill: [number,number,number], glyphs: Glyph[] }[]} */
const TILES = [
  // Row 0 — floors & water
  { name: "flagstone_light",   fill: [0x6b, 0x6b, 0x5a], glyphs: [] },
  { name: "flagstone_dark",    fill: [0x5a, 0x5a, 0x4a], glyphs: [] },
  { name: "flagstone_cracked", fill: [0x60, 0x5a, 0x50], glyphs: [] },
  { name: "moss",              fill: [0x4a, 0x5c, 0x3a], glyphs: [] },
  { name: "rubble_light",      fill: [0x70, 0x68, 0x58], glyphs: ["hatch"] },          // moveCost:2
  { name: "rubble_heavy",      fill: [0x60, 0x58, 0x50], glyphs: ["dense_hatch"] },    // moveCost:3
  { name: "water_shallow",     fill: [0x3a, 0x5a, 0x6a], glyphs: [] },
  { name: "water_deep",        fill: [0x2a, 0x4a, 0x5c], glyphs: ["cross"] },          // blocked

  // Row 1 — cover & walls
  { name: "pillar",            fill: [0x7a, 0x72, 0x68], glyphs: ["square"] },         // coverGrade:1
  { name: "broken_column",     fill: [0x72, 0x6a, 0x60], glyphs: ["square"] },         // coverGrade:1
  { name: "altar",             fill: [0x8a, 0x80, 0x70], glyphs: ["dbl_square"] },     // coverGrade:2
  { name: "low_wall",          fill: [0x6a, 0x62, 0x58], glyphs: ["square"] },         // coverGrade:1
  { name: "wall_solid",        fill: [0x3a, 0x36, 0x30], glyphs: ["cross"] },          // blocked
  { name: "wall_weathered",    fill: [0x44, 0x40, 0x3a], glyphs: ["cross"] },          // blocked
  { name: "wall_corner",       fill: [0x35, 0x31, 0x28], glyphs: ["cross"] },          // blocked
  { name: "pit",               fill: [0x18, 0x18, 0x18], glyphs: ["cross"] },          // blocked

  // Row 2 — elevation & decorative
  { name: "stairs",            fill: [0x72, 0x70, 0x5c], glyphs: ["chevron"] },        // elevation:1
  { name: "dais",              fill: [0x78, 0x74, 0x60], glyphs: ["chevron"] },        // elevation:1
  { name: "high_dais",         fill: [0x80, 0x7c, 0x68], glyphs: ["dbl_chevron"] },    // elevation:2
  { name: "statue",            fill: [0x58, 0x54, 0x50], glyphs: ["cross", "square"] },// blocked + coverGrade:1
  { name: "brazier",           fill: [0x8a, 0x50, 0x30], glyphs: [] },
  { name: "vines",             fill: [0x3a, 0x50, 0x30], glyphs: [] },
  { name: "mosaic",            fill: [0x6a, 0x68, 0x50], glyphs: [] },
  { name: "bloodstain",        fill: [0x5a, 0x30, 0x30], glyphs: [] },
];

if (TILES.length !== COLS * ROWS) {
  throw new Error(`palette has ${TILES.length} entries, need ${COLS * ROWS}`);
}

// ---------------------------------------------------------------------------
// Raster helpers
// ---------------------------------------------------------------------------

const px = new Uint8Array(W * H * 3);

function put(gx, gy, r, g, b) {
  if (gx < 0 || gx >= W || gy < 0 || gy >= H) return;
  const o = (gy * W + gx) * 3;
  px[o] = r; px[o + 1] = g; px[o + 2] = b;
}

function lighten([r, g, b], delta) {
  return [Math.min(255, r + delta), Math.min(255, g + delta), Math.min(255, b + delta)];
}

function darken([r, g, b], delta) {
  return [Math.max(0, r - delta), Math.max(0, g - delta), Math.max(0, b - delta)];
}

/**
 * Draw a glyph inside a single tile. Glyphs are centred geometric marks
 * ~14–16 px wide, drawn in a 1-px stroke. Origin (ox, oy) is the tile's
 * top-left pixel in the full image.
 */
function drawGlyph(glyph, ox, oy, [r, g, b]) {
  const c = TILE / 2; // 16 — tile centre

  switch (glyph) {
    case "hatch": {
      // 3 diagonal strokes, ↘ direction, spaced 6px apart
      for (const off of [-6, 0, 6]) {
        for (let t = -7; t <= 7; t++) {
          put(ox + c + t, oy + c + t + off, r, g, b);
        }
      }
      break;
    }

    case "dense_hatch": {
      // 5 diagonal strokes, spaced 4px apart
      for (const off of [-8, -4, 0, 4, 8]) {
        for (let t = -7; t <= 7; t++) {
          put(ox + c + t, oy + c + t + off, r, g, b);
        }
      }
      break;
    }

    case "square": {
      // 12×12 hollow square, centred
      const half = 6;
      for (let d = -half; d <= half; d++) {
        put(ox + c + d,    oy + c - half, r, g, b); // top
        put(ox + c + d,    oy + c + half, r, g, b); // bottom
        put(ox + c - half, oy + c + d,    r, g, b); // left
        put(ox + c + half, oy + c + d,    r, g, b); // right
      }
      break;
    }

    case "dbl_square": {
      // Nested 14×14 and 8×8 hollow squares
      for (const half of [7, 4]) {
        for (let d = -half; d <= half; d++) {
          put(ox + c + d,    oy + c - half, r, g, b);
          put(ox + c + d,    oy + c + half, r, g, b);
          put(ox + c - half, oy + c + d,    r, g, b);
          put(ox + c + half, oy + c + d,    r, g, b);
        }
      }
      break;
    }

    case "cross": {
      // Two diagonals forming an X, 14px span
      for (let t = -7; t <= 7; t++) {
        put(ox + c + t, oy + c + t, r, g, b); // ↘
        put(ox + c + t, oy + c - t, r, g, b); // ↗
      }
      break;
    }

    case "chevron": {
      // Single upward ^ chevron, 7px half-width, 2px thick
      for (let t = 0; t <= 7; t++) {
        for (let thick = 0; thick < 2; thick++) {
          put(ox + c - t, oy + c - 4 + t + thick, r, g, b);
          put(ox + c + t, oy + c - 4 + t + thick, r, g, b);
        }
      }
      break;
    }

    case "dbl_chevron": {
      // Two stacked ^ chevrons
      for (const yBase of [c - 7, c]) {
        for (let t = 0; t <= 6; t++) {
          for (let thick = 0; thick < 2; thick++) {
            put(ox + c - t, oy + yBase + t + thick, r, g, b);
            put(ox + c + t, oy + yBase + t + thick, r, g, b);
          }
        }
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Paint each tile: flat fill → darkened border → glyph(s)
// ---------------------------------------------------------------------------

for (let i = 0; i < TILES.length; i++) {
  const { fill, glyphs } = TILES[i];
  const col = i % COLS;
  const row = (i / COLS) | 0;
  const ox  = col * TILE;
  const oy  = row * TILE;

  const [fr, fg, fb] = fill;
  const [br, bg, bb] = darken(fill, 30);
  const [gr, gg, gb] = lighten(fill, 55);

  for (let py = 0; py < TILE; py++) {
    for (let px_ = 0; px_ < TILE; px_++) {
      const isBorder = px_ === 0 || py === 0 || px_ === TILE - 1 || py === TILE - 1;
      if (isBorder) {
        put(ox + px_, oy + py, br, bg, bb);
      } else {
        put(ox + px_, oy + py, fr, fg, fb);
      }
    }
  }

  for (const g of glyphs) drawGlyph(g, ox, oy, [gr, gg, gb]);
}

// ---------------------------------------------------------------------------
// PNG encode — signature · IHDR · IDAT · IEND
// (http://www.libpng.org/pub/png/spec/1.2/PNG-Contents.html)
// ---------------------------------------------------------------------------

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

// IHDR: width · height · depth=8 · colortype=2(RGB) · compress=0 · filter=0 · interlace=0
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

// IDAT: each scanline is prefixed with filter-type byte 0 (None)
const stride = W * 3;
const raw = Buffer.alloc(H * (1 + stride));
const pxBuf = Buffer.from(px.buffer);
for (let y = 0; y < H; y++) {
  raw[y * (1 + stride)] = 0;
  pxBuf.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
}
const idat = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, png);
console.log(`Written: ${OUT_PATH} (${W}×${H}px, ${png.length} bytes, ${TILES.length} tiles)`);
