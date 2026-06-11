// Generates the extension icons (no external deps): a whisky tumbler with a
// pour of amber liquid on a dark rounded tile — recognisable down to 16px.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });

function png(size) {
  const bg = [20, 24, 29, 255];        // #14181d dark tile
  const wall = [211, 218, 222, 255];   // light glass
  const interior = [34, 41, 49, 255];  // empty glass above the liquid
  const liquid = [217, 142, 43, 255];  // amber whisky
  const surface = [240, 181, 86, 255]; // lighter top surface of the pour

  const corner = size * 0.18;          // tile corner radius
  // Tumbler geometry (y grows downward)
  const gx0 = size * 0.26, gx1 = size * 0.74; // outer walls
  const gy0 = size * 0.16, gy1 = size * 0.84; // rim to base
  const gr = size * 0.10;                     // base corner radius
  const t = Math.max(1, Math.round(size * 0.06)); // wall thickness
  const liquidTop = size * 0.50;

  // Rounded-bottom rect membership (top edge is open — it's a glass).
  function inRect(x0, x1, y1top, y1bot, r, x, y) {
    if (x < x0 || x > x1 || y < y1top || y > y1bot) return false;
    if (y > y1bot - r) {
      if (x < x0 + r) return Math.hypot(x - (x0 + r), y - (y1bot - r)) <= r;
      if (x > x1 - r) return Math.hypot(x - (x1 - r), y - (y1bot - r)) <= r;
    }
    return true;
  }
  const inOuter = (x, y) => inRect(gx0, gx1, gy0, gy1, gr, x, y);
  const inInner = (x, y) => inRect(gx0 + t, gx1 - t, gy0, gy1 - t, Math.max(0, gr - t), x, y);

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // PNG filter byte per scanline
    for (let x = 0; x < size; x++) {
      // Tile rounded-corner transparency
      const dxC = Math.max(corner - x, x - (size - 1 - corner), 0);
      const dyC = Math.max(corner - y, y - (size - 1 - corner), 0);
      let px;
      if (Math.hypot(dxC, dyC) > corner) px = [0, 0, 0, 0];
      else if (inInner(x, y)) {
        if (y < liquidTop) px = interior;
        else if (y < liquidTop + Math.max(1, t)) px = surface;
        else px = liquid;
      } else if (inOuter(x, y)) px = wall;
      else px = bg;
      raw[p++] = px[0]; raw[p++] = px[1]; raw[p++] = px[2]; raw[p++] = px[3];
    }
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0, 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return c ^ 0xffffffff; }

for (const s of [16, 48, 128]) {
  writeFileSync(new URL(`../icons/icon${s}.png`, import.meta.url), png(s));
  console.log('wrote icons/icon' + s + '.png');
}
