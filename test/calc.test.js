const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/calc');
const { parseSheet } = require('../server/importer');
const sample = require('./fixtures/sheet-sample');

test('parseNumber format Indonesia & Inggris', () => {
  assert.equal(C.parseNumber('28.000'), 28000);
  assert.equal(C.parseNumber('100,8'), 100.8);
  assert.equal(C.parseNumber('10.933.000,00'), 10933000);
  assert.equal(C.parseNumber('Rp 1.500'), 1500);
  assert.equal(C.parseNumber('1,234.5', 'en'), 1234.5);
  assert.equal(C.parseNumber(''), null);
  assert.ok(Number.isNaN(C.parseNumber('abc')));
});

test('parseDate berbagai format', () => {
  assert.equal(C.parseDate('1-Jan-26'), '2026-01-01');
  assert.equal(C.parseDate('3-Agu-26'), '2026-08-03');
  assert.equal(C.parseDate('05/02/2026'), '2026-02-05'); // D/M/Y
  assert.equal(C.parseDate('2026-01-31'), '2026-01-31');
  assert.equal(C.parseDate(46023), '2026-01-01'); // serial Excel
  assert.equal(C.parseDate('31-Feb-26'), null);
  assert.equal(C.parseDate('kemarin'), null);
});

test('summarize: status & selisih', () => {
  const lines = [{ qty: 100.8, price: 29000 }];
  assert.equal(C.summarize(lines, 0, 0).total, 2923200);
  assert.equal(C.summarize(lines, 0, 0).status, 'belum');
  assert.equal(C.summarize(lines, 1000000, 0).status, 'sebagian');
  assert.equal(C.summarize(lines, 2923200, 0).status, 'lunas');
  assert.equal(C.summarize(lines, 2923300, 0).status, 'lebih_bayar');
  const s = C.summarize(lines, 2923000, 200);
  assert.equal(s.outstanding, 0);
  assert.equal(s.status, 'lunas');
  assert.equal(C.summarize(lines, 0, 0, 2923300).importDiff, 100);
  assert.equal(C.summarize([{ qty: 10, price: 0 }], 0, 0).zeroPriceLines, 1);
  assert.equal(C.summarize([{ qty: 10, price: 0 }], 0, 0).status, 'belum'); // harga kosong ≠ lunas
});

test('margin hanya bila semua baris punya harga beli', () => {
  assert.equal(C.summarize([{ qty: 10, price: 30000, cost_price: 27000 }], 0, 0).margin, 30000);
  assert.equal(C.summarize([{ qty: 10, price: 30000, cost_price: 27000 }, { qty: 1, price: 5, cost_price: null }], 0, 0).margin, null);
});

test('aging bucket', () => {
  assert.equal(C.agingBucket('2026-02-01', '2026-02-01'), 'belum_jatuh_tempo');
  assert.equal(C.agingBucket('2026-02-01', '2026-02-02'), 'd1_30');
  assert.equal(C.agingBucket('2026-02-01', '2026-03-03'), 'd1_30');
  assert.equal(C.agingBucket('2026-02-01', '2026-03-04'), 'd31_60');
  assert.equal(C.agingBucket('2026-01-01', '2026-04-15'), 'd90_plus');
  assert.equal(C.addDays('2026-01-31', 30), '2026-03-02');
});

test('import sheet contoh user: 1 baris = 1 invoice apa adanya (v3.3), 3860 jadi 2 invoice bernomor sama', () => {
  const plan = parseSheet(sample);
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.invoices.length, 17);
  assert.deepEqual(plan.items, ['Telor Curah', 'Telor Omega', 'Telor Putih', 'Tray/Peti', 'Telor Retak', 'Telor Bocor']);
  const one = (no, seq = 1) => plan.invoices.find((i) => i.number === no && i.seq === seq);

  // 3860 di 2 baris sheet -> 2 invoice, nomor sama, data tiap baris tidak diubah
  const [a, b] = [one('3860', 1), one('3860', 2)];
  assert.deepEqual([a.rows, b.rows, a.dupCount, b.dupCount], [[12], [13], 2, 2]);
  assert.equal(a.lines.length, 5);
  assert.equal(a.importedTotal, 9073113);
  assert.equal(a.computedTotal, 9057043);
  assert.equal(a.diff, 16070); // selisih 16.070 tetap terdeteksi, di baris asalnya
  assert.equal(a.payments.length, 0);
  assert.ok(a.warnings.some((w) => w.includes('Nominal kosong')));
  assert.equal(a.lines.find((l) => l.itemName === 'Tray/Peti').unitName, 'tray');
  assert.deepEqual([b.lines.length, b.importedTotal, b.diff], [1, 2160000, 0]);
  assert.equal(b.payments.length, 1);
  assert.equal(b.payments[0].amount, 10933000);
  assert.equal(b.payments[0].method, 'cash');
  for (const x of [a, b]) assert.match(x.warnings[0], /No Inv 3860 ada di 2 baris sheet \(baris 12 \(Cash\), 13 \(Cash\)\) — masuk apa adanya/);

  // Semua invoice lain cocok dengan total sheet & tidak bertanda dobel
  for (const inv of plan.invoices) if (inv.number !== '3860') { assert.equal(inv.diff, 0, inv.number); assert.equal(inv.dupCount, 1, inv.number); }
  assert.equal(one('3862').lines[0].qty, 100.8);
  assert.equal(one('3851').poRef, 'PO 7 ikat Curah');
  assert.equal(one('3856').notes, null); // tanda '-' diabaikan
  assert.ok(one('3855').warnings.some((w) => w.includes('retur')));
  assert.equal(one('3858').lines.length, 2);
  assert.ok(one('3858').warnings.some((w) => w.includes('harga kosong')));
  assert.equal(one('3853').payments[0].date, '2026-01-02');
});

test('import layout sheet Okt 2026: kolom centang A-B diabaikan (baca mulai kolom C), "Nama Pelanggan", "Tgl Tagih"', () => {
  // screenshot user: A-B = "Please Mark" / "Sisca Done" "Yusuf Done" (centang), lalu Tanggal di kolom C;
  // kolom nama jadi "Nama Pelanggan", ada "Tgl Tagih" di antara Total dan Tgl Byr
  const geser = sample.map((r, i) => {
    const kiri = i === 0 ? ['Please Mark', ''] : i === 1 ? ['Sisca Done', 'Yusuf Done'] : [i % 2 === 0, false];
    const isi = i === 1 ? r.map((v) => (v === 'Nama' ? 'Nama Pelanggan' : v)) : r;
    return [...kiri, ...isi.slice(0, 16), i === 1 ? 'Tgl Tagih' : i > 1 ? '5-Jan-26' : '', ...isi.slice(16)];
  });
  const baru = parseSheet(geser);
  const lama = parseSheet(sample);
  assert.equal(baru.error, undefined);
  assert.deepEqual(baru.errors, []);
  assert.deepEqual(baru.items, lama.items);
  assert.deepEqual(baru.invoices, lama.invoices); // termasuk baris, pembayaran, selisih 3860 & peringatan
  // apa pun judul kolom di KIRI Tanggal tidak ikut dibaca (mis. kolom tanda bernama "Nama" / "Total")
  const kiriBentrok = geser.map((r, i) => (i === 1 ? ['Nama', 'Total', ...r.slice(2)] : r));
  assert.deepEqual(parseSheet(kiriBentrok).invoices, lama.invoices);
  // ekor sheet: No Inv dari rumus auto-increment tanpa nama & tanpa angka -> dilewati diam-diam;
  // tapi No Inv tanpa nama yang ADA angkanya tetap error
  const kosong = (no, kg = '') => [false, false, '', no, '', kg, kg ? '28.000' : '', ...Array(16).fill('')];
  const ekor = parseSheet([...geser, kosong('3867'), kosong('3868'), kosong('3869', '10')]);
  assert.deepEqual(ekor.errors, ['Baris 22: Nama kosong']);
  assert.equal(ekor.invoices.length, lama.invoices.length);
});

test('import: header tidak ada / nomor sama untuk pihak berbeda tetap masuk', () => {
  assert.ok(parseSheet([['a', 'b']]).error);
  // nomor sama untuk nama BEDA: tidak error lagi (v3.3) - 2 invoice terpisah, nomor sama, ditandai
  const other = sample[2].map((v, i) => (i === 2 ? 'Orang Lain' : v));
  const p = parseSheet([...sample.slice(0, 3), other]);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.invoices.map((i) => [i.number, i.seq, i.partyName, i.dupCount]), [['3851', 1, 'Home Made', 2], ['3851', 2, 'Orang Lain', 2]]);
  // seq dihitung sebelum validasi: baris tengah yang error tidak menggeser urutan baris sesudahnya
  const rusak = sample[2].map((v, i) => (i === 0 ? 'bukan tanggal' : v));
  assert.deepEqual(parseSheet([...sample.slice(0, 3), rusak, other]).invoices.map((i) => i.seq), [1, 3]);
});
