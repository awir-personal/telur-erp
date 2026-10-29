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

function parseSheet(sheetRows, { numberFormat = 'id' } = {}) {
  const h = findHeader(sheetRows);
  if (h < 0) return { error: 'Baris header tidak ditemukan (butuh kolom "Tanggal" dan "No Inv").' };
  // Mulai dari kolom "Tanggal": kolom tambahan di kirinya (mis. centang "Sisca Done" / "Yusuf Done"
  // di kolom A-B sheet sejak Okt 2026) diabaikan - sheet dibaca mulai kolom C.
  const start = sheetRows[h].map(norm).indexOf('tanggal');
  const rows = sheetRows.map((r) => (r || []).slice(start));
  const head = rows[h].map(norm);
  const group = h > 0 ? rows[h - 1] || [] : [];
  const col = (pred) => head.findIndex(pred);
  const c = {
    date: col((x) => x === 'tanggal'),
    no: col((x) => x.includes('inv')),
    name: col((x) => x === 'nama' || x === 'nama pelanggan' || x === 'nama customer' || x === 'pelanggan' || x === 'customer'),
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
  // v3.3 (keputusan user): 1 baris sheet = 1 invoice, APA ADANYA. No Inv yang muncul di beberapa baris
  // (nama sama maupun beda) TIDAK digabung/ditolak - tiap baris jadi invoice sendiri dengan nomor yang
  // sama persis, lalu user memberi catatan. `seq` = urutan kemunculan nomor itu di sheet (1, 2, ...),
  // dipakai saat commit supaya import ulang tidak membuat dobel.
  const list = [];
  const seqOf = new Map();
  const errors = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const no = String(row[c.no] ?? '').trim();
    const name = String(row[c.name] ?? '').trim();
    if (!no && !name) continue;
    // baris tanpa nama & tanpa angka = sisa rumus No Inv yang auto-increment di ekor sheet -> bukan data
    const hasNumber = [...pairs.flatMap((p) => [row[p.qtyCol], row[p.priceCol]]), row[c.total]].some((v) => { const n = num(v); return n && !Number.isNaN(n); });
    if (!name && !hasNumber) continue;
    const rowNum = r + 1;
    if (!no) { errors.push(`Baris ${rowNum}: No Inv kosong`); continue; }
    const seq = (seqOf.get(no) || 0) + 1; // dihitung sebelum validasi lain: urutan tetap walau baris lain error
    seqOf.set(no, seq);
    if (!name) { errors.push(`Baris ${rowNum}: Nama kosong`); continue; }
    const date = parseDate(row[c.date]);
    if (!date) { errors.push(`Baris ${rowNum}: tanggal "${row[c.date] ?? ''}" tidak terbaca`); continue; }

    const inv = { number: no, seq, date, partyName: name, lines: [], importedTotal: 0, payments: [], poRef: null, notes: [], rows: [rowNum], warnings: [] };
    list.push(inv);

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

  const count = new Map();
  for (const inv of list) count.set(inv.number, (count.get(inv.number) || 0) + 1);
  const invoices = list.map((inv) => {
    inv.dupCount = count.get(inv.number);
    if (inv.dupCount > 1) {
      const baris = list.filter((x) => x.number === inv.number).map((x) => `${x.rows[0]} (${x.partyName})`).join(', ');
      inv.warnings.unshift(`No Inv ${inv.number} ada di ${inv.dupCount} baris sheet (baris ${baris}) — masuk apa adanya sebagai ${inv.dupCount} invoice bernomor sama; beri catatan setelah import`);
    }
    const computed = round2(inv.lines.reduce((s, l) => s + lineTotal(l), 0));
    const diff = round2(inv.importedTotal - computed);
    if (Math.abs(diff) >= EPS) inv.warnings.push(`Total di sheet ${inv.importedTotal} ≠ hitungan ${computed} (selisih ${diff}) — perlu justifikasi setelah import`);
    if (/retur|return|susut/i.test(inv.notes.join(' '))) inv.warnings.push('Ada catatan retur/susut — total TIDAK dikurangi otomatis, catat sebagai penyesuaian bila perlu');
    return { ...inv, notes: inv.notes.join(' | ') || null, computedTotal: computed, diff: Math.abs(diff) < EPS ? 0 : diff };
  });
  return { headerRow: h + 1, items: [...new Set(pairs.map((p) => p.item))], invoices, errors };
}

module.exports = { parseSheet };
