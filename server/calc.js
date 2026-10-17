// Logika murni (tanpa DB) — dites langsung di test/calc.test.js.

const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

// Selisih di bawah ini dianggap 0 (sisa floating point), BUKAN batas pembulatan bisnis.
// Selisih rupiah sungguhan selalu dimunculkan dan diselesaikan user lewat tombol pembulatan.
const EPS = 0.005;

const lineTotal = (l) => round2(Number(l.qty) * Number(l.price));

// adjustments: amount positif = mengurangi tagihan (retur, diskon), negatif = menambah.
function summarize(lines, paid, adjusted, importedTotal) {
  const total = round2(lines.reduce((s, l) => s + lineTotal(l), 0));
  const outstanding = round2(total - Number(adjusted || 0) - Number(paid || 0));
  let status;
  if (Math.abs(outstanding) < EPS) status = 'lunas';
  else if (outstanding < 0) status = 'lebih_bayar';
  else if (Number(paid) > 0) status = 'sebagian';
  else status = 'belum';
  const importDiff = importedTotal == null ? 0 : round2(Number(importedTotal) - total);
  const hasCost = lines.length > 0 && lines.every((l) => l.cost_price != null);
  const cost = hasCost ? round2(lines.reduce((s, l) => s + round2(Number(l.qty) * Number(l.cost_price)), 0)) : null;
  return {
    total, paid: round2(paid || 0), adjusted: round2(adjusted || 0), outstanding, status,
    importDiff: Math.abs(importDiff) < EPS ? 0 : importDiff,
    zeroPriceLines: lines.filter((l) => Number(l.qty) !== 0 && Number(l.price) === 0).length,
    cost, margin: cost == null ? null : round2(total - cost),
  };
}

function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(n));
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromYmd, toYmd) {
  return Math.round((Date.parse(toYmd + 'T00:00:00Z') - Date.parse(fromYmd + 'T00:00:00Z')) / 86400000);
}

const AGING_BUCKETS = ['belum_jatuh_tempo', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];
function agingBucket(dueDate, asOf) {
  const late = daysBetween(dueDate, asOf);
  if (late <= 0) return 'belum_jatuh_tempo';
  if (late <= 30) return 'd1_30';
  if (late <= 60) return 'd31_60';
  if (late <= 90) return 'd61_90';
  return 'd90_plus';
}

// Angka dari sheet. 'id': 1.234.567,89 (titik = ribuan). 'en': 1,234,567.89.
function parseNumber(v, format = 'id') {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/^Rp\.?\s*/i, '').replace(/\s/g, '');
  if (s === '' || s === '-') return null;
  if (format === 'id') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, agust: 8,
  sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};
const pad = (n) => String(n).padStart(2, '0');
const validYmd = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const fullYear = (y) => (y < 100 ? 2000 + y : y);

// Tanggal dari sheet: serial Excel, '1-Jan-26', '01/01/2026' (D/M/Y), '2026-01-01'.
function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]+)[-\s/](\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    return mon ? validYmd(fullYear(+m[3]), mon, +m[1]) : null;
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return validYmd(fullYear(+m[3]), +m[2], +m[1]);
  return null;
}

module.exports = { round2, EPS, lineTotal, summarize, addDays, daysBetween, agingBucket, AGING_BUCKETS, parseNumber, parseDate };

// Tanggal hari ini menurut WIB (server Railway berjalan di UTC).
const todayWIB = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
module.exports.todayWIB = todayWIB;
