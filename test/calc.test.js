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

test('import sheet contoh user: 16 invoice, 3860 digabung, selisih 16.070 terdeteksi', () => {
  const plan = parseSheet(sample);
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.invoices.length, 16);
  assert.deepEqual(plan.items, ['Telor Curah', 'Telor Omega', 'Telor Putih', 'Tray/Peti', 'Telor Retak', 'Telor Bocor']);
  const by = Object.fromEntries(plan.invoices.map((i) => [i.number, i]));

  const i3860 = by['3860'];
  assert.equal(i3860.lines.length, 6);
  assert.equal(i3860.importedTotal, 11233113);
  assert.equal(i3860.computedTotal, 11217043);
  assert.equal(i3860.diff, 16070);
  assert.equal(i3860.payments.length, 1);
  assert.equal(i3860.payments[0].amount, 10933000);
  assert.equal(i3860.payments[0].method, 'cash');
  assert.ok(i3860.warnings.some((w) => w.includes('Nominal kosong')));
  assert.equal(i3860.lines.find((l) => l.itemName === 'Tray/Peti').unitName, 'tray');

  // Semua invoice lain cocok dengan total sheet
  for (const inv of plan.invoices) if (inv.number !== '3860') assert.equal(inv.diff, 0, inv.number);
  assert.equal(by['3862'].lines[0].qty, 100.8);
  assert.equal(by['3851'].poRef, 'PO 7 ikat Curah');
  assert.equal(by['3856'].notes, null); // tanda '-' diabaikan
  assert.ok(by['3855'].warnings.some((w) => w.includes('retur')));
  assert.equal(by['3858'].lines.length, 2);
  assert.ok(by['3858'].warnings.some((w) => w.includes('harga kosong')));
  assert.equal(by['3853'].payments[0].date, '2026-01-02');
});

test('import: header tidak ada / nomor sama untuk pihak berbeda', () => {
  assert.ok(parseSheet([['a', 'b']]).error);
  const other = sample[2].map((v, i) => (i === 2 ? 'Orang Lain' : v));
  assert.equal(parseSheet([...sample.slice(0, 3), other]).errors.length, 1);
});
