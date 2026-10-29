// Kas & Bank: master rekening, kategori, transaksi kas (biaya/pemasukan/modal/prive/transfer),
// saldo & buku per rekening. Penerimaan/pembayaran invoice ikut masuk saldo kalau rekeningnya diisi.
const express = require('express');
const { requirePerm } = require('../auth');
const { round2, todayWIB } = require('../calc');
const { bad, log, reqDate, reqNum, reqStr, optStr, HttpError } = require('../lib');

const KINDS = ['biaya', 'pemasukan', 'modal', 'prive', 'transfer'];
const IN_KINDS = ['pemasukan', 'modal'];

// Semua mutasi rekening sampai tanggal `to` (inklusif). amount bertanda: + masuk, − keluar.
// v4.0: per perusahaan (cid).
async function movements(db, cid, { accountId = null, to = '9999-12-31' } = {}) {
  if (!Number(cid)) throw new Error('movements: company id wajib');
  const acc = accountId ? ' AND p.account_id = ?' : ' AND p.account_id IS NOT NULL';
  const args = accountId ? [cid, to, accountId] : [cid, to];
  const [pays] = await db.query(
    `SELECT p.account_id, p.date, p.id AS ref_id, 'payment' AS src, p.kind, pt.name AS party_name, p.method, p.reference, p.notes AS note,
       CASE WHEN p.kind = 'sale' THEN p.amount ELSE -p.amount END AS amount
     FROM payments p JOIN parties pt ON pt.id = p.party_id WHERE p.company_id = ? AND p.date <= ?${acc}`, args);
  const cAcc = accountId ? ' AND (c.account_id = ? OR c.to_account_id = ?)' : '';
  const [txns] = await db.query(
    `SELECT c.*, cc.name AS category_name, a1.name AS account_name, a2.name AS to_account_name FROM cash_txns c
     LEFT JOIN cash_categories cc ON cc.id = c.category_id JOIN accounts a1 ON a1.id = c.account_id LEFT JOIN accounts a2 ON a2.id = c.to_account_id
     WHERE c.company_id = ? AND c.date <= ?${cAcc}`, accountId ? [cid, to, accountId, accountId] : [cid, to]);
  const out = pays.map((p) => ({
    account_id: p.account_id, date: p.date, src: 'payment', ref_id: p.ref_id, amount: p.amount,
    label: `${p.kind === 'sale' ? 'Terima dari' : 'Bayar ke'} ${p.party_name}`, note: [p.reference, p.note].filter(Boolean).join(' · ') || null,
  }));
  for (const c of txns) {
    const base = { date: c.date, src: 'cash', ref_id: c.id, kind: c.kind, note: [c.reference, c.note].filter(Boolean).join(' · ') || null };
    if (c.kind === 'transfer') {
      if (!accountId || c.account_id === Number(accountId)) out.push({ ...base, account_id: c.account_id, amount: -c.amount, label: `Transfer ke ${c.to_account_name}` });
      if (!accountId || c.to_account_id === Number(accountId)) out.push({ ...base, account_id: c.to_account_id, amount: c.amount, label: `Transfer dari ${c.account_name}` });
    } else {
      out.push({ ...base, account_id: c.account_id, amount: IN_KINDS.includes(c.kind) ? c.amount : -c.amount, label: c.category_name || c.kind });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.src.localeCompare(b.src) || a.ref_id - b.ref_id);
}

// Saldo = saldo awal + mutasi sejak tanggal saldo awal. Mutasi sebelum tanggal saldo awal tidak dihitung
// (sudah termasuk di saldo awal) dan dilaporkan sebagai peringatan.
function balanceOf(account, moves, to) {
  const from = account.opening_date || '0000-00-00';
  let bal = Number(account.opening_balance);
  let before = 0;
  for (const m of moves) {
    if (m.account_id !== account.id || m.date > to) continue;
    if (m.date < from) { before++; continue; }
    bal += m.amount;
  }
  return { balance: round2(bal), ignoredBeforeOpening: before };
}

module.exports = function cashRoutes(pool) {
  const r = express.Router();
  const W = requirePerm('cash');

  // ===== Rekening =====
  r.get('/accounts', async (req, res) => res.json((await pool.query('SELECT * FROM accounts WHERE company_id = ? ORDER BY active DESC, sort_order, id', [req.cid]))[0]));
  const accBody = (b) => ({
    name: reqStr(b.name, 'Nama rekening', 80), type: b.type === 'bank' ? 'bank' : 'kas',
    bank: b.type === 'bank' ? optStr(b.bank, 30) : null, account_no: optStr(b.account_no, 40),
    opening_balance: round2(reqNum(b.opening_balance ?? 0, 'Saldo awal')),
    opening_date: b.opening_date ? reqDate(b.opening_date, 'Tanggal saldo awal') : null,
    sort_order: Number(b.sort_order) || 0, active: b.active === false || b.active === 0 ? 0 : 1,
  });
  r.post('/accounts', W, async (req, res) => {
    const a = accBody(req.body);
    const [ins] = await pool.query('INSERT INTO accounts SET ?', [{ ...a, company_id: req.cid }]).catch((e) => { throw e.code === 'ER_DUP_ENTRY' ? bad('Nama rekening sudah ada') : e; });
    await log(pool, req.user, 'create', 'account', ins.insertId, a);
    res.json({ id: ins.insertId });
  });
  r.put('/accounts/:id', W, async (req, res) => {
    const [[own]] = await pool.query('SELECT id FROM accounts WHERE id = ? AND company_id = ?', [req.params.id, req.cid]);
    if (!own) throw new HttpError(404, 'Rekening tidak ditemukan');
    const a = accBody(req.body);
    await pool.query('UPDATE accounts SET ? WHERE id = ? AND company_id = ?', [a, own.id, req.cid]).catch((e) => { throw e.code === 'ER_DUP_ENTRY' ? bad('Nama rekening sudah ada') : e; });
    await log(pool, req.user, 'update', 'account', Number(req.params.id), a);
    res.json({ ok: true });
  });

  // ===== Kategori =====
  r.get('/cash/categories', async (req, res) => res.json((await pool.query('SELECT * FROM cash_categories ORDER BY kind, active DESC, name'))[0]));
  r.post('/cash/categories', W, async (req, res) => {
    if (!['biaya', 'pemasukan', 'modal', 'prive'].includes(req.body.kind)) throw bad('Jenis kategori tidak valid');
    const c = { kind: req.body.kind, name: reqStr(req.body.name, 'Nama kategori', 80) };
    const [ins] = await pool.query('INSERT INTO cash_categories SET ?', [c]).catch((e) => { throw e.code === 'ER_DUP_ENTRY' ? bad('Kategori sudah ada') : e; });
    await log(pool, req.user, 'create', 'cash_category', ins.insertId, c);
    res.json({ id: ins.insertId });
  });
  r.put('/cash/categories/:id', W, async (req, res) => {
    const c = { name: reqStr(req.body.name, 'Nama kategori', 80), active: req.body.active === false || req.body.active === 0 ? 0 : 1 };
    await pool.query('UPDATE cash_categories SET ? WHERE id = ?', [c, req.params.id]).catch((e) => { throw e.code === 'ER_DUP_ENTRY' ? bad('Kategori sudah ada') : e; });
    res.json({ ok: true });
  });

  // ===== Saldo semua rekening =====
  r.get('/cash/balances', async (req, res) => {
    const asOf = req.query.as_of || todayWIB();
    const [accs] = await pool.query('SELECT * FROM accounts WHERE company_id = ? ORDER BY active DESC, sort_order, id', [req.cid]);
    const moves = await movements(pool, req.cid, { to: asOf });
    const rows = accs.map((a) => ({ ...a, ...balanceOf(a, moves, asOf) }));
    const [[noAcc]] = await pool.query(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN kind = 'sale' THEN amount ELSE -amount END), 0) AS net
      FROM payments WHERE company_id = ? AND account_id IS NULL AND date <= ?`, [req.cid, asOf]);
    res.json({ asOf, accounts: rows, total: round2(rows.reduce((s, a) => s + a.balance, 0)), paymentsWithoutAccount: { count: noAcc.n, net: round2(noAcc.net) } });
  });

  // ===== Buku rekening (mutasi + saldo berjalan) =====
  r.get('/cash/ledger', async (req, res) => {
    const [[acc]] = await pool.query('SELECT * FROM accounts WHERE id = ? AND company_id = ?', [req.query.account_id, req.cid]);
    if (!acc) throw new HttpError(404, 'Rekening tidak ditemukan');
    const to = req.query.to || todayWIB();
    const from = req.query.from || '0000-00-00';
    const moves = await movements(pool, req.cid, { accountId: acc.id, to });
    const start = acc.opening_date || '0000-00-00';
    let bal = Number(acc.opening_balance);
    const rows = [];
    let opening = null;
    for (const m of moves) {
      if (m.date < start) continue;
      if (m.date < from) { bal += m.amount; continue; }
      if (opening === null) opening = round2(bal);
      bal += m.amount;
      rows.push({ ...m, balance: round2(bal) });
    }
    res.json({
      account: acc, from, to, opening: opening ?? round2(bal), closing: round2(bal), rows,
      ignoredBeforeOpening: moves.filter((m) => m.date < start).length,
    });
  });

  // ===== Transaksi kas =====
  r.get('/cash/txns', async (req, res) => {
    const where = ['c.company_id = ?'];
    const p = [req.cid];
    if (req.query.from) { where.push('c.date >= ?'); p.push(req.query.from); }
    if (req.query.to) { where.push('c.date <= ?'); p.push(req.query.to); }
    if (req.query.kind) { where.push('c.kind = ?'); p.push(req.query.kind); }
    const [rows] = await pool.query(`SELECT c.*, cc.name AS category_name, a1.name AS account_name, a2.name AS to_account_name, u.name AS created_by_name
      FROM cash_txns c LEFT JOIN cash_categories cc ON cc.id = c.category_id JOIN accounts a1 ON a1.id = c.account_id
      LEFT JOIN accounts a2 ON a2.id = c.to_account_id LEFT JOIN users u ON u.id = c.created_by
      WHERE ${where.join(' AND ')} ORDER BY c.date DESC, c.id DESC`, p);
    res.json(rows);
  });

  async function txnBody(b, cid) {
    if (!KINDS.includes(b.kind)) throw bad('Jenis transaksi tidak valid');
    const t = {
      date: reqDate(b.date), kind: b.kind, account_id: reqNum(b.account_id, 'Rekening'),
      amount: round2(reqNum(b.amount, 'Nominal', { min: 0, allowZero: false })),
      reference: optStr(b.reference, 120), note: optStr(b.note), to_account_id: null, category_id: null,
    };
    if (b.kind === 'transfer') {
      t.to_account_id = reqNum(b.to_account_id, 'Rekening tujuan');
      if (t.to_account_id === t.account_id) throw bad('Rekening asal dan tujuan tidak boleh sama');
    } else {
      t.category_id = reqNum(b.category_id, 'Kategori');
      const [[c]] = await pool.query('SELECT kind FROM cash_categories WHERE id = ?', [t.category_id]);
      if (!c || c.kind !== b.kind) throw bad('Kategori tidak cocok dengan jenis transaksi');
    }
    const ids = [t.account_id, t.to_account_id].filter(Boolean);
    const [accs] = await pool.query('SELECT id FROM accounts WHERE id IN (?) AND company_id = ?', [ids, cid]);
    if (accs.length !== ids.length) throw bad('Rekening tidak ditemukan');
    return t;
  }
  r.post('/cash/txns', W, async (req, res) => {
    const t = await txnBody(req.body, req.cid);
    const [ins] = await pool.query('INSERT INTO cash_txns SET ?', [{ ...t, company_id: req.cid, created_by: req.user.id }]);
    await log(pool, req.user, 'create', `cash_${t.kind}`, ins.insertId, t);
    res.json({ id: ins.insertId });
  });
  r.put('/cash/txns/:id', W, async (req, res) => {
    const [[old]] = await pool.query('SELECT * FROM cash_txns WHERE id = ? AND company_id = ?', [req.params.id, req.cid]);
    if (!old) throw new HttpError(404, 'Transaksi tidak ditemukan');
    const t = await txnBody(req.body, req.cid);
    await pool.query('UPDATE cash_txns SET ? WHERE id = ?', [t, old.id]);
    await log(pool, req.user, 'update', `cash_${t.kind}`, old.id, { before: { date: old.date, amount: old.amount, account_id: old.account_id }, after: t });
    res.json({ ok: true });
  });
  r.delete('/cash/txns/:id', W, async (req, res) => {
    const [[old]] = await pool.query('SELECT * FROM cash_txns WHERE id = ? AND company_id = ?', [req.params.id, req.cid]);
    if (!old) throw new HttpError(404, 'Transaksi tidak ditemukan');
    const [[rec]] = await pool.query("SELECT id FROM bank_lines WHERE match_src = 'cash' AND match_id = ? AND status = 'matched'", [old.id]);
    if (rec) throw bad('Transaksi ini sudah dicocokkan di rekonsiliasi bank. Batalkan cocoknya dulu.');
    await pool.query('DELETE FROM cash_txns WHERE id = ?', [old.id]);
    await log(pool, req.user, 'delete', `cash_${old.kind}`, old.id, { date: old.date, amount: old.amount, account_id: old.account_id, note: old.note });
    res.json({ ok: true });
  });

  return r;
};

module.exports.movements = movements;
module.exports.balanceOf = balanceOf;
