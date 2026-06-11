// Generates simple valid PNG icons (no external deps) so the extension loads
// cleanly. A dark rounded tile with an amber "dram" disc — recognisable at 16px.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });

function png(size) {
  const bg = [20, 24, 29, 255];     // #14181d dark tile
  const ring = [31, 122, 77, 255];  // #1f7a4d green ring
  const dram = [201, 138, 58, 255]; // amber whisky disc
  const c = (size - 1) / 2;
  const rOuter = size * 0.40, rInner = size * 0.30, corner = size * 0.18;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter byte per scanline
    for (let x = 0; x < size; x++) {
      // rounded-corner mask
      const dxC = Math.max(corner - x, x - (size - 1 - corner), 0);
      const dyC = Math.max(corner - y, y - (size - 1 - corner), 0);
      const transparent = Math.hypot(dxC, dyC) > corner;
      const d = Math.hypot(x - c, y - c);
      let px;
      if (transparent) px = [0, 0, 0, 0];
      else if (d <= rInner) px = dram;
      else if (d <= rOuter) px = ring;
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
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
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
