// Parser mutasi bank. Contoh dibuat sintetis meniru tata letak tiap bank (bukan data asli user).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBank, parseAmount } = require('../server/bankParser');

test('parseAmount: format Indonesia, Inggris, CR/DB, kurung', () => {
  assert.deepEqual(parseAmount('1.234.567,89'), { value: 1234567.89, flag: null });
  assert.deepEqual(parseAmount('1,234,567.89'), { value: 1234567.89, flag: null });
  assert.deepEqual(parseAmount('2,500,000.00 CR'), { value: 2500000, flag: 'CR' });
  assert.deepEqual(parseAmount('150.000 DB'), { value: 150000, flag: 'DB' });
  assert.equal(parseAmount('(10.000)').value, -10000);
  assert.equal(parseAmount('28.000').value, 28000);
  assert.equal(parseAmount('12,5').value, 12.5);
  assert.equal(parseAmount('').value, null);
  assert.ok(Number.isNaN(parseAmount('abc').value));
});

test('BCA (KlikBCA CSV): satu kolom jumlah + CR/DB, tanggal dd/mm tanpa tahun, keterangan bersambung', () => {
  const rows = [
    ['No. rekening :', "'0000000000"], ['Periode :', '01/01/2026 - 31/01/2026'], [],
    ['Tanggal Transaksi', 'Keterangan', 'Cabang', 'Jumlah', '', 'Saldo'],
    ["'02/01", 'TRSF E-BANKING CR 0201/FTSCY/WS95031', "'0000", '4,350,000.00', 'CR', '14,350,000.00'],
    ['', 'JAKARTA CHEESE FACTORY', '', '', '', ''],
    ["'03/01", 'BIAYA ADM', "'0000", '15,000.00', 'DB', '14,335,000.00'],
    ["'03/01", 'TARIKAN ATM 03/01', "'0000", '1,000,000.00', 'DB', '13,335,000.00'],
  ];
  const r = parseBank(rows, { preset: 'BCA', year: 2026 });
  assert.equal(r.error, undefined);
  assert.equal(r.lines.length, 3);
  assert.deepEqual(r.lines.map((l) => [l.date, l.amount]), [['2026-01-02', 4350000], ['2026-01-03', -15000], ['2026-01-03', -1000000]]);
  assert.match(r.lines[0].description, /JAKARTA CHEESE FACTORY/);
});

test('BNI: Debit/Credit terpisah format Inggris, arah dipastikan lewat saldo', () => {
  const rows = [
    ['Post Date', 'Value Date', 'Branch', 'Journal No.', 'Description', 'Debit', 'Credit', 'Balance'],
    ['02/01/2026 10:12:01', '02/01/2026', '0001', '123', 'TRF DARI HOME MADE', '0.00', '9,660,000.00', '19,660,000.00'],
    ['03/01/2026 08:00:00', '03/01/2026', '0001', '124', 'TRANSFER KE PETERNAK', '5,000,000.00', '0.00', '14,660,000.00'],
  ];
  const r = parseBank(rows, { preset: 'BNI' });
  assert.equal(r.direction, 'debet_keluar');
  assert.deepEqual(r.lines.map((l) => [l.date, l.amount]), [['2026-01-02', 9660000], ['2026-01-03', -5000000]]);
  assert.equal(r.directionCheck.debet_keluar.hit, 1);
});

test('Mandiri: Debit/Kredit format Indonesia', () => {
  const rows = [
    ['Tanggal', 'Keterangan', 'Debit', 'Kredit', 'Saldo'],
    ['05 Jan 2026', 'SETORAN TUNAI', '0', '2.000.000,00', '7.000.000,00'],
    ['06 Jan 2026', 'BIAYA TRANSFER', '6.500,00', '0', '6.993.500,00'],
  ];
  const r = parseBank(rows, { preset: 'Mandiri' });
  assert.deepEqual(r.lines.map((l) => [l.date, l.amount, l.balance]), [['2026-01-05', 2000000, 7000000], ['2026-01-06', -6500, 6993500]]);
});

test('Laporan Arus Kas buatan sendiri: header di baris 3, baris rincian & saldo awal dilewati', () => {
  const rows = [
    ['LAPORAN ARUS KAS'], [],
    ['Tanggal', 'Keterangan', '', 'Debet', 'Kredit', 'Saldo'],
    ['', 'Saldo Awal', '', '', '', 1000000],
    [46025, 'Penjualan', 300000, '', 500000, 1500000],
    ['', 'Rincian A', 200000, '', '', ''],
    [46026, 'Bayar peternak', '', 400000, '', 1100000],
  ];
  const r = parseBank(rows);
  assert.equal(r.headerRow, 3);
  assert.equal(r.direction, 'debet_keluar');
  assert.deepEqual(r.lines.map((l) => l.amount), [500000, -400000]);
  assert.match(r.lines[0].description, /Rincian A/);
});

test('arah otomatis: buku kas yang memakai Debet = uang MASUK', () => {
  const rows = [['Tanggal', 'Keterangan', 'Debet', 'Kredit', 'Saldo'],
    ['2026-01-01', 'a', 100, 0, 1100], ['2026-01-02', 'b', 0, 50, 1050], ['2026-01-03', 'c', 20, 0, 1070]];
  const r = parseBank(rows);
  assert.equal(r.direction, 'debet_masuk');
  assert.deepEqual(r.lines.map((l) => l.amount), [100, -50, 20]);
});

test('pemetaan manual + transaksi identik tetap dibedakan (impor ulang tidak dobel, tidak hilang)', () => {
  const rows = [['x', 'y', 'z'], ['01/01/2026', 'ADM', '-5000'], ['01/01/2026', 'ADM', '-5000']];
  assert.ok(parseBank(rows).error);
  const r = parseBank(rows, { mapping: { date: 0, description: 1, amount: 2 }, headerRow: 0 });
  assert.equal(r.lines.length, 2);
  assert.notEqual(r.lines[0].key, r.lines[1].key);
});
