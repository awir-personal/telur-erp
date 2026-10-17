// Jurnal otomatis (double-entry) dari transaksi + jurnal memorial manual, dan laporan keuangan.
// HPP laporan = PERIODIK: pembelian bersih − kenaikan nilai persediaan (keputusan user v3.0).
// Nilai persediaan = sisa qty (masuk − keluar, satuan dinormalkan ke kg bila bisa) × harga beli rata-rata.
const { round2, addDays } = require('./calc');
const { loadInvoices } = require('./lib');

const FIXED = [
  ['1102', 'Kas/Bank belum ditentukan', 'aset'],
  ['1201', 'Piutang Usaha', 'aset'],
  ['1301', 'Persediaan Telur', 'aset'],
  ['1401', 'Uang Muka Pembelian', 'aset'],
  ['2101', 'Hutang Usaha', 'kewajiban'],
  ['2201', 'Uang Muka Pelanggan', 'kewajiban'],
  ['3101', 'Modal Pemilik', 'ekuitas'],
  ['3102', 'Prive (Penarikan Pemilik)', 'ekuitas'],
  ['3301', 'Ekuitas Saldo Awal', 'ekuitas'],
  ['4101', 'Penjualan', 'pendapatan'],
  ['4102', 'Retur, Potongan & Pembulatan Penjualan', 'pendapatan'],
  ['5101', 'Pembelian', 'hpp'],
  ['5102', 'Retur, Potongan & Pembulatan Pembelian', 'hpp'],
];

// Bagan akun: tetap + rekening kas/bank (1101-<id>) + kategori biaya (6-<id>) / pemasukan lain (42-<id>).
async function chartOfAccounts(db) {
  const [accs] = await db.query('SELECT id, name FROM accounts ORDER BY sort_order, id');
  const [cats] = await db.query('SELECT id, kind, name FROM cash_categories ORDER BY id');
  const coa = [
    ...accs.map((a) => [`1101-${a.id}`, `Kas & Bank: ${a.name}`, 'aset']),
    ...FIXED,
    ...cats.filter((c) => c.kind === 'pemasukan').map((c) => [`42-${c.id}`, `Pendapatan Lain: ${c.name}`, 'pendapatan']),
    ...cats.filter((c) => c.kind === 'biaya').map((c) => [`6-${c.id}`, `Biaya: ${c.name}`, 'biaya']),
  ];
  return new Map(coa.map(([code, name, group]) => [code, { code, name, group }]));
}

// Mutasi kas SEBELUM tanggal saldo awal rekening sudah termasuk di saldo awal itu (aturan sama dengan Kas & Bank),
// jadi sisi kasnya dibukukan ke Ekuitas Saldo Awal, bukan ke rekening. Biaya/pendapatannya tetap tercatat.
const cashCoaFor = (opening) => (accountId, date) => {
  if (!accountId) return '1102';
  const od = opening.get(Number(accountId));
  return od && date < od ? '3301' : `1101-${accountId}`;
};
const L = (coa, debit, credit) => ({ coa, debit: round2(debit || 0), credit: round2(credit || 0) });

// Semua jurnal sampai tanggal `to`.
async function buildEntries(db, to = '9999-12-31') {
  const [accRows] = await db.query('SELECT id, opening_date FROM accounts');
  const cashCoa = cashCoaFor(new Map(accRows.filter((a) => a.opening_date).map((a) => [a.id, a.opening_date])));
  const E = [];
  const add = (date, src, ref, memo, lines) => {
    const ls = lines.filter((l) => l.debit || l.credit);
    if (ls.length) E.push({ date, src, ref, memo, lines: ls });
  };
  const invs = await loadInvoices(db, 'i.date <= ?', [to]);
  for (const i of invs) {
    if (i.kind === 'sale') add(i.date, 'invoice', i.id, `Penjualan ${i.number} · ${i.party_name}`, [L('1201', i.total), L('4101', 0, i.total)]);
    else add(i.date, 'invoice', i.id, `Pembelian ${i.number} · ${i.party_name}`, [L('5101', i.total), L('2101', 0, i.total)]);
  }
  const [adjs] = await db.query(`SELECT a.*, i.kind, i.number FROM adjustments a JOIN invoices i ON i.id = a.invoice_id WHERE a.date <= ?`, [to]);
  for (const a of adjs) {
    const amt = Number(a.amount);
    const memo = `Penyesuaian ${a.type} ${a.number}: ${a.note}`;
    if (a.kind === 'sale') add(a.date, 'adjustment', a.id, memo, amt > 0 ? [L('4102', amt), L('1201', 0, amt)] : [L('1201', -amt), L('4102', 0, -amt)]);
    else add(a.date, 'adjustment', a.id, memo, amt > 0 ? [L('2101', amt), L('5102', 0, amt)] : [L('5102', -amt), L('2101', 0, -amt)]);
  }
  const [pays] = await db.query(`SELECT p.*, pt.name AS party_name, COALESCE((SELECT SUM(x.amount) FROM allocations x WHERE x.payment_id = p.id), 0) AS allocated
    FROM payments p JOIN parties pt ON pt.id = p.party_id WHERE p.date <= ?`, [to]);
  for (const p of pays) {
    const alloc = round2(p.allocated);
    const rest = round2(p.amount - alloc);
    const cash = cashCoa(p.account_id, p.date);
    if (p.kind === 'sale') add(p.date, 'payment', p.id, `Terima dari ${p.party_name}`, [L(cash, p.amount), L('1201', 0, alloc), L('2201', 0, rest)]);
    else add(p.date, 'payment', p.id, `Bayar ke ${p.party_name}`, [L('2101', alloc), L('1401', rest), L(cash, 0, p.amount)]);
  }
  const [txns] = await db.query(`SELECT c.*, cc.name AS cat FROM cash_txns c LEFT JOIN cash_categories cc ON cc.id = c.category_id WHERE c.date <= ?`, [to]);
  for (const t of txns) {
    const acc = cashCoa(t.account_id, t.date);
    const memo = [t.cat || 'Transfer', t.note].filter(Boolean).join(' · ');
    const m = {
      biaya: [L(`6-${t.category_id}`, t.amount), L(acc, 0, t.amount)],
      pemasukan: [L(acc, t.amount), L(`42-${t.category_id}`, 0, t.amount)],
      modal: [L(acc, t.amount), L('3101', 0, t.amount)],
      prive: [L('3102', t.amount), L(acc, 0, t.amount)],
      transfer: [L(cashCoa(t.to_account_id, t.date), t.amount), L(acc, 0, t.amount)],
    };
    add(t.date, 'cash', t.id, memo, m[t.kind]);
  }
  const [accs] = await db.query('SELECT * FROM accounts');
  for (const a of accs) {
    const ob = Number(a.opening_balance);
    if (!ob) continue;
    const date = a.opening_date || '2000-01-01';
    if (date > to) continue;
    add(date, 'opening', a.id, `Saldo awal ${a.name}`, ob > 0 ? [L(`1101-${a.id}`, ob), L('3301', 0, ob)] : [L('3301', -ob), L(`1101-${a.id}`, 0, -ob)]);
  }
  const [je] = await db.query('SELECT * FROM journal_entries WHERE date <= ?', [to]);
  if (je.length) {
    const [jl] = await db.query('SELECT * FROM journal_lines WHERE entry_id IN (?) ORDER BY id', [je.map((e) => e.id)]);
    for (const e of je) add(e.date, 'manual', e.id, e.memo, jl.filter((l) => l.entry_id === e.id).map((l) => ({ ...L(l.coa, l.debit, l.credit), note: l.note })));
  }
  const order = { opening: 0, invoice: 1, adjustment: 2, payment: 3, cash: 4, manual: 5 };
  return E.sort((a, b) => a.date.localeCompare(b.date) || order[a.src] - order[b.src] || a.ref - b.ref);
}

// Nilai persediaan per tanggal (estimasi periodik).
async function inventoryValue(db, date) {
  const [rows] = await db.query(`SELECT i.kind, i.date, l.item_id, it.name AS item, u.name AS unit, u.kg_per_unit, l.qty, l.price
    FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN items it ON it.id = l.item_id JOIN units u ON u.id = l.unit_id
    WHERE i.date <= ?`, [date]);
  const m = new Map();
  for (const r of rows) {
    const unit = r.kg_per_unit ? 'kg' : r.unit;
    const k = Number(r.kg_per_unit) || 1;
    const key = `${r.item_id}|${unit}`;
    const x = m.get(key) || { item: r.item, unit, qty: 0, buyQty: 0, buyValue: 0, recentQty: 0, recentValue: 0 };
    const q = Number(r.qty) * k;
    if (r.kind === 'purchase') {
      x.qty += q; x.buyQty += q; x.buyValue += Number(r.qty) * Number(r.price);
      if (r.date >= addDays(date, -60)) { x.recentQty += q; x.recentValue += Number(r.qty) * Number(r.price); }
    } else x.qty -= q;
    m.set(key, x);
  }
  const items = [...m.values()].map((x) => {
    const avg = x.recentQty ? x.recentValue / x.recentQty : x.buyQty ? x.buyValue / x.buyQty : 0;
    const qty = round2(x.qty);
    return { item: x.item, unit: x.unit, qty, avgCost: round2(avg), value: qty > 0 ? round2(qty * avg) : 0, negative: qty < 0 };
  });
  return { date, value: round2(items.reduce((s, x) => s + x.value, 0)), items };
}

function balances(entries, from, to) {
  const b = new Map();
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    for (const l of e.lines) {
      const x = b.get(l.coa) || { debit: 0, credit: 0 };
      x.debit += l.debit; x.credit += l.credit;
      b.set(l.coa, x);
    }
  }
  for (const x of b.values()) { x.debit = round2(x.debit); x.credit = round2(x.credit); }
  return b;
}
const net = (b, code, side = 'debit') => { const x = b.get(code); if (!x) return 0; return round2(side === 'debit' ? x.debit - x.credit : x.credit - x.debit); };

async function profitLoss(db, from, to) {
  const coa = await chartOfAccounts(db);
  const entries = await buildEntries(db, to);
  const b = balances(entries, from, to);
  const sales = net(b, '4101', 'credit');
  const salesAdj = net(b, '4102', 'debit');
  const purchases = net(b, '5101', 'debit');
  const purchAdj = net(b, '5102', 'credit');
  const invStart = (await inventoryValue(db, addDays(from, -1))).value;
  const invEndFull = await inventoryValue(db, to);
  const invEnd = invEndFull.value;
  const hpp = round2(purchases - purchAdj + invStart - invEnd);
  const otherIncome = [...coa.values()].filter((c) => c.code.startsWith('42-')).map((c) => ({ code: c.code, name: c.name, amount: net(b, c.code, 'credit') })).filter((x) => x.amount);
  const expenses = [...coa.values()].filter((c) => c.group === 'biaya').map((c) => ({ code: c.code, name: c.name, amount: net(b, c.code, 'debit') })).filter((x) => x.amount);
  const netSales = round2(sales - salesAdj);
  const gross = round2(netSales - hpp);
  const totalOther = round2(otherIncome.reduce((s, x) => s + x.amount, 0));
  const totalExp = round2(expenses.reduce((s, x) => s + x.amount, 0));
  // Kontrol: HPP dari harga beli yang diketik di invoice penjualan.
  const [ctl] = await db.query(`SELECT COALESCE(SUM(CASE WHEN l.cost_price IS NOT NULL THEN l.qty * l.cost_price END), 0) AS typed,
      SUM(l.cost_price IS NULL) AS missing, COUNT(*) AS n
    FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.kind = 'sale' AND i.date BETWEEN ? AND ?`, [from, to]);
  const typed = round2(ctl[0].typed);
  return {
    from, to, sales, salesAdj, netSales, purchases, purchAdj, invStart, invEnd, inventory: invEndFull.items, hpp, gross,
    otherIncome, totalOther, expenses, totalExp, netIncome: round2(gross + totalOther - totalExp),
    control: { hppTyped: typed, linesWithoutCost: Number(ctl[0].missing || 0), lines: Number(ctl[0].n || 0), difference: round2(hpp - typed) },
  };
}

async function balanceSheet(db, asOf) {
  const coa = await chartOfAccounts(db);
  const entries = await buildEntries(db, asOf);
  const b = balances(entries, '0000-00-00', asOf);
  const inv = await inventoryValue(db, asOf);
  const line = (code, side) => ({ code, name: coa.get(code)?.name || code, amount: net(b, code, side) });
  const assets = [...[...coa.keys()].filter((c) => c.startsWith('1101-')).map((c) => line(c, 'debit')), line('1102', 'debit'), line('1201', 'debit'),
    { code: '1301', name: 'Persediaan Telur (estimasi)', amount: inv.value }, line('1401', 'debit')].filter((x) => x.amount || x.code === '1301');
  const liabilities = [line('2101', 'credit'), line('2201', 'credit')];
  // Laba kumulatif = semua pendapatan − HPP − biaya sampai asOf; persediaan awal sistem = 0.
  const income = [...b.entries()].reduce((s, [code, x]) => {
    const g = coa.get(code)?.group;
    if (g === 'pendapatan') return s + (x.credit - x.debit);
    if (g === 'hpp' || g === 'biaya') return s - (x.debit - x.credit);
    return s;
  }, 0) + inv.value;
  const equity = [line('3301', 'credit'), line('3101', 'credit'), { code: '3102', name: 'Prive (Penarikan Pemilik)', amount: -net(b, '3102', 'debit') },
    { code: 'laba', name: 'Laba (rugi) kumulatif', amount: round2(income) }];
  // Akun yang tidak dikenal bagan (mis. kategori dihapus) tetap ditampilkan supaya neraca tidak diam-diam timpang.
  const known = new Set([...coa.keys()]);
  const unknown = [...b.entries()].filter(([c]) => !known.has(c)).map(([code, x]) => ({ code, name: code, amount: round2(x.debit - x.credit) }));
  const sum = (xs) => round2(xs.reduce((s, x) => s + x.amount, 0));
  const totalAssets = round2(sum(assets) + sum(unknown));
  const totalLE = round2(sum(liabilities) + sum(equity));
  return { asOf, assets, liabilities, equity, unknown, totalAssets, totalLiabilities: sum(liabilities), totalEquity: sum(equity), totalLE, difference: round2(totalAssets - totalLE), inventory: inv.items };
}

module.exports = { chartOfAccounts, buildEntries, inventoryValue, balances, profitLoss, balanceSheet, FIXED };
