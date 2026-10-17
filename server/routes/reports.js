const express = require('express');
const { requirePerm } = require('../auth');
const { round2, agingBucket, AGING_BUCKETS, addDays, todayWIB, EPS, lineTotal } = require('../calc');
const { bad, log, tx, loadInvoices } = require('../lib');
const { parseSheet } = require('../importer');
const { bumpCounter } = require('./invoices');

module.exports = function reportRoutes(pool) {
  const r = express.Router();
  const kindOf = (k) => (k === 'purchase' ? 'purchase' : 'sale');

  // Umur piutang (sale) / hutang (purchase) per pihak.
  r.get('/reports/aging', async (req, res) => {
    const kind = kindOf(req.query.kind);
    const asOf = req.query.as_of || todayWIB();
    const invs = (await loadInvoices(pool, 'i.kind = ? AND i.date <= ?', [kind, asOf])).filter((i) => Math.abs(i.outstanding) >= EPS);
    const [credits] = await pool.query(`SELECT p.party_id, SUM(p.amount - COALESCE((SELECT SUM(a.amount) FROM allocations a WHERE a.payment_id = p.id),0)) AS unallocated
      FROM payments p WHERE p.kind = ? AND p.date <= ? GROUP BY p.party_id`, [kind, asOf]);
    const parties = new Map();
    const row = (id, name) => {
      if (!parties.has(id)) parties.set(id, { party_id: id, party_name: name, ...Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])), total: 0, unallocated: 0, invoices: [] });
      return parties.get(id);
    };
    for (const i of invs) {
      const p = row(i.party_id, i.party_name);
      const b = agingBucket(i.due_date, asOf);
      p[b] = round2(p[b] + i.outstanding);
      p.total = round2(p.total + i.outstanding);
      p.invoices.push({ id: i.id, number: i.number, date: i.date, due_date: i.due_date, total: i.total, outstanding: i.outstanding, bucket: b });
    }
    for (const c of credits) {
      if (Math.abs(c.unallocated) < EPS) continue;
      const [[pt]] = await pool.query('SELECT name FROM parties WHERE id = ?', [c.party_id]);
      row(c.party_id, pt.name).unallocated = round2(c.unallocated);
    }
    const rows = [...parties.values()].sort((a, b) => b.total - a.total);
    const totals = Object.fromEntries([...AGING_BUCKETS, 'total', 'unallocated'].map((k) => [k, round2(rows.reduce((s, x) => s + x[k], 0))]));
    res.json({ asOf, rows, totals });
  });

  // Margin penjualan: harga jual vs harga beli yang diketik per baris invoice.
  r.get('/reports/margin', async (req, res) => {
    const from = req.query.from || addDays(todayWIB(), -30);
    const to = req.query.to || todayWIB();
    const invs = await loadInvoices(pool, 'i.kind = "sale" AND i.date BETWEEN ? AND ?', [from, to]);
    const rows = invs.map((i) => {
      const costed = i.lines.filter((l) => l.cost_price != null);
      const salesCosted = round2(costed.reduce((s, l) => s + lineTotal(l), 0));
      const cost = round2(costed.reduce((s, l) => s + round2(l.qty * l.cost_price), 0));
      return { id: i.id, number: i.number, date: i.date, party_name: i.party_name, total: i.total, salesCosted, cost, margin: round2(salesCosted - cost), missingCost: i.lines.length - costed.length };
    });
    const group = (key) => {
      const m = new Map();
      for (const x of rows) {
        const g = m.get(x[key]) || { key: x[key], total: 0, salesCosted: 0, cost: 0, margin: 0, invoices: 0, missingCost: 0 };
        for (const f of ['total', 'salesCosted', 'cost', 'margin']) g[f] = round2(g[f] + x[f]);
        g.invoices++; g.missingCost += x.missingCost;
        m.set(x[key], g);
      }
      return [...m.values()];
    };
    res.json({ from, to, rows, byParty: group('party_name').sort((a, b) => b.margin - a.margin), byDate: group('date').sort((a, b) => a.key.localeCompare(b.key)) });
  });

  // Info stok: pembelian masuk vs penjualan keluar per barang (dikonversi ke kg bila satuan punya kg_per_unit).
  r.get('/reports/stock', async (req, res) => {
    const from = req.query.from || addDays(todayWIB(), -30);
    const to = req.query.to || todayWIB();
    const [rows] = await pool.query(`SELECT i.kind, i.date, it.name AS item, it.sort_order, u.name AS unit, u.kg_per_unit, l.qty
      FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN items it ON it.id = l.item_id JOIN units u ON u.id = l.unit_id
      WHERE i.date <= ? ORDER BY i.date`, [to]);
    const items = new Map();
    for (const x of rows) {
      const unit = x.kg_per_unit ? 'kg' : x.unit;
      const qty = x.kg_per_unit ? x.qty * x.kg_per_unit : x.qty;
      const key = `${x.item}|${unit}`;
      const it = items.get(key) || { item: x.item, unit, sort: x.sort_order, opening: 0, in: 0, out: 0, days: new Map() };
      const sign = x.kind === 'purchase' ? 1 : -1;
      if (x.date < from) it.opening += sign * qty;
      else {
        const d = it.days.get(x.date) || { date: x.date, in: 0, out: 0 };
        if (sign > 0) { d.in += qty; it.in += qty; } else { d.out += qty; it.out += qty; }
        it.days.set(x.date, d);
      }
      items.set(key, it);
    }
    const out = [...items.values()].sort((a, b) => a.sort - b.sort).map((it) => {
      let bal = it.opening;
      const days = [...it.days.values()].map((d) => { bal += d.in - d.out; return { date: d.date, in: round2(d.in), out: round2(d.out), balance: round2(bal) }; });
      return { item: it.item, unit: it.unit, opening: round2(it.opening), in: round2(it.in), out: round2(it.out), closing: round2(bal), days };
    });
    res.json({ from, to, items: out });
  });

  // ===== Import sheet penjualan =====
  r.post('/import/preview', requirePerm('import'), async (req, res) => {
    const plan = parseSheet(req.body.rows || [], { numberFormat: req.body.numberFormat });
    if (plan.error) throw bad(plan.error);
    const nums = plan.invoices.map((i) => i.number);
    const [exist] = nums.length ? await pool.query('SELECT number FROM invoices WHERE kind = "sale" AND number IN (?)', [nums]) : [[]];
    const existing = new Set(exist.map((e) => e.number));
    for (const inv of plan.invoices) inv.exists = existing.has(inv.number);
    res.json(plan);
  });

  r.post('/import/commit', requirePerm('import'), async (req, res) => {
    const plan = parseSheet(req.body.rows || [], { numberFormat: req.body.numberFormat });
    if (plan.error) throw bad(plan.error);
    if (plan.errors.length && !req.body.ignoreErrors) throw bad('Masih ada baris error — perbaiki sheet atau centang "lewati baris error"');
    const result = await tx(pool, async (c) => {
      const cache = { party: new Map(), item: new Map(), unit: new Map() };
      const created = { customers: [], items: [], units: [] };
      async function unitId(name) {
        const k = name.toLowerCase();
        if (cache.unit.has(k)) return cache.unit.get(k);
        let [[u]] = await c.query('SELECT id FROM units WHERE name = ?', [k]);
        if (!u) { const [ins] = await c.query('INSERT INTO units (name) VALUES (?)', [k]); u = { id: ins.insertId }; created.units.push(k); }
        cache.unit.set(k, u.id);
        return u.id;
      }
      async function itemId(name, unitName) {
        const k = name.toLowerCase();
        if (cache.item.has(k)) return cache.item.get(k);
        let [[it]] = await c.query('SELECT id FROM items WHERE name = ?', [name]);
        if (!it) {
          const [ins] = await c.query('INSERT INTO items (name, default_unit_id, sort_order) VALUES (?, ?, 100)', [name, await unitId(unitName)]);
          it = { id: ins.insertId }; created.items.push(name);
        }
        cache.item.set(k, it.id);
        return it.id;
      }
      async function party(name) {
        const k = name.toLowerCase();
        if (cache.party.has(k)) return cache.party.get(k);
        let [[p]] = await c.query('SELECT id, term_days FROM parties WHERE kind = "customer" AND name = ?', [name]);
        if (!p) { const [ins] = await c.query('INSERT INTO parties (kind, name) VALUES ("customer", ?)', [name]); p = { id: ins.insertId, term_days: 30 }; created.customers.push(name); }
        cache.party.set(k, p);
        return p;
      }
      const imported = [], skipped = [];
      for (const inv of plan.invoices) {
        const [[dup]] = await c.query('SELECT id FROM invoices WHERE kind = "sale" AND number = ?', [inv.number]);
        if (dup) { skipped.push(`${inv.number}: nomor sudah ada`); continue; }
        if (!inv.lines.length) { skipped.push(`${inv.number}: tidak ada baris barang`); continue; }
        const p = await party(inv.partyName);
        const [ins] = await c.query('INSERT INTO invoices SET ?', [{
          kind: 'sale', number: inv.number, date: inv.date, party_id: p.id, due_date: addDays(inv.date, p.term_days),
          po_ref: inv.poRef, notes: inv.notes, imported_total: inv.importedTotal, created_by: req.user.id, updated_by: req.user.id,
        }]);
        const lineRows = [];
        for (const [i, l] of inv.lines.entries()) lineRows.push([ins.insertId, await itemId(l.itemName, l.unitName), await unitId(l.unitName), l.qty, l.price, null, null, i]);
        await c.query('INSERT INTO invoice_lines (invoice_id, item_id, unit_id, qty, price, cost_price, note, sort) VALUES ?', [lineRows]);
        let room = inv.computedTotal;
        for (const pay of inv.payments) {
          const [pi] = await c.query('INSERT INTO payments SET ?', [{ kind: 'sale', date: pay.date, party_id: p.id, method: pay.method, amount: pay.amount, notes: pay.note, created_by: req.user.id }]);
          const alloc = round2(Math.min(pay.amount, Math.max(room, 0)));
          if (alloc > 0) await c.query('INSERT INTO allocations (payment_id, invoice_id, amount) VALUES (?,?,?)', [pi.insertId, ins.insertId, alloc]);
          room = round2(room - alloc);
        }
        await bumpCounter(c, 'sale', inv.number);
        imported.push(inv.number);
      }
      return { imported, skipped, created };
    });
    await log(pool, req.user, 'import', 'invoice_sale', null, { count: result.imported.length, skipped: result.skipped, created: result.created });
    res.json(result);
  });

  return r;
};
