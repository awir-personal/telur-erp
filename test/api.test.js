// Tes alur API lengkap terhadap database TERPISAH (telur_erp_test_zz) yang dibuat & dihapus sendiri.
// Butuh MySQL lokal menyala. Tidak pernah menyentuh telur_erp_db.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { createPool, migrate, connConfig } = require('../server/db');
const { createApp } = require('../server/app');
const sample = require('./fixtures/sheet-sample');

const DB = 'telur_erp_test_zz';
let pool, server, base;

async function dropDb() {
  const cfg = connConfig(DB);
  const c = await mysql.createConnection({ ...cfg, database: undefined });
  await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await c.end();
}

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const ok = async (p) => { const r = await p; assert.ok(r.status < 300, `${r.status} ${JSON.stringify(r.body)}`); return r.body; };

test.before(async () => {
  await dropDb();
  pool = await createPool(DB);
  await migrate(pool);
  await migrate(pool); // migrasi idempoten
  const app = createApp(pool, { setupCode: 'kode-uji', loginDelayMs: 0, quiet: true });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(async () => {
  server?.close();
  await pool?.end();
  await dropDb();
});

const S = {};

test('setup master pertama, hanya sekali, wajib kode setup', async () => {
  assert.equal((await ok(call('GET', '/auth/status'))).needsSetup, true);
  assert.equal((await call('POST', '/auth/setup', { name: 'Bos', pin: '135790', setupCode: 'salah' })).status, 400);
  assert.equal((await call('POST', '/auth/setup', { name: 'Bos', pin: '111111', setupCode: 'kode-uji' })).status, 400); // PIN lemah
  await ok(call('POST', '/auth/setup', { name: 'Bos', pin: '135790', setupCode: 'kode-uji' }));
  assert.equal((await call('POST', '/auth/setup', { name: 'Lain', pin: '135790', setupCode: 'kode-uji' })).status, 400);
  S.master = (await ok(call('POST', '/auth/login', { name: 'bos', pin: '135790' }))).token; // nama tidak peka huruf besar
});

test('master buat user, PIN sementara wajib diganti, reset PIN, kunci setelah 5x salah', async () => {
  assert.equal((await call('GET', '/users')).status, 401);
  const a = await ok(call('POST', '/users', { name: 'Admin1', role: 'admin' }, S.master));
  const f = await ok(call('POST', '/users', { name: 'Fin1', role: 'finance' }, S.master));
  assert.match(a.tempPin, /^\d{6}$/);
  const la = await ok(call('POST', '/auth/login', { name: 'Admin1', pin: a.tempPin }));
  assert.equal(la.user.must_change_pin, 1);
  assert.equal((await call('GET', '/parties', null, la.token)).status, 403); // belum ganti PIN
  await ok(call('POST', '/auth/change-pin', { oldPin: a.tempPin, newPin: '246813' }, la.token));
  S.admin = la.token;
  assert.equal((await call('GET', '/parties', null, S.admin)).status, 200);

  const lf = await ok(call('POST', '/auth/login', { name: 'Fin1', pin: f.tempPin }));
  await ok(call('POST', '/auth/change-pin', { oldPin: f.tempPin, newPin: '975310' }, lf.token));
  S.fin = lf.token;

  // User list tidak pernah memuat PIN/hash
  const users = await ok(call('GET', '/users', null, S.master));
  assert.ok(users.every((u) => !('pin_hash' in u)));
  assert.equal((await call('GET', '/users', null, S.admin)).status, 403);

  // 5x salah → terkunci, PIN benar pun ditolak; reset master membuka kunci
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/login', { name: 'Fin1', pin: '000001' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { name: 'Fin1', pin: '975310' })).status, 429);
  const reset = await ok(call('POST', `/users/${f.id}/reset-pin`, null, S.master));
  assert.equal((await call('GET', '/auth/me', null, S.fin)).status, 401); // sesi lama diputus
  const lf2 = await ok(call('POST', '/auth/login', { name: 'Fin1', pin: reset.tempPin }));
  await ok(call('POST', '/auth/change-pin', { oldPin: reset.tempPin, newPin: '864209' }, lf2.token));
  S.fin = lf2.token;

  // Master terakhir tidak bisa dinonaktifkan
  const me = (await ok(call('GET', '/auth/me', null, S.master))).user;
  assert.equal((await call('PUT', `/users/${me.id}`, { active: false }, S.master)).status, 400);
});

test('master data + hak akses per peran', async () => {
  const c = await ok(call('POST', '/parties', { kind: 'customer', name: 'Toko Uji 2099', term_days: 14 }, S.admin));
  S.cust = c.id;
  S.cust2 = (await ok(call('POST', '/parties', { kind: 'customer', name: 'Toko Lain 2099' }, S.admin))).id;
  S.supp = (await ok(call('POST', '/parties', { kind: 'supplier', name: 'Peternak Uji 2099' }, S.admin))).id;
  assert.equal((await call('POST', '/parties', { kind: 'customer', name: 'toko uji 2099' }, S.admin)).status, 400); // dobel
  assert.equal((await call('POST', '/parties', { kind: 'customer', name: 'X' }, S.fin)).status, 403);
  const items = await ok(call('GET', '/items', null, S.fin));
  S.curah = items.find((i) => i.name === 'Telor Curah').id;
  S.putih = items.find((i) => i.name === 'Telor Putih').id;
  const units = await ok(call('GET', '/units', null, S.fin));
  S.kg = units.find((u) => u.name === 'kg').id;
  S.ikat = units.find((u) => u.name === 'ikat').id;
  await ok(call('PUT', `/parties/${S.cust}/prices`, { prices: [{ item_id: S.curah, unit_id: S.kg, price: 28500 }] }, S.admin));
  const sug = await ok(call('GET', `/price-suggest?party_id=${S.cust}&item_id=${S.curah}&unit_id=${S.kg}`, null, S.admin));
  assert.deepEqual(sug, { price: 28500, source: 'master' });
});

test('invoice penjualan: nomor otomatis, jatuh tempo dari termin, finance tidak bisa buat', async () => {
  await ok(call('PUT', '/settings', { next_sale_no: 5000 }, S.master));
  const body = { kind: 'sale', date: '2099-01-10', party_id: S.cust, lines: [{ item_id: S.curah, unit_id: S.kg, qty: 100.8, price: 29000, cost_price: 27000 }] };
  assert.equal((await call('POST', '/invoices', body, S.fin)).status, 403);
  const a = await ok(call('POST', '/invoices', body, S.admin));
  assert.equal(a.number, '5000');
  const b = await ok(call('POST', '/invoices', { ...body, lines: [{ item_id: S.putih, unit_id: S.ikat, qty: 2, price: 420000 }] }, S.admin));
  assert.equal(b.number, '5001');
  const manual = await ok(call('POST', '/invoices', { ...body, number: '5010' }, S.admin));
  assert.equal(manual.number, '5010');
  assert.equal((await ok(call('POST', '/invoices', body, S.admin))).number, '5011'); // penghitung ikut maju
  assert.equal((await call('POST', '/invoices', { ...body, number: '5000' }, S.admin)).status, 400); // dobel
  assert.equal((await call('POST', '/invoices', { ...body, party_id: S.supp }, S.admin)).status, 400); // supplier bukan customer
  assert.equal((await call('POST', '/invoices', { ...body, lines: [] }, S.admin)).status, 400);

  const inv = await ok(call('GET', `/invoices/${a.id}`, null, S.fin));
  assert.equal(inv.total, 2923200);
  assert.equal(inv.due_date, '2099-01-24'); // termin 14 hari
  assert.equal(inv.margin, 201600);
  assert.equal(inv.status, 'belum');
  S.invA = a.id; S.invB = b.id; S.invManual = manual.id;
});

test('pembayaran: banyak bayar ke 1 invoice, 1 bayar ke banyak invoice, batas alokasi', async () => {
  const pay = (body, tok = S.fin) => call('POST', '/payments', { kind: 'sale', party_id: S.cust, method: 'transfer', date: '2099-01-15', ...body }, tok);
  assert.equal((await pay({ amount: 1000, allocations: [] }, S.admin)).status, 403); // admin bukan validator bayar
  await ok(pay({ amount: 1000000, allocations: [{ invoice_id: S.invA, amount: 1000000 }] }));
  await ok(pay({ amount: 900000, method: 'cash', allocations: [{ invoice_id: S.invA, amount: 900000 }] }));
  let inv = await ok(call('GET', `/invoices/${S.invA}`, null, S.fin));
  assert.equal(inv.status, 'sebagian');
  assert.equal(inv.allocations.length, 2);
  assert.equal(inv.outstanding, 1023200);

  // alokasi melebihi sisa ditolak; total alokasi > nominal ditolak
  assert.equal((await pay({ amount: 2000000, allocations: [{ invoice_id: S.invA, amount: 1023201 }] })).status, 400);
  assert.equal((await pay({ amount: 100, allocations: [{ invoice_id: S.invA, amount: 200 }] })).status, 400);
  // invoice customer lain ditolak
  const other = await ok(call('POST', '/invoices', { kind: 'sale', date: '2099-01-10', party_id: S.cust2, lines: [{ item_id: S.curah, unit_id: S.kg, qty: 1, price: 1 }] }, S.admin));
  assert.equal((await pay({ amount: 1, allocations: [{ invoice_id: other.id, amount: 1 }] })).status, 400);

  // satu transfer melunasi sisa A + seluruh B, kurang 113 rupiah, plus sisa 50.000 belum dialokasi
  const p = await ok(pay({ amount: 1023200 + 840000 - 113 + 50000, allocations: [{ invoice_id: S.invA, amount: 1023200 - 113 }, { invoice_id: S.invB, amount: 840000 }] }));
  inv = await ok(call('GET', `/invoices/${S.invA}`, null, S.fin));
  assert.equal(inv.outstanding, 113);
  assert.equal((await ok(call('GET', `/invoices/${S.invB}`, null, S.fin))).status, 'lunas');
  const pd = await ok(call('GET', `/payments/${p.id}`, null, S.fin));
  assert.equal(pd.unallocated, 50000);
  S.bigPay = p.id;

  // tidak bisa hapus invoice yang sudah dibayar
  assert.equal((await call('DELETE', `/invoices/${S.invA}`, null, S.admin)).status, 400);
});

test('selisih: tombol pembulatan, penyesuaian retur, hanya finance/master', async () => {
  assert.equal((await call('POST', `/invoices/${S.invA}/round`, {}, S.admin)).status, 403);
  await ok(call('POST', `/invoices/${S.invA}/round`, { date: '2099-01-15' }, S.fin));
  let inv = await ok(call('GET', `/invoices/${S.invA}`, null, S.fin));
  assert.equal(inv.status, 'lunas');
  assert.equal(inv.adjustments[0].type, 'pembulatan');
  assert.equal(inv.adjustments[0].amount, 113);
  assert.equal((await call('POST', `/invoices/${S.invA}/round`, {}, S.fin)).status, 400); // sudah 0

  // retur mengurangi tagihan invoice manual; keterangan wajib
  assert.equal((await call('POST', `/invoices/${S.invManual}/adjustments`, { date: '2099-01-12', type: 'retur', amount: 290000, qty: 10 }, S.fin)).status, 400);
  await ok(call('POST', `/invoices/${S.invManual}/adjustments`, { date: '2099-01-12', type: 'retur', amount: 290000, qty: 10, note: 'Return 10kg' }, S.fin));
  inv = await ok(call('GET', `/invoices/${S.invManual}`, null, S.fin));
  assert.equal(inv.outstanding, 2923200 - 290000);

  // pembulatan lebih bayar: alokasi dari pembayaran besar, lalu bulatkan negatif
  const pd = await ok(call('GET', `/payments/${S.bigPay}`, null, S.fin));
  await ok(call('PUT', `/payments/${S.bigPay}`, { ...pd, allocations: [...pd.allocations, { invoice_id: S.invManual, amount: 50000 }] }, S.fin));
  assert.equal((await ok(call('GET', `/payments/${S.bigPay}`, null, S.fin))).unallocated, 0);
});

test('laporan aging & margin & stok', async () => {
  const aging = await ok(call('GET', '/reports/aging?kind=sale&as_of=2099-03-01', null, S.fin));
  const row = aging.rows.find((r) => r.party_name === 'Toko Uji 2099');
  const manual = await ok(call('GET', `/invoices/${S.invManual}`, null, S.fin));
  assert.ok(row.total > 0);
  assert.ok(row.invoices.some((i) => i.id === S.invManual && i.outstanding === manual.outstanding && i.bucket === 'd31_60'));
  assert.ok(!row.invoices.some((i) => i.id === S.invA)); // lunas tidak muncul

  await ok(call('POST', '/invoices', { kind: 'purchase', date: '2099-01-09', party_id: S.supp, lines: [{ item_id: S.curah, unit_id: S.ikat, qty: 20, price: 400000 }] }, S.admin));
  const stock = await ok(call('GET', '/reports/stock?from=2099-01-01&to=2099-01-31', null, S.fin));
  const cur = stock.items.find((i) => i.item === 'Telor Curah' && i.unit === 'kg');
  assert.equal(cur.in, 300); // 20 ikat × 15 kg
  assert.ok(cur.out > 0);

  const margin = await ok(call('GET', '/reports/margin?from=2099-01-01&to=2099-01-31', null, S.fin));
  assert.equal(margin.rows.find((r) => r.id === S.invA).margin, 201600);
  assert.equal(margin.rows.find((r) => r.id === S.invB).missingCost, 1);
});

test('import sheet contoh: preview, commit, selisih 3860 muncul & bisa dijustifikasi', async () => {
  assert.equal((await call('POST', '/import/preview', { rows: sample }, S.fin)).status, 403);
  const prev = await ok(call('POST', '/import/preview', { rows: sample }, S.admin));
  assert.equal(prev.invoices.length, 17); // v3.3: 1 baris sheet = 1 invoice, 3860 (2 baris) jadi 2 invoice
  const res = await ok(call('POST', '/import/commit', { rows: sample }, S.admin));
  assert.equal(res.imported.length, 17);
  assert.ok(res.imported.includes('3860 (baris 12)') && res.imported.includes('3860 (baris 13)'));
  assert.ok(res.created.customers.includes('Home Made'));
  assert.ok(res.created.items.length === 0); // semua barang sudah ada di master
  const again = await ok(call('POST', '/import/commit', { rows: sample }, S.admin));
  assert.equal(again.imported.length, 0); // tidak dobel, termasuk kedua baris 3860
  assert.equal(again.skipped.length, 17);
  assert.ok(again.skipped.includes('3860 (baris 13): baris ini sudah pernah diimport'));
  assert.ok((await ok(call('POST', '/import/preview', { rows: sample }, S.admin))).invoices.every((i) => i.exists));

  // 3860: 2 invoice bernomor sama, data tiap baris apa adanya; Nominal baris ke-2 membayar keduanya
  const list = await ok(call('GET', '/invoices?kind=sale&q=3860', null, S.fin));
  const both = list.filter((x) => x.number === '3860').sort((x, y) => x.import_seq - y.import_seq);
  assert.equal(both.length, 2);
  const [i3860, i3860b] = both;
  assert.deepEqual([i3860.import_seq, i3860.total, i3860.importDiff, i3860.diffOpen], [1, 9057043, 16070, true]);
  assert.deepEqual([i3860b.import_seq, i3860b.total, i3860b.paid, i3860b.status, i3860b.importDiff], [2, 2160000, 2160000, 'lunas', 0]);
  assert.equal(i3860.paid, 10933000 - 2160000);
  for (const x of both) assert.deepEqual([x.dupCount, x.dupOpen], [2, true]);
  const pays3860 = await ok(call('GET', `/payments?kind=sale&party_id=${i3860.party_id}`, null, S.fin));
  assert.equal(pays3860.find((p) => p.amount === 10933000).unallocated, 0);
  const selisih = await ok(call('GET', '/invoices?kind=sale&status=selisih', null, S.fin));
  assert.equal(selisih.filter((x) => x.number === '3860').length, 2); // nomor dobel belum dicatat
  assert.ok(selisih.some((x) => x.number === '3858')); // harga kosong
  assert.equal((await ok(call('GET', '/dashboard', null, S.fin))).todo.dupOpen, 2);

  // catatan No Inv dobel -> hilang dari daftar tindak lanjut
  assert.equal((await call('PUT', `/invoices/${i3860b.id}/dup-note`, { dup_note: 'x' }, S.fin)).status, 200);
  await ok(call('PUT', `/invoices/${i3860b.id}/dup-note`, { dup_note: 'Baris tambahan Super (Cash) di invoice yang sama' }, S.fin));
  assert.equal((await ok(call('GET', `/invoices/${i3860b.id}`, null, S.fin))).dupOpen, false);
  assert.equal((await ok(call('GET', `/invoices/${i3860.id}`, null, S.fin))).dupOpen, true); // tiap invoice dicatat sendiri
  assert.equal((await ok(call('GET', '/dashboard', null, S.fin))).todo.dupOpen, 1);

  // invoice manual tetap tidak boleh memakai nomor yang sudah ada; invoice dobel hasil import tetap bisa diedit
  const manualBody = { kind: 'sale', date: '2026-01-02', party_id: i3860.party_id, lines: [{ item_id: S.curah, unit_id: S.kg, qty: 1, price: 1 }] };
  assert.equal((await call('POST', '/invoices', { ...manualBody, number: '3860' }, S.admin)).status, 400);
  const full = await ok(call('GET', `/invoices/${i3860b.id}`, null, S.fin));
  await ok(call('PUT', `/invoices/${i3860b.id}`, { ...manualBody, number: '3860', notes: 'diedit', lines: full.lines.map((l) => ({ item_id: l.item_id, unit_id: l.unit_id, qty: l.qty, price: l.price })) }, S.admin));
  assert.equal((await ok(call('GET', `/invoices/${i3860b.id}`, null, S.fin))).notes, 'diedit');

  // nomor yang dulu diimport dengan cara LAMA (digabung, import_seq NULL) / diketik manual -> semua barisnya dilewati
  const legacy = await ok(call('POST', '/invoices', { ...manualBody, number: 'LAMA-2099' }, S.admin));
  const rowsLegacy = [sample[0], sample[1], ...[1, 2].map(() => ['5-Jan-99', 'LAMA-2099', 'Cash', '1', '1.000', ...Array(10).fill(''), '1.000', '', '', ''])];
  const rl = await ok(call('POST', '/import/commit', { rows: rowsLegacy }, S.admin));
  assert.deepEqual([rl.imported.length, rl.skipped], [0, ['LAMA-2099 (baris 3): nomor sudah ada', 'LAMA-2099 (baris 4): nomor sudah ada']]);
  await ok(call('DELETE', `/invoices/${legacy.id}`, null, S.admin));

  assert.equal((await call('POST', `/invoices/${i3860.id}/accept-import-total`, {}, S.fin)).status, 400); // alasan wajib
  await ok(call('POST', `/invoices/${i3860.id}/accept-import-total`, { note: 'Ongkir 16.070 tidak tercatat di kolom' }, S.fin));
  const after = await ok(call('GET', `/invoices/${i3860.id}`, null, S.fin));
  assert.equal(after.diffOpen, false);
  assert.equal(after.outstanding, 9073113 - (10933000 - 2160000)); // = 300.113, sama seperti saat masih digabung

  const s = await ok(call('GET', '/settings', null, S.fin));
  assert.ok(Number(s.next_sale_no) >= 5012);

  // Nominal di sheet lebih besar dari invoice → sisanya jadi saldo belum dialokasi, bukan lebih bayar.
  const over = [sample[0], sample[1], ['5-Jan-99', 'X99', 'Lebih Bayar 2099', '10', '1.000', ...Array(10).fill(''), '10.000', '5-Jan-99', '15.000,00', 'Cash']];
  await ok(call('POST', '/import/commit', { rows: over }, S.admin));
  const [inv] = await ok(call('GET', '/invoices?kind=sale&q=X99', null, S.fin));
  assert.equal(inv.status, 'lunas');
  assert.equal(inv.paid, 10000);
  const pays = await ok(call('GET', `/payments?kind=sale&party_id=${inv.party_id}`, null, S.fin));
  assert.equal(pays[0].unallocated, 5000);
});

test('nomor otomatis melompati nomor yang sudah terpakai', async () => {
  await ok(call('PUT', '/settings', { next_sale_no: 5000 }, S.master)); // 5000, 5001 sudah ada
  const r = await ok(call('POST', '/invoices', { kind: 'sale', date: '2099-02-01', party_id: S.cust, lines: [{ item_id: S.curah, unit_id: S.kg, qty: 1, price: 1 }] }, S.admin));
  assert.equal(r.number, '5002');
});

test('v2 Kas & Bank: saldo = saldo awal + penerimaan − pembayaran − biaya ± transfer', async () => {
  const accs = await ok(call('GET', '/accounts', null, S.fin));
  const kas = accs.find((a) => a.name === 'Kas Tunai');
  assert.ok(kas);
  assert.equal((await call('POST', '/accounts', { name: 'BCA 2099', type: 'bank' }, S.admin)).status, 403); // admin bukan pengelola kas
  const bca = await ok(call('POST', '/accounts', { name: 'BCA 2099', type: 'bank', bank: 'BCA', opening_balance: 1000000, opening_date: '2099-03-01' }, S.fin));
  S.bca = bca.id; S.kas = kas.id;
  const cats = await ok(call('GET', '/cash/categories', null, S.fin));
  const ongkir = cats.find((c) => c.name === 'Transport & Ongkir');
  const modal = cats.find((c) => c.kind === 'modal');

  // penerimaan customer ke BCA (rekening opsional: tanpa rekening tetap boleh)
  await ok(call('POST', '/payments', { kind: 'sale', party_id: S.cust, method: 'transfer', date: '2099-03-02', amount: 500000, account_id: S.bca, allocations: [] }, S.fin));
  await ok(call('POST', '/payments', { kind: 'sale', party_id: S.cust, method: 'cash', date: '2099-03-02', amount: 7000, allocations: [] }, S.fin));
  // bayar supplier dari BCA
  await ok(call('POST', '/payments', { kind: 'purchase', party_id: S.supp, method: 'transfer', date: '2099-03-03', amount: 200000, account_id: S.bca, allocations: [] }, S.fin));
  // biaya, setor modal ke kas, transfer BCA → kas
  await ok(call('POST', '/cash/txns', { kind: 'biaya', date: '2099-03-04', account_id: S.bca, category_id: ongkir.id, amount: 25000, note: 'Ongkir' }, S.fin));
  await ok(call('POST', '/cash/txns', { kind: 'modal', date: '2099-03-04', account_id: S.kas, category_id: modal.id, amount: 300000 }, S.fin));
  await ok(call('POST', '/cash/txns', { kind: 'transfer', date: '2099-03-05', account_id: S.bca, to_account_id: S.kas, amount: 100000 }, S.fin));
  // sebelum tanggal saldo awal: tidak dihitung (sudah termasuk saldo awal)
  await ok(call('POST', '/cash/txns', { kind: 'biaya', date: '2099-02-20', account_id: S.bca, category_id: ongkir.id, amount: 999, note: 'lama' }, S.fin));
  // validasi
  const same = await call('POST', '/cash/txns', { kind: 'transfer', date: '2099-03-05', account_id: S.bca, to_account_id: S.bca, amount: 1 }, S.fin);
  assert.equal(same.status, 400);
  assert.match(same.body.error, /tidak boleh sama/);
  assert.equal((await call('POST', '/cash/txns', { kind: 'biaya', date: '2099-03-05', account_id: S.bca, category_id: modal.id, amount: 1 }, S.fin)).status, 400);
  assert.equal((await call('POST', '/cash/txns', { kind: 'biaya', date: '2099-03-05', account_id: S.bca, category_id: ongkir.id, amount: 1 }, S.admin)).status, 403);

  const bal = await ok(call('GET', '/cash/balances?as_of=2099-03-31', null, S.fin));
  const b = bal.accounts.find((a) => a.id === S.bca);
  assert.equal(b.balance, 1000000 + 500000 - 200000 - 25000 - 100000);
  assert.equal(b.ignoredBeforeOpening, 1);
  assert.equal(bal.accounts.find((a) => a.id === S.kas).balance, 300000 + 100000);
  assert.ok(bal.paymentsWithoutAccount.count >= 1);

  const led = await ok(call('GET', `/cash/ledger?account_id=${S.bca}&from=2099-03-03&to=2099-03-31`, null, S.fin));
  assert.equal(led.opening, 1500000); // saldo awal + penerimaan 2 Mar
  assert.equal(led.closing, 1175000);
  assert.equal(led.rows.at(-1).balance, 1175000);
  assert.deepEqual(led.rows.map((x) => x.amount), [-200000, -25000, -100000]);
});

test('v2 dashboard: piutang lewat jatuh tempo, hal yang perlu ditindaklanjuti, saldo kas', async () => {
  // invoice yang BELUM jatuh tempo (30 Mar + termin 14 hari) tidak boleh ikut dihitung lewat jatuh tempo
  await ok(call('POST', '/invoices', { kind: 'sale', date: '2099-03-30', party_id: S.cust, lines: [{ item_id: S.curah, unit_id: S.kg, qty: 10, price: 30000 }] }, S.admin));
  const d = await ok(call('GET', '/dashboard?today=2099-03-31', null, S.fin));
  assert.ok(d.receivable.total > 0);
  assert.ok(d.receivable.overdue > 0);
  assert.ok(d.receivable.total - d.receivable.overdue >= 300000);
  assert.ok(d.topOverdue.some((p) => p.party_name === 'Toko Uji 2099'));
  assert.ok(d.todo.zeroPrice >= 1); // 3858 Adi D
  assert.ok(d.todo.unallocatedSale >= 507000);
  assert.equal(d.cash.find((c) => c.id === S.bca).balance, 1175000);
});

test('v3 rekonsiliasi bank: impor, auto-cocok, cocok manual (isi rekening), buat biaya dari mutasi, saldo sama', async () => {
  const pay7000 = (await ok(call('GET', `/payments?kind=sale&party_id=${S.cust}`, null, S.fin))).find((p) => p.amount === 7000 && !p.account_id);
  assert.ok(pay7000);
  const rows = [
    ['Post Date', 'Description', 'Debit', 'Credit', 'Balance'],
    ['02/03/2099', 'TRF MASUK TOKO UJI', '0.00', '500,000.00', '1,500,000.00'],
    ['02/03/2099', 'SETOR TUNAI', '0.00', '7,000.00', '1,507,000.00'],
    ['03/03/2099', 'TRF KE PETERNAK', '200,000.00', '0.00', '1,307,000.00'],
    ['04/03/2099', 'ONGKIR', '25,000.00', '0.00', '1,282,000.00'],
    ['05/03/2099', 'PINDAH KE KAS', '100,000.00', '0.00', '1,182,000.00'],
    ['06/03/2099', 'BIAYA ADM', '6,500.00', '0.00', '1,175,500.00'],
  ];
  assert.equal((await call('POST', '/recon/import', { account_id: S.bca, rows }, S.admin)).status, 403);
  const prev = await ok(call('POST', '/recon/preview', { account_id: S.bca, rows }, S.fin));
  assert.equal(prev.lines.length, 6);
  assert.equal(prev.direction, 'debet_keluar');
  const imp = await ok(call('POST', '/recon/import', { account_id: S.bca, rows }, S.fin));
  assert.deepEqual([imp.inserted, imp.autoMatched], [6, 4]);
  const again = await ok(call('POST', '/recon/import', { account_id: S.bca, rows }, S.fin));
  assert.deepEqual([again.inserted, again.duplicates], [0, 6]);

  const lines = await ok(call('GET', `/recon/lines?account_id=${S.bca}`, null, S.fin));
  const setor = lines.find((l) => l.description === 'SETOR TUNAI');
  const adm = lines.find((l) => l.description === 'BIAYA ADM');
  assert.equal(setor.status, 'unmatched'); // pembayaran tanpa rekening tidak dicocokkan otomatis
  const cand = await ok(call('GET', `/recon/candidates?line_id=${setor.id}`, null, S.fin));
  assert.ok(cand.exact.some((c) => c.src === 'payment' && c.id === pay7000.id && c.assigned === false));
  // arah berbeda ditolak
  const out = lines.find((l) => l.description === 'ONGKIR');
  assert.equal((await call('POST', `/recon/lines/${out.id}/unmatch`, {}, S.fin)).status, 200);
  assert.equal((await call('POST', `/recon/lines/${out.id}/match`, { src: 'payment', id: pay7000.id }, S.fin)).status, 400);
  await ok(call('POST', '/recon/auto-match', { account_id: S.bca }, S.fin)); // ongkir dicocokkan lagi
  await ok(call('POST', `/recon/lines/${setor.id}/match`, { src: 'payment', id: pay7000.id }, S.fin));
  assert.equal((await ok(call('GET', `/payments/${pay7000.id}`, null, S.fin))).account_id, S.bca); // rekening terisi otomatis

  const cats = await ok(call('GET', '/cash/categories', null, S.fin));
  const adminBank = cats.find((c) => c.name === 'Biaya Bank');
  assert.equal((await call('POST', `/recon/lines/${adm.id}/create-cash`, { category_id: cats.find((c) => c.kind === 'pemasukan').id }, S.fin)).status, 400);
  const created = await ok(call('POST', `/recon/lines/${adm.id}/create-cash`, { category_id: adminBank.id }, S.fin));
  assert.equal((await call('DELETE', `/cash/txns/${created.id}`, null, S.fin)).status, 400); // sudah direkonsiliasi

  assert.equal((await call('DELETE', `/payments/${pay7000.id}`, null, S.fin)).status, 400); // sudah direkonsiliasi

  const sum = await ok(call('GET', `/recon/summary?account_id=${S.bca}`, null, S.fin));
  assert.equal(sum.statement.balance, 1175500);
  assert.equal(sum.system.balance, 1175500);
  assert.equal(sum.difference, 0);
  assert.equal(sum.counts.matched.n, 6);
  assert.equal(sum.counts.unmatched, undefined);
  assert.equal((await call('POST', `/recon/lines/${adm.id}/ignore`, {}, S.fin)).status, 400); // alasan wajib

  // Ragu: dua biaya 12.345 berjarak sama dari mutasi → tidak dicocokkan otomatis.
  const lain = cats.find((c) => c.name === 'Lain-lain');
  await ok(call('POST', '/cash/txns', { kind: 'biaya', date: '2099-03-09', account_id: S.bca, category_id: lain.id, amount: 12345 }, S.fin));
  await ok(call('POST', '/cash/txns', { kind: 'biaya', date: '2099-03-11', account_id: S.bca, category_id: lain.id, amount: 12345 }, S.fin));
  const imp2 = await ok(call('POST', '/recon/import', { account_id: S.bca, rows: [['Post Date', 'Description', 'Debit', 'Credit'], ['10/03/2099', 'DUA KANDIDAT', '12,345.00', '0.00']] }, S.fin));
  assert.deepEqual([imp2.inserted, imp2.autoMatched], [1, 0]);
});

test('v3 laporan keuangan: neraca seimbang, HPP periodik dengan nilai persediaan, jurnal memorial', async () => {
  // Barang baru: beli 100 kg @25.000, jual 40 kg → sisa 60 kg bernilai 1.500.000
  const it = await ok(call('POST', '/items', { name: 'Telor Uji 2099', default_unit_id: S.kg, sort_order: 999 }, S.admin));
  await ok(call('POST', '/invoices', { kind: 'purchase', date: '2099-04-01', party_id: S.supp, lines: [{ item_id: it.id, unit_id: S.kg, qty: 100, price: 25000 }] }, S.admin));
  await ok(call('POST', '/invoices', { kind: 'sale', date: '2099-04-02', party_id: S.cust, lines: [{ item_id: it.id, unit_id: S.kg, qty: 40, price: 30000, cost_price: 25000 }] }, S.admin));
  const pl = await ok(call('GET', '/reports/profit-loss?from=2099-04-01&to=2099-04-30', null, S.fin));
  assert.equal(pl.purchases, 2500000);
  assert.equal(pl.inventory.find((x) => x.item === 'Telor Uji 2099').value, 1500000);
  assert.equal(pl.hpp, pl.purchases - pl.purchAdj + pl.invStart - pl.invEnd);
  assert.equal(pl.netIncome, pl.gross + pl.totalOther - pl.totalExp);
  assert.equal(pl.control.hppTyped, 1000000); // 40 kg × 25.000
  assert.equal(pl.sales, 1200000);
  // Telor Curah dijual jauh lebih banyak dari yang dibeli → stok negatif dinilai 0, bukan minus.
  const curah = pl.inventory.find((x) => x.item === 'Telor Curah');
  assert.ok(curah.negative && curah.qty < 0);
  assert.equal(curah.value, 0);

  const bs = await ok(call('GET', '/reports/balance-sheet?as_of=2099-12-31', null, S.fin));
  assert.equal(bs.difference, 0);
  assert.equal(bs.unknown.length, 0);
  assert.equal(bs.assets.find((a) => a.code === `1101-${S.bca}`).amount, 1175500 - 12345 * 2);
  // Uang Muka Pelanggan = sisa penerimaan customer yang belum dialokasikan.
  const pays = await ok(call('GET', '/payments?kind=sale', null, S.fin));
  const unalloc = pays.reduce((s, p) => s + p.unallocated, 0);
  assert.ok(unalloc > 0);
  assert.equal(bs.liabilities.find((x) => x.code === '2201').amount, Math.round(unalloc * 100) / 100);
  const tb = await ok(call('GET', '/reports/ledger?from=2099-01-01&to=2099-12-31', null, S.fin));
  assert.equal(tb.totals.debit, tb.totals.credit);

  // Jurnal memorial: tidak seimbang ditolak; seimbang masuk & neraca tetap seimbang
  const coa = await ok(call('GET', '/coa', null, S.fin));
  const exp = coa.find((c) => c.group === 'biaya').code;
  assert.equal((await call('POST', '/journals', { date: '2099-04-30', memo: 'x', lines: [{ coa: exp, debit: 100 }, { coa: '3101', credit: 90 }] }, S.fin)).status, 400);
  assert.equal((await call('POST', '/journals', { date: '2099-04-30', memo: 'x', lines: [{ coa: 'ngawur', debit: 100 }, { coa: '3101', credit: 100 }] }, S.fin)).status, 400);
  await ok(call('POST', '/journals', { date: '2099-04-30', memo: 'Penyusutan timbangan', lines: [{ coa: exp, debit: 50000 }, { coa: '3101', credit: 50000 }] }, S.fin));
  const bs2 = await ok(call('GET', '/reports/balance-sheet?as_of=2099-12-31', null, S.fin));
  assert.equal(bs2.difference, 0);
  const j = await ok(call('GET', '/reports/journal?from=2099-04-30&to=2099-04-30', null, S.fin));
  assert.ok(j.entries.some((e) => e.src === 'manual' && e.memo === 'Penyusutan timbangan'));
  for (const e of (await ok(call('GET', '/reports/journal?from=2099-01-01&to=2099-12-31', null, S.fin))).entries) {
    const d = e.lines.reduce((s, l) => s + l.debit, 0);
    const c = e.lines.reduce((s, l) => s + l.credit, 0);
    assert.ok(Math.abs(d - c) < 0.005, `jurnal tidak seimbang: ${e.memo}`);
  }
  const cf = await ok(call('GET', '/reports/cashflow?from=2099-03-01&to=2099-03-31', null, S.fin));
  assert.ok(cf.rows.some((x) => x.label === 'Penerimaan dari customer'));
});

test('v3 backup → restore ke database kosong menghasilkan laporan yang sama', async () => {
  assert.equal((await call('GET', '/backup', null, S.fin)).status, 403);
  const res = await fetch(base + '/backup', { headers: { authorization: `Bearer ${S.master}` } });
  assert.equal(res.status, 200);
  const file = require('path').join(require('os').tmpdir(), `telur-backup-test-${process.pid}.json.gz`);
  require('fs').writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const { restore } = require('../scripts/restore');
  const RDB = 'telur_erp_restoretest_zz';
  const drop = async () => { const c = await mysql.createConnection({ ...connConfig(RDB), database: undefined }); await c.query(`DROP DATABASE IF EXISTS \`${RDB}\``); await c.end(); };
  await drop();
  const rpool = await createPool(RDB);
  try {
    const r = await restore(rpool, file);
    assert.ok(r.counts.invoices > 20);
    await assert.rejects(restore(rpool, file), /tidak kosong/); // tidak pernah menimpa database berisi
    const J = require('../server/journal');
    const a = await J.balanceSheet(pool, '2099-12-31');
    const b = await J.balanceSheet(rpool, '2099-12-31');
    assert.deepEqual([b.totalAssets, b.totalLE, b.difference], [a.totalAssets, a.totalLE, a.difference]);
    const d = await ok(call('GET', '/dashboard?today=2099-03-31', null, S.master));
    assert.ok(d.lastBackupAt);
  } finally {
    await rpool.end();
    await drop();
    require('fs').rmSync(file, { force: true });
  }
});

test('log aktivitas mencatat siapa melakukan apa, tanpa PIN', async () => {
  const logs = await ok(call('GET', '/logs?limit=500', null, S.master));
  const actions = new Set(logs.map((l) => l.action));
  for (const a of ['setup', 'login', 'reset_pin', 'locked', 'create', 'adjust', 'import']) assert.ok(actions.has(a), a);
  assert.ok(!JSON.stringify(logs).match(/135790|246813|864209/));
  assert.equal((await call('GET', '/logs', null, S.fin)).status, 403);
});
