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
  assert.equal(prev.invoices.length, 16);
  const res = await ok(call('POST', '/import/commit', { rows: sample }, S.admin));
  assert.equal(res.imported.length, 16);
  assert.ok(res.created.customers.includes('Home Made'));
  assert.ok(res.created.items.length === 0); // semua barang sudah ada di master
  const again = await ok(call('POST', '/import/commit', { rows: sample }, S.admin));
  assert.equal(again.imported.length, 0); // tidak dobel
  assert.equal(again.skipped.length, 16);

  const list = await ok(call('GET', '/invoices?kind=sale&q=3860', null, S.fin));
  const i3860 = list.find((x) => x.number === '3860');
  assert.equal(i3860.total, 11217043);
  assert.equal(i3860.importDiff, 16070);
  assert.equal(i3860.diffOpen, true);
  assert.equal(i3860.paid, 10933000);
  const selisih = await ok(call('GET', '/invoices?kind=sale&status=selisih', null, S.fin));
  assert.ok(selisih.some((x) => x.number === '3860'));
  assert.ok(selisih.some((x) => x.number === '3858')); // harga kosong

  assert.equal((await call('POST', `/invoices/${i3860.id}/accept-import-total`, {}, S.fin)).status, 400); // alasan wajib
  await ok(call('POST', `/invoices/${i3860.id}/accept-import-total`, { note: 'Ongkir 16.070 tidak tercatat di kolom' }, S.fin));
  const after = await ok(call('GET', `/invoices/${i3860.id}`, null, S.fin));
  assert.equal(after.diffOpen, false);
  assert.equal(after.outstanding, 11233113 - 10933000);

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

test('log aktivitas mencatat siapa melakukan apa, tanpa PIN', async () => {
  const logs = await ok(call('GET', '/logs?limit=500', null, S.master));
  const actions = new Set(logs.map((l) => l.action));
  for (const a of ['setup', 'login', 'reset_pin', 'locked', 'create', 'adjust', 'import']) assert.ok(actions.has(a), a);
  assert.ok(!JSON.stringify(logs).match(/135790|246813|864209/));
  assert.equal((await call('GET', '/logs', null, S.fin)).status, 403);
});
