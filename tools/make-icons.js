/* Generates the PWA icons as real PNGs using only Node's built-in zlib.
   Run from the app folder:  node tools/make-icons.js
   Mark: gold #C5A359 field, deep slate #131C22 "H" — same as the in-app SVG. */

const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const GOLD = [0xC5, 0xA3, 0x59];
const INK  = [0x13, 0x1C, 0x22];

/* ---- PNG encoder ---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // colour type: RGBA
  ihdr[10] = 0;    // deflate
  ihdr[11] = 0;    // adaptive filtering
  ihdr[12] = 0;    // no interlace

  // one filter byte (0 = None) per scanline
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---- geometry ---- */
// Signed coverage helper: 1 inside, 0 outside, fractional on the edge (4x4 supersample).
function coverage(px, py, test) {
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      if (test(px + (sx + 0.5) / 4, py + (sy + 0.5) / 4)) hits++;
    }
  }
  return hits / 16;
}

function inRoundRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function buildIcon(size, opts) {
  const o = opts || {};
  const radius = o.radius != null ? o.radius : size * 0.22;
  const scale = o.scale != null ? o.scale : 1;      // shrinks the H for maskable safe zone

  // H geometry, expressed as fractions of the icon
  const halfSpan = 0.20 * scale;
  const halfTall = 0.22 * scale;
  const bar = 0.0425 * scale;

  const L = size * (0.5 - halfSpan), R = size * (0.5 + halfSpan);
  const T = size * (0.5 - halfTall), B = size * (0.5 + halfTall);
  const t = size * bar;

  const inH = (x, y) => {
    if (y < T || y > B) return false;
    if (x >= L && x <= L + t) return true;               // left stem
    if (x >= R - t && x <= R) return true;               // right stem
    const my = size * 0.5;
    if (x >= L && x <= R && y >= my - t / 2 && y <= my + t / 2) return true;  // crossbar
    return false;
  };

  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bg = coverage(x, y, (px, py) => inRoundRect(px, py, size, size, radius));
      const fg = coverage(x, y, inH);
      const i = (y * size + x) * 4;

      // composite: ink H over gold field, both masked by the rounded square
      const r = GOLD[0] * (1 - fg) + INK[0] * fg;
      const g = GOLD[1] * (1 - fg) + INK[1] * fg;
      const b = GOLD[2] * (1 - fg) + INK[2] * fg;

      buf[i]     = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = Math.round(255 * bg);
    }
  }
  return png(size, size, buf);
}

const outDir = path.join(__dirname, "..", "public", "app", "icons");
fs.mkdirSync(outDir, { recursive: true });

const jobs = [
  ["icon-192.png",          buildIcon(192)],
  ["icon-512.png",          buildIcon(512)],
  // maskable: full bleed (no corner radius) with the mark inside the 80% safe zone
  ["icon-maskable-512.png", buildIcon(512, { radius: 0, scale: 0.72 })],
  // iOS applies its own mask, so ship it square
  ["apple-touch-icon.png",  buildIcon(180, { radius: 0 })]
];

for (const [name, buf] of jobs) {
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log("wrote icons/" + name + "  " + buf.length + " bytes");
}
