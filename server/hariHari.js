// v4.2 Rumus penjualan Hari-Hari (PT GTA) - dari sheet "SS-HariHari" user, dicek 238/238 baris cocok:
//   qty kirim (ESB Qty)  = kg tagih + kg tagih × 2% + susut          -> stok keluar, baris invoice
//   tagihan (Nominal)    = kg tagih × harga × (1 − 0,25%)            -> piutang
//   diskon (Disc Value)  = qty kirim × harga − tagihan               -> penyesuaian "diskon"
// Customer ESB "Hari - Hari Swalayan"; nama di sheet (Kalideres, Roxy, ...) = cabang -> Additional Info (src/lib/esb.mjs).
const { round2 } = require('./calc');

const TAMBAH = 0.02;
const DISKON = 0.0025;
// 13 cabang yang sudah dikonfirmasi user (app GTA §11.1). Nama lain TIDAK ditebak - user memilih saat import.
const DEFAULT_BRANCHES = ['Kalideres', 'Duta Harapan Indah', 'Buaran', 'Roxy', 'Bintaro', 'Lokasari', 'Fatmawati', 'Kalibata', 'Bogor', 'Ciledug',
  'Bekasi Cyber Park', 'Bekasi Trade Center', 'Pluit'];
const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const isDefaultBranch = (name) => DEFAULT_BRANCHES.some((b) => norm(b) === norm(name));

/** lines: [{qty (kg tagih), price, ...}] dari sheet; susut kg (ditambahkan ke baris pertama). */
function hhCompute(lines, susut = 0) {
  const s = Number(susut) || 0;
  const kgTagih = r3(lines.reduce((a, l) => a + Number(l.qty), 0));
  const out = lines.map((l, i) => ({ ...l, kgTagih: Number(l.qty), qty: r3(Number(l.qty) * (1 + TAMBAH) + (i === 0 ? s : 0)) }));
  const gross = round2(out.reduce((a, l) => a + round2(l.qty * l.price), 0));
  const tagihan = round2(lines.reduce((a, l) => a + Number(l.qty) * Number(l.price), 0) * (1 - DISKON));
  return { kgTagih, susut: s, lines: out, gross, tagihan, disc: round2(gross - tagihan) };
}

/**
 * Susut dari teks kolom Status ("Susut 1.4 kg", "susut 1.25", "Plus 0.84kg"; semua sebutan dijumlah).
 * Susut gabungan beberapa invoice ("gabung") & satuan gram TIDAK ditebak -> susut 0 + peringatan (isi manual).
 */
function susutFromStatus(text) {
  const raw = String(text || '');
  const t = raw.replace(/(\d)\.\s+(\d)/g, '$1.$2');
  const found = [...t.matchAll(/(susut|plus)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(kg|gram|gr|g)?\b/gi)];
  if (!found.length) return { susut: 0, warning: null };
  if (/gabung/i.test(t)) return { susut: 0, warning: `Susut gabungan beberapa invoice ("${raw}") - diimpor dengan susut 0, isi manual` };
  if (found.some((m) => m[3] && /^g/i.test(m[3]))) return { susut: 0, warning: `Susut dalam gram ("${raw}") - diimpor dengan susut 0, periksa & isi manual` };
  return { susut: r3(found.reduce((a, m) => a + Number(m[2].replace(',', '.')), 0)), warning: null };
}

module.exports = { hhCompute, susutFromStatus, isDefaultBranch, DEFAULT_BRANCHES, norm };
