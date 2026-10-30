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

test('export ESB Simple Purchase: header persis template user, 1 nota = 1 Sequence, isian kolom', async () => {
  const { esbPurchaseAoa, ESB_PURCHASE_HEADER, esbUnit } = await import('../src/lib/esb.mjs');
  // baris 1 file C:\Users\Han\Downloads\APG\GTA\ESB_FNB_SIMPLE_PURCHASE_TEMPLATE_INDEX-new.xlsx (2026-10-29)
  assert.deepEqual(ESB_PURCHASE_HEADER, ['Sequence', 'Supplier', 'Date', 'Branch', 'Location', 'Payment Method', 'COANo', 'Cost Center', 'Project', 'Credit Term', 'Supplier Invoice Number', 'Currency', 'Rate', 'Type', 'Item', 'Unit', 'Qty', 'Price', 'Disc', 'Vat', 'Other Tax', 'Tax Rate', 'Amount', 'Notes', 'Additional Info']);
  const line = (item_name, unit_name, qty, price) => ({ item_name, unit_name, qty, price });
  const invs = [
    { number: '3858', date: '2026-01-02', party_id: 7, party_name: 'APG / Farm', adjusted: 0, lines: [line('Telur Curah', 'kg', 783.07, 27600), line('Telur Putih', 'kg', 167.2, 26600)] },
    { number: 'N-2', date: '2026-01-03', party_id: 8, party_name: 'Peternak B', adjusted: 50000, lines: [line('Tray/Peti', 'tray', 10, 3000)] },
    { number: 'N-3', date: '2026-01-04', party_id: 8, party_name: 'Peternak B', adjusted: 0, lines: [line('Telur Curah', 'kg', 0, 1)] },
  ];
  const term = { 7: 90, 8: 30 };
  const r = esbPurchaseAoa(invs, (i) => term[i.party_id]);
  assert.equal(r.aoa[0], ESB_PURCHASE_HEADER);
  assert.equal(r.count, 2);
  assert.deepEqual(r.aoa[1], [1, 'APG / Farm', '2026-01-02', 'Head Office', 'Main Warehouse', 'Credit', null, null, null, 90, 'Invoice 3858', 'IDR', 1, 'Item', 'Telur Curah', 'Kg', 783.07, 27600, 0, null, null, null, null, null, 'APG / Farm Invoice 3858']);
  assert.deepEqual(r.aoa.slice(1).map((x) => [x[0], x[9], x[14], x[15], x[16]]), [[1, 90, 'Telur Curah', 'Kg', 783.07], [1, 90, 'Telur Putih', 'Kg', 167.2], [2, 30, 'Tray/Peti', 'Tray', 10]]);
  for (const row of r.aoa) assert.equal(row.length, 25);
  assert.deepEqual(r.skipped, ['N-3 (Peternak B): tidak ada baris barang']);
  assert.deepEqual(r.adjusted, ['N-2 (Peternak B)']); // retur/diskon tidak bisa ikut sebagai baris Item
  assert.equal(esbUnit('kg'), 'Kg');
  // nama barang dari sheet ("Telor ...") ditulis sesuai master ESB user ("Telur ...")
  const t = esbPurchaseAoa([{ ...invs[0], lines: [line('Telor Curah', 'kg', 1, 1), line('Tray/Peti', 'tray', 1, 1)] }], () => 90);
  assert.deepEqual(t.aoa.slice(1).map((x) => x[14]), ['Telur Curah', 'Tray/Peti']);
});

// ===== v4.2 penjualan GTA =====
const H = require('../server/hariHari');

test('rumus Hari-Hari: angka asli sheet SS-HariHari (kirim = kg + 2% + susut, tagihan = kg x harga - 0,25%)', () => {
  // [kg tagih, harga, susut, qty kirim, disc value, tagihan] - baris asli sheet user
  for (const [kg, price, susut, qty, disc, tagihan] of [
    [750, 25100, 0, 765, 423562.5, 18777937.5],
    [750, 25100, 1.4, 766.4, 458702.5, 18777937.5],
    [749.1, 28000, 13, 777.082, 835933, 20922363],
    [746.9, 28700, 16.715, 778.553, 962031.17, 21382439.93], // Omega Lokasari inv 93
  ]) {
    const h = H.hhCompute([{ qty: kg, price }], susut);
    assert.equal(h.lines[0].qty, qty);
    assert.equal(h.tagihan, tagihan);
    assert.equal(h.disc, disc);
    assert.equal(C.round2(h.gross - h.disc), tagihan);
  }
  // 2 barang: susut hanya di baris pertama, tagihan dari kg tagih semua baris
  const two = H.hhCompute([{ qty: 500, price: 25000 }, { qty: 250, price: 26000 }], 2);
  assert.deepEqual(two.lines.map((l) => l.qty), [512, 255]);
  assert.equal(two.tagihan, C.round2((500 * 25000 + 250 * 26000) * 0.9975));
});

test('susut dari kolom Status: dijumlah, gabungan & gram tidak ditebak', () => {
  const s = (t) => H.susutFromStatus(t);
  assert.deepEqual(s('Susut 1.4 kg'), { susut: 1.4, warning: null });
  assert.equal(s('susut 1.25').susut, 1.25);
  assert.equal(s('Susut 1,5kg').susut, 1.5);
  assert.equal(s('susut3.02kg').susut, 3.02);
  assert.equal(s('susut 2. 54kg').susut, 2.54);
  assert.equal(s('Plus 0.84kg').susut, 0.84);
  assert.equal(s('susut 6.98kg + susut 3.752kg').susut, 10.732);
  assert.deepEqual(s('-'), { susut: 0, warning: null });
  assert.deepEqual(s('Plus Ongkir 30k'), { susut: 0, warning: null });
  assert.equal(s('susut 12kg gabung inv 150 151').susut, 0);
  assert.match(s('susut 12kg gabung inv 150 151').warning, /gabungan/);
  assert.equal(s('susut 0.350gr').susut, 0);
  assert.match(s('susut 0.350gr').warning, /gram/);
  assert.ok(H.isDefaultBranch(' duta  harapan indah '));
  assert.ok(!H.isDefaultBranch('PT. Agrinesia Raya'));
});

// Potongan tab "SiscaAR Telur - GTA" (Okt 2026): 2 baris grup/header, lalu data.
const GTA_SHEET = [
  ['', 'No GD', 'No PI', 'No PO', 'No GR', '', 'Telor Curah', '', 'Telur Omega', '', 'Telor Putih', '', 'Telor Retak', '', '', '', '', ''],
  ['Tanggal', 'No Inv', 'No Nota Tagihan', 'NO PO', 'No Receive', 'Nama Pelanggan', 'kg', 'Harga', 'Kg', 'Harga', 'Kg', 'Harga', 'Kg', 'Harga', 'Total', 'Tgl Tagihan', 'Nominal', 'Status'],
  [45890, 7951, 20054, 5216760, '', 'Kalideres', 750, 25100, '', '', '', '', '', '', 18825000, '26-Aug-25', 18777937.5, ''],
  [45890, 7952, 20057, 5217475, '', 'Duta Harapan Indah', 750, 25100, '', '', '', '', '', '', 18825000, '27-Aug-25', 18777937.5, 'Susut 1.4 kg'],
  [46020, 54, '', '', '', 'Damar Agung PP', 1799.76, 27800, '', '', '', '', '', '', 50033328, '', 50063328, 'Plus Ongkir 30k'],
  [46042, 64, 'INV-000001', '260002645-0', '', 'PT. Agrinesia Raya', 2025, 26800, '', '', 975, 26800, '', '', 80400000, 46057, '', 'Grade A'],
  [46100, 93, 11487, 4740141, 5619615, 'Lokasari', '', '', 746.9, 28700, '', '', '', '', 21436030, '', 21382439.93, 'Susut 16.715kg'],
  [46110, 187, 2800, 4800000, '', 'Pluit', 750, 29700, '', '', '', '', '', '', 22275000, '', 21663829.7, '-'],
];

test('import sheet GTA: Nominal = tagihan (bukan pembayaran), referensi PI/PO/GR, rumus Hari-Hari hanya untuk cabang', () => {
  const p = parseSheet(GTA_SHEET, { isHH: H.isDefaultBranch });
  assert.equal(p.format, 'gta');
  assert.deepEqual(p.errors, []);
  const by = Object.fromEntries(p.invoices.map((i) => [i.number, i]));
  for (const i of p.invoices) assert.deepEqual(i.payments, []);
  const k = by['7951'];
  assert.deepEqual([k.refPi, k.poRef, k.refGr], ['20054', '5216760', null]);
  assert.deepEqual(k.lines.map((l) => [l.itemName, l.qty, l.price]), [['Telor Curah', 765, 25100]]);
  assert.deepEqual(k.hh, { kgTagih: 750, susut: 0, disc: 423562.5, tagihan: 18777937.5 });
  assert.equal(k.diff, 0);
  assert.equal(by['7952'].lines[0].qty, 766.4);
  assert.equal(by['7952'].hh.disc, 458702.5);
  assert.equal(by['7952'].diff, 0);
  assert.equal(by['93'].lines[0].itemName, 'Telur Omega');
  assert.equal(by['93'].refGr, '5619615');
  assert.equal(by['93'].diff, 0);
  // Pluit 187: Nominal sheet berbeda dari rumus -> selisih untuk dijustifikasi, angka sheet tidak diubah
  assert.equal(by['187'].diff, C.round2(21663829.7 - 22219312.5));
  assert.match(by['187'].warnings.join(' '), /rumus Hari-Hari/);
  // customer biasa: baris apa adanya; Nominal (kalau ada) jadi total sheet -> ongkir 30rb muncul sebagai selisih
  assert.equal(by['54'].hh, undefined);
  assert.deepEqual(by['54'].lines.map((l) => l.qty), [1799.76]);
  assert.equal(by['54'].diff, 30000);
  assert.equal(by['64'].diff, 0); // Nominal kosong -> Total
  assert.deepEqual(by['64'].lines.map((l) => l.itemName), ['Telor Curah', 'Telor Putih']);
  assert.equal(by['64'].notes, 'Grade A');
  // tanpa tanda cabang: tidak ada yang dihitung rumus Hari-Hari
  assert.ok(parseSheet(GTA_SHEET).invoices.every((i) => !i.hh));
});

test('export ESB Simple Sales: 2 baris atas persis template, Hari-Hari -> "Hari - Hari Swalayan" + cabang di Additional Info', async () => {
  const { esbSalesAoa, ESB_SALES_HEADER, ESB_SALES_HELP } = await import('../src/lib/esb.mjs');
  assert.equal(ESB_SALES_HEADER.length, 29);
  assert.equal(ESB_SALES_HELP.length, 29);
  assert.deepEqual(ESB_SALES_HEADER.slice(0, 6), ['Sequence', 'Sales Type', 'Customer', 'Customer Branch', 'Address', 'Simple Sales Date']);
  assert.deepEqual(ESB_SALES_HEADER.slice(18, 29), ['Qty', 'Price', 'Disc %', 'Disc Value', 'VAT', 'Other Tax', 'Tax Rate', 'Amount', 'Notes', 'Additional Info', 'Footnote']);
  const line = (item_name, qty, price) => ({ item_name, unit_name: 'kg', qty, price });
  const invs = [
    { number: '7952', date: '2025-08-21', party_id: 1, party_name: 'Duta Harapan Indah', hh_branch: 1, ref_pi: '20057', po_ref: '5217475', ref_gr: null, adjusted: 458702.5, lines: [line('Telor Curah', 766.4, 25100)] },
    { number: '64', date: '2026-01-30', party_id: 2, party_name: 'PT. Agrinesia Raya', hh_branch: 0, ref_pi: 'INV-000001', po_ref: '260002645-0', ref_gr: null, adjusted: 120000, lines: [line('Telor Curah', 2025, 26800), line('Telor Putih', 975, 26800)] },
    { number: '54', date: '2026-01-08', party_id: 3, party_name: 'Damar Agung PP', hh_branch: 0, adjusted: -30000, lines: [line('Telor Curah', 1799.76, 27800)] },
  ];
  const term = { 1: 30, 2: 45, 3: 7 };
  const r = esbSalesAoa(invs, (i) => term[i.party_id]);
  assert.equal(r.aoa[0], ESB_SALES_HELP);
  assert.equal(r.aoa[1], ESB_SALES_HEADER);
  assert.equal(r.count, 3);
  for (const row of r.aoa) assert.equal(row.length, 29);
  assert.deepEqual(r.aoa[2], ['1', 'Goods', 'Hari - Hari Swalayan', null, null, '21/08/2025', 'Head Office', 'Main Warehouse', 'Credit', null, 30, null, 'IDR', 1, 'Item', 'Telur Curah', null, 'Kg', 766.4, 25100, null,
    458702.5, 'NO', null, null, null, null, 'Hari-Hari Duta Harapan Indah - No GD :7952, No PI :20057, No PO :5217475, No GR Client :', null]);
  // customer biasa: nama sendiri, 1 Sequence untuk 2 barang, Additional Info hanya di baris teratas
  assert.deepEqual(r.aoa.slice(3, 5).map((x) => [x[0], x[2], x[10], x[15], x[18], x[21], x[27]]), [
    ['2', 'PT. Agrinesia Raya', 45, 'Telur Curah', 2025, null, 'PT. Agrinesia Raya - No GD :64, No PI :INV-000001, No PO :260002645-0, No GR Client :'],
    ['2', 'PT. Agrinesia Raya', 45, 'Telur Putih', 975, null, null],
  ]);
  // retur/penyesuaian customer biasa tidak dijadikan Disc Value (Disc kosong di atas), hanya dilaporkan
  assert.deepEqual(r.adjusted, ['64 (PT. Agrinesia Raya)', '54 (Damar Agung PP)']);
});
