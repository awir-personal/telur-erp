// Membuat ikon PWA (PNG) tanpa library: telur krem di atas latar amber brand-600.
// Jalankan sekali setelah mengubah desain: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const S = 4; // supersampling untuk tepi halus
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const p = pixel((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
        for (let k = 0; k < 4; k++) acc[k] += p[k];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 4; k++) raw[o + k] = Math.round(acc[k] / (S * S));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const BG = [217, 119, 6, 255]; // brand-600
const EGG = [255, 247, 237, 255];
const SHADE = [253, 230, 200, 255];
// Telur: elips, bagian atas lebih runcing. u,v dalam 0..1.
function inEgg(u, v, cx, cy, scale) {
  const rx = 0.25 * scale, ry = 0.32 * scale;
  const dy = (v - cy) / ry;
  const k = dy < 0 ? 1 - 0.18 * -dy : 1; // menyempit di atas
  const dx = (u - cx) / (rx * k);
  return dx * dx + dy * dy <= 1;
}
function egg(u, v, scale) {
  if (!inEgg(u, v, 0.5, 0.54, scale)) return null;
  // Bayangan sabit di kanan bawah: di dalam telur tapi di luar telur yang digeser ke kiri atas.
  return inEgg(u, v, 0.5 - 0.05 * scale, 0.54 - 0.045 * scale, scale) ? EGG : SHADE;
}
const icon = (scale, rounded) => (u, v) => {
  if (rounded) { const r = 0.22, qx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), qy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0); if (qx * qx + qy * qy > r * r) return [0, 0, 0, 0]; }
  return egg(u, v, scale) || BG;
};

const out = path.join(__dirname, '..', 'public');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), png(192, icon(1, true)));
fs.writeFileSync(path.join(out, 'icon-512.png'), png(512, icon(1, true)));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), png(512, icon(0.8, false))); // area aman 80%
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), png(180, icon(1, false)));
fs.writeFileSync(path.join(out, 'favicon.png'), png(64, icon(1.1, true)));
console.log('Ikon dibuat di public/');
