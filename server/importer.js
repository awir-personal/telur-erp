// Membaca baris sheet penjualan (format 2 baris header: grup barang di atas, kg/Harga di bawah)
// menjadi rencana invoice. Murni, tanpa DB.
const { round2, lineTotal, parseNumber, parseDate, EPS } = require('./calc');

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const UNIT_FROM_LABEL = { kg: 'kg', 'peti/tray': 'tray', 'tray/peti': 'tray', tray: 'tray', peti: 'peti', butir: 'butir', ikat: 'ikat' };

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map(norm);
    if (cells.includes('tanggal') && cells.some((c) => c.includes('inv'))) return i;
  }
  return -1;
}

function parseSheet(rows, { numberFormat = 'id' } = {}) {
  const h = findHeader(rows);
  if (h < 0) return { error: 'Baris header tidak ditemukan (butuh kolom "Tanggal" dan "No Inv").' };
  const head = rows[h].map(norm);
  const group = h > 0 ? rows[h - 1] || [] : [];
  const col = (pred) => head.findIndex(pred);
  const c = {
    date: col((x) => x === 'tanggal'),
    no: col((x) => x.includes('inv')),
    name: col((x) => x === 'nama'),
    total: col((x) => x === 'total'),
    payDate: col((x) => x.startsWith('tgl') && x.includes('byr') || x === 'tgl bayar'),
    nominal: col((x) => x === 'nominal'),
    status: col((x) => x === 'status' || x === 'keterangan'),
  };
  const missing = ['date', 'no', 'name', 'total'].filter((k) => c[k] < 0);
  if (missing.length) return { error: `Kolom wajib tidak ditemukan: ${missing.join(', ')}` };

  // Pasangan (qty, harga) antara kolom Nama dan Total. Nama barang dari baris grup (sel gabungan → isi ke kanan).
  const pairs = [];
  let groupName = '';
  for (let j = c.name + 1; j < c.total; j++) {
    if (String(group[j] ?? '').trim()) groupName = String(group[j]).trim();
    if (head[j] !== 'harga' && head[j + 1] === 'harga') {
      pairs.push({ qtyCol: j, priceCol: j + 1, item: groupName || rows[h][j], unit: UNIT_FROM_LABEL[head[j]] || head[j] || 'kg' });
      j++;
    }
  }
  if (!pairs.length) return { error: 'Tidak ada pasangan kolom (jumlah, Harga) antara Nama dan Total.' };

  const num = (v) => parseNumber(v, numberFormat);
  const byNo = new Map();
  const errors = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const no = String(row[c.no] ?? '').trim();
    const name = String(row[c.name] ?? '').trim();
    if (!no && !name) continue;
    const rowNum = r + 1;
    if (!no) { errors.push(`Baris ${rowNum}: No Inv kosong`); continue; }
    if (!name) { errors.push(`Baris ${rowNum}: Nama kosong`); continue; }
    const date = parseDate(row[c.date]);
    if (!date) { errors.push(`Baris ${rowNum}: tanggal "${row[c.date] ?? ''}" tidak terbaca`); continue; }

    let inv = byNo.get(no);
    if (!inv) {
      inv = { number: no, date, partyName: name, lines: [], importedTotal: 0, payments: [], poRef: null, notes: [], rows: [], warnings: [] };
      byNo.set(no, inv);
    } else {
      if (norm(inv.partyName) !== norm(name)) { errors.push(`Baris ${rowNum}: No Inv ${no} dipakai juga untuk "${inv.partyName}" (sekarang "${name}")`); continue; }
      inv.warnings.push(`No Inv ${no} muncul di lebih dari satu baris (baris ${inv.rows.join(', ')} & ${rowNum}) — digabung jadi 1 invoice`);
      if (date !== inv.date) inv.warnings.push(`Baris ${rowNum}: tanggal beda (${date}) dari baris pertama (${inv.date}) — dipakai ${inv.date}`);
    }
    inv.rows.push(rowNum);

    for (const p of pairs) {
      const qty = num(row[p.qtyCol]);
      const price = num(row[p.priceCol]);
      if (Number.isNaN(qty) || Number.isNaN(price)) { inv.warnings.push(`Baris ${rowNum} ${p.item}: angka tidak terbaca — dilewati`); continue; }
      if (!qty) { if (price) inv.warnings.push(`Baris ${rowNum} ${p.item}: ada harga tapi jumlah kosong — dilewati`); continue; }
      if (!price) inv.warnings.push(`Baris ${rowNum} ${p.item}: harga kosong — diimpor dengan harga 0`);
      inv.lines.push({ itemName: p.item, unitName: p.unit, qty, price: price || 0 });
    }

    const total = num(row[c.total]);
    if (Number.isNaN(total)) inv.warnings.push(`Baris ${rowNum}: Total tidak terbaca`);
    else inv.importedTotal = round2(inv.importedTotal + (total || 0));

    const status = c.status >= 0 ? String(row[c.status] ?? '').trim() : '';
    if (status && status !== '-') {
      if (/^po\b/i.test(status) && !inv.poRef) inv.poRef = status;
      else inv.notes.push(status);
    }

    const payDate = c.payDate >= 0 ? parseDate(row[c.payDate]) : null;
    const nominal = c.nominal >= 0 ? num(row[c.nominal]) : null;
    if (nominal && !Number.isNaN(nominal)) {
      const method = /transfer|tf\b/i.test(status) ? 'transfer' : /cash|tunai/i.test(status) ? 'cash' : 'lainnya';
      inv.payments.push({ date: payDate || date, amount: nominal, method, note: `Import baris ${rowNum}${status ? ': ' + status : ''}` });
      if (!payDate) inv.warnings.push(`Baris ${rowNum}: nominal tanpa Tgl Byr — tanggal bayar = tanggal invoice`);
    } else if (payDate) {
      inv.warnings.push(`Baris ${rowNum}: ada Tgl Byr tapi Nominal kosong — pembayaran TIDAK diimpor, catat manual`);
    }
  }

  const invoices = [...byNo.values()].map((inv) => {
    const computed = round2(inv.lines.reduce((s, l) => s + lineTotal(l), 0));
    const diff = round2(inv.importedTotal - computed);
    if (Math.abs(diff) >= EPS) inv.warnings.push(`Total di sheet ${inv.importedTotal} ≠ hitungan ${computed} (selisih ${diff}) — perlu justifikasi setelah import`);
    if (/retur|return|susut/i.test(inv.notes.join(' '))) inv.warnings.push('Ada catatan retur/susut — total TIDAK dikurangi otomatis, catat sebagai penyesuaian bila perlu');
    return { ...inv, notes: inv.notes.join(' | ') || null, computedTotal: computed, diff: Math.abs(diff) < EPS ? 0 : diff };
  });
  return { headerRow: h + 1, items: [...new Set(pairs.map((p) => p.item))], invoices, errors };
}

module.exports = { parseSheet };
