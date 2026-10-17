// Pembayaran: 1 pembayaran bisa dialokasikan ke banyak invoice, 1 invoice bisa menerima banyak pembayaran.
const express = require('express');
const { requirePerm } = require('../auth');
const { round2, EPS } = require('../calc');
const { bad, log, tx, reqDate, reqNum, optStr, loadInvoices, HttpError } = require('../lib');

const METHODS = ['cash', 'transfer', 'giro', 'lainnya'];
const PARTY = { sale: 'customer', purchase: 'supplier' };

async function listPayments(db, where, params) {
  const [rows] = await db.query(`SELECT p.*, pt.name AS party_name, u.name AS created_by_name, ac.name AS account_name,
      COALESCE((SELECT SUM(a.amount) FROM allocations a WHERE a.payment_id = p.id), 0) AS allocated
    FROM payments p JOIN parties pt ON pt.id = p.party_id LEFT JOIN users u ON u.id = p.created_by LEFT JOIN accounts ac ON ac.id = p.account_id
    WHERE ${where} ORDER BY p.date DESC, p.id DESC`, params);
  return rows.map((p) => ({ ...p, unallocated: round2(p.amount - p.allocated) }));
}

module.exports = function paymentRoutes(pool) {
  const r = express.Router();

  r.get('/payments', async (req, res) => {
    const kind = PARTY[req.query.kind] ? req.query.kind : 'sale';
    const where = ['p.kind = ?'];
    const params = [kind];
    if (req.query.from) { where.push('p.date >= ?'); params.push(req.query.from); }
    if (req.query.to) { where.push('p.date <= ?'); params.push(req.query.to); }
    if (req.query.party_id) { where.push('p.party_id = ?'); params.push(req.query.party_id); }
    let rows = await listPayments(pool, where.join(' AND '), params);
    if (req.query.unallocated === '1') rows = rows.filter((p) => Math.abs(p.unallocated) >= EPS);
    res.json(rows);
  });

  r.get('/payments/:id', async (req, res) => {
    const [p] = await listPayments(pool, 'p.id = ?', [req.params.id]);
    if (!p) throw new HttpError(404, 'Pembayaran tidak ditemukan');
    const [allocs] = await pool.query(`SELECT a.*, i.number, i.date AS invoice_date FROM allocations a
      JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = ? ORDER BY i.date, i.id`, [p.id]);
    res.json({ ...p, allocations: allocs });
  });

  async function save(req, res, id) {
    const b = req.body;
    const old = id ? (await listPayments(pool, 'p.id = ?', [id]))[0] : null;
    if (id && !old) throw new HttpError(404, 'Pembayaran tidak ditemukan');
    const kind = old ? old.kind : b.kind;
    if (!PARTY[kind]) throw bad('Jenis pembayaran tidak valid');
    const [[party]] = await pool.query('SELECT id FROM parties WHERE id = ? AND kind = ?', [b.party_id, PARTY[kind]]);
    if (!party) throw bad('Pihak (customer/supplier) tidak ditemukan');
    if (!METHODS.includes(b.method)) throw bad('Metode bayar tidak valid');
    const head = {
      date: reqDate(b.date), party_id: party.id, method: b.method, reference: optStr(b.reference, 120),
      amount: round2(reqNum(b.amount, 'Nominal', { min: 0, allowZero: false })), notes: optStr(b.notes, 2000),
      account_id: b.account_id ? Number(b.account_id) : null, // opsional (keputusan user)
    };
    if (head.account_id) {
      const [[acc]] = await pool.query('SELECT id FROM accounts WHERE id = ?', [head.account_id]);
      if (!acc) throw bad('Rekening tidak ditemukan');
    }
    const allocs = (Array.isArray(b.allocations) ? b.allocations : [])
      .map((a) => ({ invoice_id: Number(a.invoice_id), amount: round2(reqNum(a.amount, 'Alokasi', { min: 0 })) }))
      .filter((a) => a.amount > 0);
    if (new Set(allocs.map((a) => a.invoice_id)).size !== allocs.length) throw bad('Invoice yang sama dialokasikan dua kali');
    const allocTotal = round2(allocs.reduce((s, a) => s + a.amount, 0));
    if (allocTotal - head.amount > EPS) throw bad(`Total alokasi (${allocTotal}) melebihi nominal pembayaran (${head.amount})`);

    // Alokasi tidak boleh melebihi sisa invoice (tidak termasuk alokasi lama dari pembayaran ini).
    if (allocs.length) {
      const invs = await loadInvoices(pool, 'i.id IN (?)', [allocs.map((a) => a.invoice_id)]);
      const [mine] = id ? await pool.query('SELECT invoice_id, amount FROM allocations WHERE payment_id = ?', [id]) : [[]];
      const mineM = new Map(mine.map((m) => [m.invoice_id, m.amount]));
      for (const a of allocs) {
        const inv = invs.find((x) => x.id === a.invoice_id);
        if (!inv || inv.kind !== kind || inv.party_id !== party.id) throw bad('Invoice alokasi tidak cocok dengan pihak pembayaran');
        const room = round2(inv.outstanding + (mineM.get(inv.id) || 0));
        if (a.amount - room > EPS) throw bad(`Alokasi ke invoice ${inv.number} (${a.amount}) melebihi sisanya (${room})`);
      }
    }

    const payId = await tx(pool, async (c) => {
      let pid = id;
      if (id) {
        await c.query('UPDATE payments SET ? WHERE id = ?', [head, id]);
        await c.query('DELETE FROM allocations WHERE payment_id = ?', [id]);
      } else {
        const [ins] = await c.query('INSERT INTO payments SET ?', [{ ...head, kind, created_by: req.user.id }]);
        pid = ins.insertId;
      }
      if (allocs.length) await c.query('INSERT INTO allocations (payment_id, invoice_id, amount) VALUES ?', [allocs.map((a) => [pid, a.invoice_id, a.amount])]);
      return pid;
    });
    await log(pool, req.user, id ? 'update' : 'create', `payment_${kind}`, payId, { ...head, allocations: allocs, before: old ? { amount: old.amount, date: old.date } : undefined });
    res.json({ id: payId });
  }

  r.post('/payments', requirePerm('payment'), (req, res) => save(req, res, null));
  r.put('/payments/:id', requirePerm('payment'), (req, res) => save(req, res, Number(req.params.id)));

  r.delete('/payments/:id', requirePerm('payment'), async (req, res) => {
    const [p] = await listPayments(pool, 'p.id = ?', [req.params.id]);
    if (!p) throw new HttpError(404, 'Pembayaran tidak ditemukan');
    await pool.query('DELETE FROM payments WHERE id = ?', [p.id]);
    await log(pool, req.user, 'delete', `payment_${p.kind}`, p.id, { date: p.date, party: p.party_name, amount: p.amount, method: p.method });
    res.json({ ok: true });
  });

  return r;
};
