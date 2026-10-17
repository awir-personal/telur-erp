const express = require('express');
const { requirePerm } = require('../auth');
const { bad, log, reqStr, optStr, reqNum } = require('../lib');

const dupAs = (msg) => (e) => { throw e.code === 'ER_DUP_ENTRY' ? bad(msg) : e; };
const KINDS = ['customer', 'supplier'];

module.exports = function masterRoutes(pool) {
  const r = express.Router();
  const W = requirePerm('master');

  // ===== Customer & supplier =====
  r.get('/parties', async (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'customer';
    const [rows] = await pool.query('SELECT * FROM parties WHERE kind = ? ORDER BY active DESC, name', [kind]);
    res.json(rows);
  });

  function partyBody(b) {
    return {
      name: reqStr(b.name, 'Nama', 120), phone: optStr(b.phone, 40), address: optStr(b.address),
      term_days: reqNum(b.term_days ?? 30, 'Termin (hari)', { min: 0 }), price_rule: optStr(b.price_rule, 2000), notes: optStr(b.notes, 2000),
      active: b.active === false || b.active === 0 ? 0 : 1,
    };
  }

  r.post('/parties', W, async (req, res) => {
    if (!KINDS.includes(req.body.kind)) throw bad('Jenis tidak valid');
    const p = partyBody(req.body);
    const [ins] = await pool.query('INSERT INTO parties SET ?', [{ kind: req.body.kind, ...p }]).catch(dupAs('Nama sudah ada'));
    await log(pool, req.user, 'create', req.body.kind, ins.insertId, p);
    res.json({ id: ins.insertId });
  });

  r.put('/parties/:id', W, async (req, res) => {
    const p = partyBody(req.body);
    await pool.query('UPDATE parties SET ? WHERE id = ?', [p, req.params.id]).catch(dupAs('Nama sudah ada'));
    await log(pool, req.user, 'update', 'party', Number(req.params.id), p);
    res.json({ ok: true });
  });

  // Harga khusus per customer (saran saat isi invoice — tetap bisa diketik bebas)
  r.get('/parties/:id/prices', async (req, res) => {
    const [rows] = await pool.query(`SELECT pp.*, i.name AS item_name, u.name AS unit_name FROM party_prices pp
      JOIN items i ON i.id = pp.item_id JOIN units u ON u.id = pp.unit_id WHERE pp.party_id = ? ORDER BY i.sort_order, u.name`, [req.params.id]);
    res.json(rows);
  });

  r.put('/parties/:id/prices', W, async (req, res) => {
    const rows = Array.isArray(req.body.prices) ? req.body.prices : [];
    const clean = rows.map((p) => [Number(req.params.id), Number(p.item_id), Number(p.unit_id), reqNum(p.price, 'Harga', { min: 0 }), optStr(p.note)]);
    const seen = new Set(clean.map((c) => `${c[1]}-${c[2]}`));
    if (seen.size !== clean.length) throw bad('Ada barang + satuan yang dobel');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM party_prices WHERE party_id = ?', [req.params.id]);
      if (clean.length) await conn.query('INSERT INTO party_prices (party_id, item_id, unit_id, price, note) VALUES ?', [clean]);
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    await log(pool, req.user, 'update_prices', 'party', Number(req.params.id), rows);
    res.json({ ok: true });
  });

  // Saran harga: harga khusus customer → kalau tidak ada, harga terakhir ke pihak ini untuk barang+satuan yang sama.
  r.get('/price-suggest', async (req, res) => {
    const { party_id, item_id, unit_id } = req.query;
    const [[pp]] = await pool.query('SELECT price FROM party_prices WHERE party_id = ? AND item_id = ? AND unit_id = ?', [party_id, item_id, unit_id]);
    if (pp) return res.json({ price: pp.price, source: 'master' });
    const [[last]] = await pool.query(`SELECT l.price, l.cost_price FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE i.party_id = ? AND l.item_id = ? AND l.unit_id = ? AND l.price > 0 ORDER BY i.date DESC, i.id DESC LIMIT 1`, [party_id, item_id, unit_id]);
    res.json(last ? { price: last.price, source: 'terakhir' } : { price: null, source: null });
  });

  // ===== Satuan & barang =====
  r.get('/units', async (req, res) => res.json((await pool.query('SELECT * FROM units ORDER BY active DESC, id'))[0]));
  const unitBody = (b) => ({
    name: reqStr(b.name, 'Nama satuan', 30).toLowerCase(),
    kg_per_unit: b.kg_per_unit === '' || b.kg_per_unit == null ? null : reqNum(b.kg_per_unit, 'Kg per satuan', { min: 0, allowZero: false }),
    active: b.active === false || b.active === 0 ? 0 : 1,
  });
  r.post('/units', W, async (req, res) => {
    const u = unitBody(req.body);
    const [ins] = await pool.query('INSERT INTO units SET ?', [u]).catch(dupAs('Satuan sudah ada'));
    await log(pool, req.user, 'create', 'unit', ins.insertId, u);
    res.json({ id: ins.insertId });
  });
  r.put('/units/:id', W, async (req, res) => {
    const u = unitBody(req.body);
    await pool.query('UPDATE units SET ? WHERE id = ?', [u, req.params.id]).catch(dupAs('Satuan sudah ada'));
    await log(pool, req.user, 'update', 'unit', Number(req.params.id), u);
    res.json({ ok: true });
  });

  r.get('/items', async (req, res) => res.json((await pool.query(
    'SELECT i.*, u.name AS unit_name FROM items i JOIN units u ON u.id = i.default_unit_id ORDER BY i.active DESC, i.sort_order, i.id'))[0]));
  const itemBody = (b) => ({
    name: reqStr(b.name, 'Nama barang', 80), default_unit_id: reqNum(b.default_unit_id, 'Satuan'),
    sort_order: Number(b.sort_order) || 0, active: b.active === false || b.active === 0 ? 0 : 1,
  });
  r.post('/items', W, async (req, res) => {
    const it = itemBody(req.body);
    const [ins] = await pool.query('INSERT INTO items SET ?', [it]).catch(dupAs('Barang sudah ada'));
    await log(pool, req.user, 'create', 'item', ins.insertId, it);
    res.json({ id: ins.insertId });
  });
  r.put('/items/:id', W, async (req, res) => {
    const it = itemBody(req.body);
    await pool.query('UPDATE items SET ? WHERE id = ?', [it, req.params.id]).catch(dupAs('Barang sudah ada'));
    await log(pool, req.user, 'update', 'item', Number(req.params.id), it);
    res.json({ ok: true });
  });

  // ===== Pengaturan =====
  r.get('/settings', async (req, res) => {
    const [rows] = await pool.query('SELECT k, v FROM settings');
    res.json(Object.fromEntries(rows.map((x) => [x.k, x.v])));
  });
  r.put('/settings', async (req, res) => {
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Hanya master user' });
    const allowed = {
      company_name: (v) => reqStr(v, 'Nama perusahaan', 120), next_sale_no: (v) => String(reqNum(v, 'Nomor invoice berikutnya', { min: 1 })),
      company_address: (v) => optStr(v, 250) || '', company_phone: (v) => optStr(v, 60) || '',
    };
    for (const [k, fn] of Object.entries(allowed)) {
      if (req.body[k] == null) continue;
      await pool.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, fn(req.body[k])]);
    }
    await log(pool, req.user, 'update', 'settings', null, req.body);
    res.json({ ok: true });
  });

  r.get('/logs', async (req, res) => {
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Hanya master user' });
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const [rows] = await pool.query('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?', [limit]);
    res.json(rows);
  });

  return r;
};
