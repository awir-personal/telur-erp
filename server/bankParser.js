// Membaca mutasi rekening (BCA / BNI / Mandiri / "Laporan Arus Kas" buatan sendiri / format lain lewat pemetaan
// kolom manual) menjadi baris { date, description, amount (+ masuk / − keluar), balance }. Murni, tanpa DB.
const { parseDate, round2 } = require('./calc');

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s._]+/g, ' ');
const SYN = {
  date: ['tanggal', 'tgl', 'date', 'tanggal transaksi', 'tgl transaksi', 'post date', 'posting date', 'trans date', 'transaction date', 'tanggal posting', 'value date'],
  description: ['keterangan', 'deskripsi', 'description', 'uraian', 'remark', 'remarks', 'transaction description', 'keterangan transaksi', 'detail'],
  debit: ['debet', 'debit', 'mutasi debet', 'mutasi debit', 'db', 'withdrawal', 'withdrawals', 'pengeluaran', 'keluar', 'debit amount'],
  credit: ['kredit', 'credit', 'mutasi kredit', 'cr', 'deposit', 'deposits', 'pemasukan', 'masuk', 'credit amount'],
  amount: ['jumlah', 'amount', 'nominal', 'mutasi', 'nilai'],
  dbcr: ['db/cr', 'd/k', 'dk', 'type', 'jenis', 'cr/db', 'd/c'],
  balance: ['saldo', 'balance', 'saldo akhir', 'ending balance', 'running balance'],
};
const PRESET_DIRECTION = { BCA: 'debet_keluar', BNI: 'debet_keluar', Mandiri: 'debet_keluar' };

function matchCol(cell, key) {
  const c = norm(cell);
  return c && SYN[key].some((s) => c === s || (s.length > 3 && c.startsWith(s + ' ')));
}

// Cari baris header: baris dengan kolom tanggal + (debet & kredit | jumlah) terbanyak.
function detectHeader(rows) {
  let best = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i] || [];
    const find = (k) => r.findIndex((c) => matchCol(c, k));
    const m = { date: find('date'), description: find('description'), debit: find('debit'), credit: find('credit'), amount: find('amount'), dbcr: find('dbcr'), balance: find('balance') };
    const ok = m.date >= 0 && ((m.debit >= 0 && m.credit >= 0) || m.amount >= 0);
    if (!ok) continue;
    const score = Object.values(m).filter((x) => x >= 0).length;
    if (!best || score > best.score) best = { row: i, mapping: m, score };
  }
  return best;
}

// Angka fleksibel: 1.234.567,89 | 1,234,567.89 | 1234567 | (1.000) | "1,000,000.00 CR"
function parseAmount(v) {
  if (v == null || v === '') return { value: null, flag: null };
  if (typeof v === 'number') return { value: Number.isFinite(v) ? v : null, flag: null };
  let s = String(v).trim();
  let flag = null;
  const f = s.match(/\b(DB|CR|D|K|DR)\s*$/i);
  if (f) { flag = /^(cr|k)$/i.test(f[1]) ? 'CR' : 'DB'; s = s.slice(0, f.index).trim(); }
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^Rp\.?/i, '').replace(/\s/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!s) return { value: null, flag };
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && (s.match(/,/g) || []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0) {
    if (!(/\.\d{1,2}$/.test(s) && (s.match(/\./g) || []).length === 1)) s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return { value: NaN, flag };
  return { value: neg ? -Number(s) : Number(s), flag };
}

// Tanggal bank: termasuk "01/02" tanpa tahun (KlikBCA) → pakai tahun dari opsi.
function parseBankDate(v, year) {
  if (typeof v === 'string') {
    const t = v.trim().replace(/^'/, '');
    const m = t.match(/^(\d{1,2})[/-](\d{1,2})$/);
    if (m && year) return parseDate(`${m[1]}/${m[2]}/${year}`);
    // "02 Jan 2026 10:15" / "2026-01-02 10:15:00" → buang jam
    return parseDate(t.replace(/\s+\d{1,2}[:.]\d{2}([:.]\d{2})?$/, '').replace(/^(\d{1,2}) ([A-Za-z]{3,}) (\d{2,4})$/, '$1-$2-$3'));
  }
  return parseDate(v);
}

function parseBank(rows, opts = {}) {
  const { preset = 'auto', year = null } = opts;
  let header;
  if (opts.mapping) header = { row: Number(opts.headerRow ?? -1), mapping: { date: -1, description: -1, debit: -1, credit: -1, amount: -1, dbcr: -1, balance: -1, ...opts.mapping } };
  else header = detectHeader(rows);
  if (!header) return { error: 'Kolom tidak dikenali otomatis. Pilih kolom secara manual (tanggal, keterangan, debet/kredit atau jumlah).' };
  const M = header.mapping;
  if (M.date < 0 || !((M.debit >= 0 && M.credit >= 0) || M.amount >= 0)) return { error: 'Pemetaan kolom belum lengkap: butuh Tanggal dan (Debet + Kredit) atau Jumlah.' };
  // KlikBCA: kolom DB/CR tepat di kanan "Jumlah" tanpa judul → kenali dari isinya.
  if (M.amount >= 0 && M.dbcr < 0) {
    const vals = rows.slice(header.row + 1, header.row + 40).map((r) => String((r || [])[M.amount + 1] ?? '').trim()).filter(Boolean);
    if (vals.length && vals.every((v) => /^(CR|DB|D|K|DR)$/i.test(v))) M.dbcr = M.amount + 1;
  }

  const raw = [];
  const warnings = [];
  let lastDate = null;
  for (let i = header.row + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const date = r[M.date] === '' || r[M.date] == null ? null : parseBankDate(r[M.date], year);
    const desc = M.description >= 0 ? String(r[M.description] ?? '').trim() : '';
    const deb = M.debit >= 0 ? parseAmount(r[M.debit]) : { value: null };
    const cre = M.credit >= 0 ? parseAmount(r[M.credit]) : { value: null };
    const amt = M.amount >= 0 ? parseAmount(r[M.amount]) : { value: null };
    const bal = M.balance >= 0 ? parseAmount(r[M.balance]) : { value: null };
    const hasAmount = [deb.value, cre.value, amt.value].some((x) => x != null && x !== 0 && !Number.isNaN(x));
    if ([deb.value, cre.value, amt.value, bal.value].some((x) => Number.isNaN(x))) { warnings.push(`Baris ${i + 1}: angka tidak terbaca, dilewati`); continue; }
    if (!hasAmount) {
      // Baris lanjutan keterangan (keterangan panjang dipecah beberapa baris) → gabung ke baris sebelumnya.
      if (!date && desc && raw.length && /[a-z]/i.test(desc)) raw[raw.length - 1].description += ' ' + desc;
      continue;
    }
    if (!date && r[M.date] !== '' && r[M.date] != null) { warnings.push(`Baris ${i + 1}: tanggal "${r[M.date]}" tidak terbaca, dilewati`); continue; }
    const d = date || lastDate;
    if (!d) { warnings.push(`Baris ${i + 1}: tanpa tanggal, dilewati`); continue; }
    lastDate = d;
    let dbcr = amt.flag;
    if (M.dbcr >= 0) { const t = norm(r[M.dbcr]); if (/^(cr|k|kredit|credit|c)$/.test(t)) dbcr = 'CR'; else if (/^(db|d|debet|debit|dr)$/.test(t)) dbcr = 'DB'; }
    raw.push({ row: i + 1, date: d, description: desc, debit: deb.value || 0, credit: cre.value || 0, amount: amt.value, dbcr, balance: bal.value });
  }

  // Arah: Debet = uang KELUAR (sudut pandang bank, standar mutasi rekening) atau MASUK (buku kas sendiri).
  // 'auto' menguji kedua kemungkinan terhadap kolom saldo.
  const signed = (x, dir) => {
    if (x.amount != null && M.amount >= 0 && !(M.debit >= 0 && M.credit >= 0)) {
      if (x.dbcr === 'CR') return Math.abs(x.amount);
      if (x.dbcr === 'DB') return -Math.abs(x.amount);
      return x.amount; // bertanda dari file
    }
    return dir === 'debet_masuk' ? x.debit - x.credit : x.credit - x.debit;
  };
  let direction = opts.direction && opts.direction !== 'auto' ? opts.direction : null;
  let check = null;
  if (!direction) {
    const score = (dir) => {
      let hit = 0, tot = 0;
      for (let k = 1; k < raw.length; k++) {
        if (raw[k].balance == null || raw[k - 1].balance == null) continue;
        tot++;
        if (Math.abs(raw[k - 1].balance + signed(raw[k], dir) - raw[k].balance) < 1) hit++;
      }
      return { hit, tot };
    };
    const out = score('debet_keluar');
    const inn = score('debet_masuk');
    check = { debet_keluar: out, debet_masuk: inn };
    direction = inn.hit > out.hit ? 'debet_masuk' : out.tot ? 'debet_keluar' : PRESET_DIRECTION[preset] || 'debet_keluar';
    if (!out.tot) warnings.push('Tidak ada kolom saldo untuk memastikan arah Debet; dianggap Debet = uang keluar (standar mutasi bank). Periksa preview.');
    else if (Math.max(out.hit, inn.hit) / out.tot < 0.8) warnings.push(`Saldo hanya cocok di ${Math.max(out.hit, inn.hit)} dari ${out.tot} baris. Mungkin ada baris yang terlewat atau urutan terbalik; periksa preview.`);
  }

  // occurrence: transaksi identik (tgl+ket+nominal sama) di satu file tetap dibedakan, supaya impor ulang tidak dobel.
  const seen = new Map();
  const lines = raw.map((x) => {
    const amount = round2(signed(x, direction));
    const key = `${x.date}|${x.description}|${amount}|${x.balance ?? ''}`;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return { row: x.row, date: x.date, description: x.description, amount, balance: x.balance == null ? null : round2(x.balance), key: `${key}|${n}` };
  });
  return {
    headerRow: header.row + 1, mapping: M, direction, directionCheck: check, lines, warnings,
    totals: { in: round2(lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0)), out: round2(-lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0)) },
  };
}

module.exports = { parseBank, parseAmount, detectHeader, parseBankDate };
